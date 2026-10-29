import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { gatewayBase, gatewayProxy } from "../netlify/shared/gateway.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function capture() {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response('{"object":"list","data":[]}', { status: 200, headers: { "content-type": "application/json", "set-cookie": "s=1" } })
  }) as typeof fetch
  return calls
}

test("only public https gateway addresses are accepted", () => {
  assert.equal(gatewayBase("https://omni.example.com/v1"), "https://omni.example.com")
  assert.equal(gatewayBase("https://abc-def.trycloudflare.com/"), "https://abc-def.trycloudflare.com")
  assert.equal(gatewayBase("https://my.host/omniroute/v1/"), "https://my.host/omniroute")
  for (const bad of ["http://omni.example.com/v1", "https://localhost:20128/v1", "https://127.0.0.1/v1", "https://10.0.0.2", "https://pi.local", "https://user:pw@omni.example.com", "nonsense", null])
    assert.equal(gatewayBase(bad), undefined, String(bad))
})

test("chat and model list are forwarded with the user's gateway key", async () => {
  const calls = capture()
  const headers = { "x-omniroute-url": "https://omni.example.com/v1", authorization: "Bearer sk-omni-mine" }
  const res = await proxyReq("/api/omniroute/v1/models", { headers })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("set-cookie"), null)
  await proxyReq("/api/omniroute/v1/chat/completions", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"model":"auto"}' })
  assert.deepEqual(calls.map((c) => c.url), ["https://omni.example.com/v1/models", "https://omni.example.com/v1/chat/completions"])
  assert.equal(new Headers(calls[1].init.headers).get("authorization"), "Bearer sk-omni-mine")
  assert.equal(new TextDecoder().decode(calls[1].init.body as ArrayBuffer), '{"model":"auto"}')
})

test("image, audio, video and music generation, search, page reading and OCR are forwarded too", async () => {
  const calls = capture()
  const headers = { "x-omniroute-url": "https://omni.example.com", authorization: "Bearer k" }
  for (const path of ["images/generations", "images/edits", "audio/transcriptions", "audio/speech", "videos/generations", "music/generations", "search", "web/fetch", "ocr"])
    assert.equal((await proxyReq(`/api/omniroute/v1/${path}`, { method: "POST", headers, body: "{}" })).status, 200, path)
  // The key's own usage (with its query) is the one management path allowed.
  assert.equal((await proxyReq("/api/omniroute/api/usage/om-usage?format=json", { headers })).status, 200)
  assert.equal(calls.length, 10)
  assert.equal(calls[9].url, "https://omni.example.com/api/usage/om-usage?format=json")
})

test("anything else is refused before reaching the gateway", async () => {
  const calls = capture()
  const good = { "x-omniroute-url": "https://omni.example.com", authorization: "Bearer k" }
  assert.equal((await proxyReq("/api/omniroute/api/keys", { headers: good })).status, 404)
  assert.equal((await proxyReq("/api/omniroute/v1/images/upscale", { method: "POST", headers: good, body: "{}" })).status, 404)
  assert.equal((await proxyReq("/api/omniroute/v1/chat/completions", { headers: good })).status, 404)
  assert.equal((await proxyReq("/api/omniroute/v1/models", { headers: { ...good, "x-omniroute-url": "http://192.168.1.5:20128" } })).status, 400)
  assert.equal((await proxyReq("/api/omniroute/v1/models", { headers: { "x-omniroute-url": "https://omni.example.com" } })).status, 401)
  assert.equal(calls.length, 0)
})

function proxyReq(path: string, init: RequestInit) {
  return gatewayProxy(new Request(`https://site.app${path}`, init))
}

test("the gateway's chat models and combos make the picker, auto first", async () => {
  const { filterGatewayModels } = await import("../src/lib/models.ts")
  const models = filterGatewayModels([
    { id: "groq/llama-4", context_length: 131072 },
    { id: "auto", owned_by: "combo", capabilities: { vision: true } },
    { id: "text-embedding-3-small", type: "embedding" },
    { id: "my-coding-combo", owned_by: "combo", display_name: "My coding combo" },
    { id: "auto/coding:fast", owned_by: "combo" },
    { id: "dall-e-3", type: "image" },
  ])
  const modes = ["auto", "auto/coding", "auto/fast", "auto/cheap", "auto/smart", "auto/offline"]
  assert.deepEqual(models.map((m) => m.id), [...modes, "auto/coding:fast", "groq/llama-4", "my-coding-combo"])
  assert.equal(models[0].label, "Auto (OmniRoute picks)")
  assert.equal(models[0].vision, true)
  assert.equal(models[1].label, "Auto · best for code")
  assert.equal(models[7].hint, "131K context")
  assert.equal(models[8].label, "My coding combo")
  assert.equal(models[8].hint, "Combo")
})

test("public https gateways go through the site; local ones are reached directly", async () => {
  const { gatewayRoute } = await import("../src/lib/route.ts")
  assert.deepEqual(gatewayRoute("https://abc.trycloudflare.com/v1"), { mode: "proxy", base: "https://abc.trycloudflare.com" })
  assert.deepEqual(gatewayRoute("omni.example.com"), { mode: "proxy", base: "https://omni.example.com" })
  assert.deepEqual(gatewayRoute("http://localhost:20128/v1"), { mode: "direct", base: "http://localhost:20128" })
  assert.deepEqual(gatewayRoute("localhost:20128"), { mode: "direct", base: "http://localhost:20128" })
  assert.deepEqual(gatewayRoute("192.168.1.20:20128"), { mode: "direct", base: "http://192.168.1.20:20128" })
  assert.deepEqual(gatewayRoute("https://pi.local:20128"), { mode: "direct", base: "https://pi.local:20128" })
  assert.equal(gatewayRoute("   "), undefined)
})
