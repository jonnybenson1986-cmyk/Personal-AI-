import assert from "node:assert/strict"
import { test } from "node:test"
import { imageFrom, mediaModelsFrom, pcmToWav } from "../src/lib/mediaops.ts"

const list = [
  { id: "google/gemini-image", pricing: { prompt: "0.0000003", completion: "0.0000025" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["image", "text"] } },
  { id: "openai/gpt-audio", pricing: { prompt: "0.0000025", completion: "0.00001" }, architecture: { input_modalities: ["text", "audio"], output_modalities: ["text", "audio"] } },
  { id: "google/lyria-3-clip-preview", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["audio"] } },
  { id: "nvidia/omni:free", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text", "audio"], output_modalities: ["text"] } },
  { id: "google/gemini-flash", pricing: { prompt: "0.0000001", completion: "0.0000004" }, architecture: { input_modalities: ["text", "audio"], output_modalities: ["text"] } },
  { id: "meta/llama:free", pricing: { prompt: "0", completion: "0" } },
]

test("locked devices get only the free transcription model; no paid image or voice models", () => {
  assert.deepEqual(mediaModelsFrom(list, false), { image: [], speech: [], transcription: ["nvidia/omni:free"], locked: true })
})

test("unlocked devices get every image, voice and transcription model, free ones first, music models left out", () => {
  assert.deepEqual(mediaModelsFrom(list, true), {
    image: ["google/gemini-image"],
    speech: ["openai/gpt-audio"],
    transcription: ["nvidia/omni:free", "google/gemini-flash", "openai/gpt-audio"],
    locked: false,
  })
})

test("the picture in an image model's answer is read, and a missing one is explained", async () => {
  const png = "data:image/png;base64,iVBORw0KGgo="
  const blob = await imageFrom({ content: "Here you go", images: [{ type: "image_url", image_url: { url: png } }] })
  assert.equal(blob.type, "image/png")
  await assert.rejects(imageFrom({ content: "I can't draw" }), /without an image/)
})

test("streamed voice audio becomes a playable 24 kHz mono WAV", async () => {
  const wav = new Uint8Array(await pcmToWav(new Uint8Array([1, 0, 2, 0])).arrayBuffer())
  const text = (a: number, b: number) => String.fromCharCode(...wav.slice(a, b))
  assert.equal(text(0, 4), "RIFF")
  assert.equal(text(8, 12), "WAVE")
  const v = new DataView(wav.buffer)
  assert.equal(v.getUint32(24, true), 24_000)
  assert.equal(v.getUint16(22, true), 1)
  assert.equal(v.getUint32(40, true), 4)
  assert.equal(wav.length, 48)
})
