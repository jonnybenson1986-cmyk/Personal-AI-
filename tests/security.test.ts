import assert from "node:assert/strict"
import { test } from "node:test"
import { allowedUrl, fetchPublic, MAX_REDIRECTS, ReaderError } from "../netlify/shared/read.ts"
import { MAX_BODY_BYTES, paidFeature, proxy, type Upstream } from "../netlify/shared/proxy.ts"

/** A fake network: each URL maps to a status and optional Location. */
function network(routes: Record<string, { status: number; location?: string; body?: string }>) {
  const seen: string[] = []
  const doFetch = (async (input: string | URL) => {
    const href = String(input)
    seen.push(href)
    const r = routes[href]
    if (!r) return new Response("nope", { status: 404 })
    return new Response(r.body ?? "", { status: r.status, headers: r.location ? { location: r.location, "content-type": "text/html" } : { "content-type": "text/html" } })
  }) as typeof fetch
  return { doFetch, seen }
}

test("the reader checks every redirect, not only the first address", async () => {
  // A public page that redirects to the cloud metadata service is refused.
  const { doFetch, seen } = network({ "https://news.example.com/a": { status: 302, location: "http://169.254.169.254/latest/meta-data/" } })
  await assert.rejects(fetchPublic(allowedUrl("https://news.example.com/a")!, doFetch), (e: unknown) => e instanceof ReaderError && e.status === 400)
  assert.deepEqual(seen, ["https://news.example.com/a"]) // never requested the private address
})

test("a relative redirect to another public page is followed and the final address is returned", async () => {
  const { doFetch } = network({
    "https://news.example.com/a": { status: 301, location: "/articles/b" },
    "https://news.example.com/articles/b": { status: 200, body: "<p>hi</p>" },
  })
  const { res, url } = await fetchPublic(allowedUrl("https://news.example.com/a")!, doFetch)
  assert.equal(res.status, 200)
  assert.equal(url.href, "https://news.example.com/articles/b")
})

test("redirect loops stop after the limit", async () => {
  const routes: Record<string, { status: number; location: string }> = {}
  for (let i = 0; i <= MAX_REDIRECTS + 1; i++) routes[`https://loop.example.com/${i}`] = { status: 302, location: `https://loop.example.com/${i + 1}` }
  const { doFetch } = network(routes)
  await assert.rejects(fetchPublic(allowedUrl("https://loop.example.com/0")!, doFetch), (e: unknown) => e instanceof ReaderError && e.status === 502)
})

test("a redirect to a private name, an IP address or a non-web scheme is refused", async () => {
  for (const location of ["http://localhost:20128", "http://10.0.0.5/x", "file:///etc/passwd", "https://user:pw@example.com"]) {
    const { doFetch } = network({ "https://a.example.com/": { status: 302, location } })
    await assert.rejects(fetchPublic(allowedUrl("https://a.example.com/")!, doFetch), ReaderError, location)
  }
})

test("the proxy tells a malformed body (400) from a paid request (403)", () => {
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
  assert.equal(paidFeature(enc("{bad"))?.status, 400)
  assert.equal(paidFeature(enc("[1,2]"))?.status, 400)
  assert.equal(paidFeature(enc('{"model":"openai/gpt-4o"}'))?.status, 403)
  assert.equal(paidFeature(enc('{"model":"openrouter/free","plugins":[{"id":"web"}]}'))?.status, 403)
  assert.equal(paidFeature(enc('{"model":"openrouter/free","models":"x"}'))?.status, 403)
  assert.equal(paidFeature(enc('{"model":"google/gemma:free","models":["google/gemma:free","openrouter/free"]}')), undefined)
})

test("the proxy refuses oversized bodies before forwarding them", async () => {
  const upstream: Upstream = {
    prefix: "/api/openrouter",
    origin: "https://openrouter.invalid/api",
    allow: { POST: [/^\/v1\/chat\/completions$/] },
    open: [],
    forward: ["content-type"],
    keyEnv: "OPENROUTER_API_KEY",
  }
  const big = new Request("https://site.example/api/openrouter/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer sk-or-v1-mine", "content-length": String(MAX_BODY_BYTES + 1) },
    body: "{}",
  })
  const res = await proxy(big, upstream, () => undefined)
  assert.equal(res.status, 413)
})

test("the proxy answers malformed JSON with 400 for a visitor using the site's key", async () => {
  const upstream: Upstream = {
    prefix: "/api/openrouter",
    origin: "https://openrouter.invalid/api",
    allow: { POST: [/^\/v1\/chat\/completions$/] },
    open: [],
    forward: ["content-type"],
    keyEnv: "OPENROUTER_API_KEY",
  }
  const req = new Request("https://site.example/api/openrouter/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" })
  const res = await proxy(req, upstream, (n) => (n === "OPENROUTER_API_KEY" ? "sk-or-site" : undefined))
  assert.equal(res.status, 400)
})

test("the visitor limit allows the allowance, refuses the next request with a wait, and resets each minute", async () => {
  const { overLimit, purgeLimits } = await import("../netlify/shared/limit.ts")
  const data = new Map<string, unknown>()
  const store = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: unknown) => void data.set(k, v),
    list: async (p: string) => [...data.keys()].filter((k) => k.startsWith(p)),
    delete: async (k: string) => void data.delete(k),
  }
  const t = Date.UTC(2026, 10, 10, 12, 0, 10) // 10 seconds into a minute
  for (let i = 0; i < 3; i++) assert.equal(await overLimit(store, "read", "1.2.3.4", 3, t), undefined)
  const wait = await overLimit(store, "read", "1.2.3.4", 3, t)
  assert.equal(wait, 50) // 50 seconds to the next minute
  assert.equal(await overLimit(store, "read", "5.6.7.8", 3, t), undefined, "another visitor is counted separately")
  assert.equal(await overLimit(store, "read", "1.2.3.4", 3, t + 60_000), undefined, "a new minute starts fresh")
  assert.equal(await overLimit(store, "omniroute", "1.2.3.4", 3, t), undefined, "each endpoint is counted separately")
  await purgeLimits(store, t + 2 * 3_600_000)
  assert.equal(data.size, 0)
})
