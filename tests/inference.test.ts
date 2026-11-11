import assert from "node:assert/strict"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"
import { inferenceFetch } from "../netlify/shared/inference.ts"
import { filterGatewayModels } from "../src/lib/models.ts"

test("direct catalogs contain exact model IDs without invented OmniRoute aliases", () => {
  const models = filterGatewayModels([{ id: "catalog-chat", type: "chat" }, { id: "catalog-image", type: "image" }], false)
  assert.deepEqual(models.map((m) => m.id), ["catalog-chat"])
  assert.deepEqual(filterGatewayModels([], false), [])
})

test("Cheaper Inference JSON compression preserves content and streaming response", async () => {
  const body = JSON.stringify({ model: "catalog-chat", messages: [{ role: "user", content: "connected" }], stream: true })
  const controller = new AbortController()
  const response = new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  let calls = 0
  const transport = (async (url, init) => {
    calls++
    assert.equal(url, "https://api.cheaperinference.com/v1/chat/completions")
    const headers = new Headers(init?.headers)
    assert.equal(headers.get("content-encoding"), "gzip")
    assert.equal(headers.has("content-length"), false)
    assert.equal(init?.signal, controller.signal)
    assert.equal(gunzipSync(Buffer.from(init?.body as ArrayBuffer)).toString(), body)
    return response
  }) as typeof fetch
  assert.equal(await inferenceFetch("https://api.cheaperinference.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body, signal: controller.signal }, transport), response)
  assert.equal(calls, 1)
})

test("other providers, multipart uploads, catalog GETs and encoded bodies retain their transport", async () => {
  for (const [url, init] of [
    ["https://other.example/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["https://api.cheaperinference.com/v1/images/edits", { method: "POST", body: new FormData() }],
    ["https://api.cheaperinference.com/v1/models", { method: "GET" }],
    ["https://api.cheaperinference.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: "encoded" }],
  ] as [string, RequestInit][]) {
    const transport = (async (target, options) => {
      assert.equal(target, url)
      assert.equal(options, init)
      return new Response("ok")
    }) as typeof fetch
    await inferenceFetch(url, init, transport)
  }
})
