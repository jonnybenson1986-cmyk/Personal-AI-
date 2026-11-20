import assert from "node:assert/strict"
import { test } from "node:test"
import { hasImages, linksToRead, pageSource, visionModel } from "../src/lib/routing.ts"
import { GATEWAYS, gatewayKind, gatewayPreset } from "../src/lib/gateways.ts"
import { filterGatewayModels } from "../src/lib/models.ts"

test("links in a message are found, tidied and capped", () => {
  assert.deepEqual(linksToRead("Summarize https://example.com/a. Also see (https://en.wikipedia.org/wiki/Foo_(bar)), thanks!"), [
    "https://example.com/a",
    "https://en.wikipedia.org/wiki/Foo_(bar)",
  ])
  assert.deepEqual(linksToRead("a https://a.com b https://b.com c https://c.com"), ["https://a.com/", "https://b.com/"])
  assert.deepEqual(linksToRead("twice https://a.com and https://a.com/"), ["https://a.com/"])
  assert.deepEqual(linksToRead("no links, ftp://x.com or example.com"), [])
})

test("links already attached aren't read again", () => {
  assert.deepEqual(linksToRead("see https://a.com/x and https://b.com", ["https://a.com/x"]), ["https://b.com/"])
})

test("a page attachment knows where it came from", () => {
  const data = btoa("Source: https://a.com/x\n\nHello")
  assert.equal(pageSource({ id: "1", name: "A (a.com)", mediaType: "text/plain", data }), "https://a.com/x")
  assert.equal(pageSource({ id: "2", name: "notes.txt", mediaType: "text/plain", data: btoa("just notes") }), undefined)
  assert.equal(pageSource({ id: "3", name: "p.png", mediaType: "image/png", data }), undefined)
})

test("messages with pictures are spotted", () => {
  assert.equal(hasImages([{ role: "user", content: "hi" }]), false)
  assert.equal(hasImages([{ role: "user", content: [{ type: "text", text: "what's this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }]), true)
})

const known = [
  { id: "openrouter/free", label: "Auto", vision: true },
  { id: "text-only:free", label: "Text Only", vision: false },
  { id: "sees:free", label: "Sees", vision: true },
  { id: "unknown", label: "Unknown" },
]

test("pictures go to a model that can see them, preferring the router", () => {
  assert.deepEqual(visionModel({ id: "text-only:free" }, known, "openrouter/free"), { id: "openrouter/free" })
  assert.deepEqual(visionModel({ id: "text-only:free" }, known.slice(1), "openrouter/free"), { id: "sees:free" })
})

test("the chosen model is kept when it sees, or when we can't tell", () => {
  assert.equal(visionModel({ id: "sees:free" }, known, "openrouter/free"), undefined)
  assert.equal(visionModel({ id: "unknown" }, known, "openrouter/free"), undefined)
  assert.equal(visionModel({ id: "not-listed" }, known, "openrouter/free"), undefined)
  // Nothing in the list is known to see: no better choice, so keep it.
  assert.equal(visionModel({ id: "text-only:free" }, [known[1]], "openrouter/free"), undefined)
})

test("a gateway that doesn't report vision leaves it unknown", () => {
  const models = filterGatewayModels([{ id: "a" }, { id: "b", input_modalities: ["text"] }, { id: "c", capabilities: { vision: true } }], false)
  assert.deepEqual(
    models.map((m) => [m.id, m.vision]),
    [
      ["a", undefined],
      ["b", false],
      ["c", true],
    ],
  )
})

test("gateway presets: Cheaper Inference by address, the rest as picked, OmniRoute by default", () => {
  assert.equal(gatewayKind("https://api.cheaperinference.com/v1"), "cheaper")
  assert.equal(gatewayKind("https://api.cheaperinference.com/v1", "omniroute"), "cheaper")
  assert.equal(gatewayKind("http://localhost:3001", "freellmapi"), "freellmapi")
  assert.equal(gatewayKind("https://my-tunnel.trycloudflare.com"), "omniroute")
  assert.equal(gatewayKind(""), "omniroute")
  // Picked Cheaper Inference but then typed another address: treat it as a generic gateway.
  assert.equal(gatewayKind("https://other.example.com", "cheaper"), "custom")
  assert.equal(gatewayPreset("", "freellmapi").omniTools, false)
  assert.equal(GATEWAYS.omniroute.routingModes, true)
  assert.equal(GATEWAYS.freellmapi.auto, true)
  assert.equal(GATEWAYS.cheaper.auto, false)
})

test("FreeLLMAPI's auto model is labelled for any gateway, not OmniRoute", () => {
  const models = filterGatewayModels([{ id: "auto" }, { id: "gemini-2.5-flash" }], GATEWAYS.freellmapi.routingModes)
  assert.deepEqual(models.map((m) => m.id), ["auto", "gemini-2.5-flash"])
  assert.equal(models[0].label, "Auto (gateway picks)")
})

test("with the user's own key, every chat model is offered after the free ones, with prices", async () => {
  const { filterOpenRouterModels } = await import("../src/lib/models.ts")
  const list = [
    { id: "openrouter/free", name: "Free Models Router", pricing: { prompt: "0", completion: "0" } },
    { id: "google/gemma:free", name: "Gemma (free)", pricing: { prompt: "0", completion: "0" } },
    { id: "anthropic/claude-x", name: "Anthropic: Claude X", pricing: { prompt: "0.000003", completion: "0.000015" }, architecture: { input_modalities: ["text", "image"] } },
    { id: "openai/gpt-cheap", name: "OpenAI: GPT Cheap", pricing: { prompt: "0.00000015", completion: "0.0000006" } },
    { id: "openrouter/auto", name: "Auto Router", pricing: { prompt: "-1", completion: "-1" } },
    { id: "google/lyria:paid", name: "Lyria", pricing: { prompt: "0.0001", completion: "0" }, architecture: { output_modalities: ["audio"] } },
    { id: "meta/llama-guard", name: "Llama Guard", pricing: { prompt: "0.0000002", completion: "0.0000002" } },
  ]
  assert.deepEqual(filterOpenRouterModels(list).map((m) => m.id), ["openrouter/free", "google/gemma:free"])
  const all = filterOpenRouterModels(list, true)
  assert.deepEqual(all.map((m) => m.id), ["openrouter/free", "google/gemma:free", "anthropic/claude-x", "openai/gpt-cheap"])
  assert.equal(all[2].paid, true)
  assert.equal(all[2].vision, true)
  assert.equal(all[2].hint, "$3 in / $15 out per M tokens · Sees images")
  assert.equal(all[3].hint, "$0.15 in / $0.6 out per M tokens")
  assert.equal(all[1].paid, undefined)
})
