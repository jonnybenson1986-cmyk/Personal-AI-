import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { isFreeModel, openrouter, proxy } from "../netlify/shared/proxy.ts"

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

const chat = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://site.app/api/openrouter/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })

const server = { OPENROUTER_API_KEY: "sk-or-site" }

test("a user's own key is passed through for any model", async () => {
  const calls = capture()
  const res = await proxy(chat({ model: "google/gemma-4-31b-it" }, { authorization: "Bearer sk-or-mine" }), openrouter, env({}))
  assert.equal(res.status, 200)
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions")
  const headers = new Headers(calls[0].init.headers)
  assert.equal(headers.get("authorization"), "Bearer sk-or-mine")
  assert.equal(headers.get("x-openrouter-title"), "Jonny's AI project")
  assert.equal(headers.get("http-referer"), "https://site.app")
  assert.equal(res.headers.get("content-encoding"), null)
  assert.equal(res.headers.get("set-cookie"), null)
  assert.equal(await res.text(), "data: hi\n\n")
})

test("the site's key works for free models only", async () => {
  const calls = capture()
  const free = await proxy(chat({ model: "google/gemma-4-31b-it:free" }, { authorization: "Bearer set-on-server" }), openrouter, env(server))
  assert.equal(free.status, 200)
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer sk-or-site")
  const router = await proxy(chat({ model: "openrouter/free" }), openrouter, env(server))
  assert.equal(router.status, 200)

  for (const body of [{ model: "google/gemma-4-31b-it" }, { model: "openrouter/auto" }, { model: "x:free", models: ["x:free", "paid/model"] }, { model: "x:free", plugins: [{ id: "web" }] }]) {
    const res = await proxy(chat(body), openrouter, env(server))
    assert.equal(res.status, 403, JSON.stringify(body))
  }
  assert.equal(calls.length, 2)
})

test("without any key the user is asked to add one", async () => {
  const calls = capture()
  const res = await proxy(chat({ model: "openrouter/free" }), openrouter, env({}))
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

test("the model list needs no key; other paths are blocked", async () => {
  const calls = capture()
  const res = await proxy(new Request("https://site.app/api/openrouter/v1/models"), openrouter, env({}))
  assert.equal(res.status, 200)
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), null)
  for (const [method, path] of [["GET", "/v1/key"], ["POST", "/v1/completions"], ["GET", "/v1/credits"]]) {
    const blocked = await proxy(new Request(`https://site.app/api/openrouter${path}`, { method, headers: { authorization: "Bearer sk-or-mine" } }), openrouter, env(server))
    assert.equal(blocked.status, 404, path)
  }
  assert.equal(calls.length, 1)
})

test("free model detection", () => {
  assert.ok(isFreeModel("nvidia/nemotron-3-ultra-550b-a55b:free"))
  assert.ok(isFreeModel("openrouter/free"))
  assert.ok(!isFreeModel("openrouter/auto"))
  assert.ok(!isFreeModel("meta/free-model"))
  assert.ok(!isFreeModel(undefined))
})
