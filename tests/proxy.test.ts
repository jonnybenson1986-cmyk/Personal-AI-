import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { anthropic, openai, proxy } from "../netlify/shared/proxy.ts"

const env = (vars: Record<string, string>) => (name: string) => vars[name]
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function capture() {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response("data: hi\n\n", { status: 200, headers: { "content-type": "text/event-stream", "content-encoding": "gzip", "set-cookie": "x=1" } })
  }) as typeof fetch
  return calls
}

const keys = { APP_PASSCODE: "open sesame", ANTHROPIC_API_KEY: "sk-ant-real", OPENAI_API_KEY: "sk-real" }

test("refuses requests without the right passcode", async () => {
  const calls = capture()
  const res = await proxy(new Request("https://x/api/anthropic/v1/messages", { method: "POST", headers: { "x-app-passcode": "nope" } }), anthropic, env(keys))
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

test("fails closed when no passcode is configured", async () => {
  const res = await proxy(new Request("https://x/api/anthropic/v1/messages", { method: "POST" }), anthropic, env({ ANTHROPIC_API_KEY: "k" }))
  assert.equal(res.status, 503)
})

test("only forwards allowed paths", async () => {
  const calls = capture()
  const res = await proxy(new Request("https://x/api/anthropic/v1/files", { headers: { "x-app-passcode": "open sesame" } }), anthropic, env(keys))
  assert.equal(res.status, 404)
  assert.equal(calls.length, 0)
})

test("swaps in the server key and strips browser credentials", async () => {
  const calls = capture()
  const res = await proxy(
    new Request("https://x/api/anthropic/v1/messages", {
      method: "POST",
      headers: { "x-app-passcode": "open sesame", "x-api-key": "set-on-server", "anthropic-version": "2023-06-01", "anthropic-beta": "a,b", cookie: "c=1" },
      body: "{}",
    }),
    anthropic,
    env(keys),
  )
  assert.equal(res.status, 200)
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages")
  const headers = new Headers(calls[0].init.headers)
  assert.equal(headers.get("x-api-key"), "sk-ant-real")
  assert.equal(headers.get("anthropic-beta"), "a,b")
  assert.equal(headers.get("cookie"), null)
  assert.equal(headers.get("x-app-passcode"), null)
  assert.equal(res.headers.get("content-encoding"), null)
  assert.equal(res.headers.get("set-cookie"), null)
  assert.equal(await res.text(), "data: hi\n\n")
})

test("OpenAI uses a bearer token and keeps the query string", async () => {
  const calls = capture()
  await proxy(new Request("https://x/api/openai/v1/models?limit=5", { headers: { "x-app-passcode": "open sesame", authorization: "Bearer set-on-server" } }), openai, env(keys))
  assert.equal(calls[0].url, "https://api.openai.com/v1/models?limit=5")
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer sk-real")
})
