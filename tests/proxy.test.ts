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

test("a user's own key is forwarded without a server passcode", async () => {
  const calls = capture()
  const res = await proxy(
    new Request("https://x/api/anthropic/v1/messages", { method: "POST", headers: { "x-api-key": "sk-ant-mine" }, body: "{}" }),
    anthropic,
    env({}),
  )
  assert.equal(res.status, 200)
  assert.equal(new Headers(calls[0].init.headers).get("x-api-key"), "sk-ant-mine")

  await proxy(new Request("https://x/api/openai/v1/responses", { method: "POST", headers: { authorization: "Bearer sk-mine" }, body: "{}" }), openai, env({}))
  assert.equal(new Headers(calls[1].init.headers).get("authorization"), "Bearer sk-mine")
})

test("the placeholder key never unlocks the server's key", async () => {
  const calls = capture()
  const res = await proxy(
    new Request("https://x/api/anthropic/v1/messages", { method: "POST", headers: { "x-api-key": "set-on-server" }, body: "{}" }),
    anthropic,
    env(keys),
  )
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
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

test("OpenAI image and video endpoints are allowed, other paths are not", async () => {
  const allowed = [
    ["POST", "/v1/images/generations"],
    ["POST", "/v1/images/edits"],
    ["POST", "/v1/videos"],
    ["GET", "/v1/videos/video_123"],
    ["GET", "/v1/videos/video_123/content"],
  ]
  for (const [method, path] of allowed) {
    const calls = capture()
    const res = await proxy(new Request(`https://x/api/openai${path}`, { method, headers: { "x-app-passcode": "open sesame" }, body: method === "POST" ? "{}" : undefined }), openai, env(keys))
    assert.equal(res.status, 200, path)
    assert.equal(calls.length, 1)
  }
  for (const [method, path] of [["DELETE", "/v1/videos/video_123"], ["GET", "/v1/files"], ["POST", "/v1/videos/video_123/remix"]]) {
    const calls = capture()
    const res = await proxy(new Request(`https://x/api/openai${path}`, { method, headers: { "x-app-passcode": "open sesame" } }), openai, env(keys))
    assert.equal(res.status, 404, path)
    assert.equal(calls.length, 0)
  }
})
