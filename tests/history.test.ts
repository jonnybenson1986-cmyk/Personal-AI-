import assert from "node:assert/strict"
import { test } from "node:test"
import { chatMessages, pickReply } from "../src/lib/history.ts"
import { filterFreeModels } from "../src/lib/models.ts"
import type { Reply, Turn } from "../src/lib/types.ts"

const auto = { id: "openrouter/free" }
const gemma = { id: "google/gemma-4-31b-it:free" }

function reply(model: Reply["model"], text: string, extra: Partial<Reply> = {}): Reply {
  return { id: text, model, text, thinking: "", status: "done", createdAt: 0, ...extra }
}

function turn(text: string, replies: Reply[] = []): Turn {
  return { id: text, text, attachments: [], replies, createdAt: 0 }
}

test("pickReply prefers the same model, then the first usable reply", () => {
  const t = turn("q", [reply(auto, "a"), reply(gemma, "g")])
  assert.equal(pickReply(t, gemma)?.text, "g")
  assert.equal(pickReply(t, { id: "other:free" })?.text, "a")
  assert.equal(pickReply(turn("q", [reply(auto, "", { status: "error" }), reply(gemma, "g")]), auto)?.text, "g")
  assert.equal(pickReply(turn("q", [reply(auto, "partial", { status: "streaming" })]), auto), undefined)
})

test("history alternates user and assistant, with the system prompt first", () => {
  const history = [turn("one", [reply(auto, "first answer")]), turn("two", [reply(auto, "", { status: "error" })])]
  assert.deepEqual(chatMessages("Be brief.", history, turn("three"), auto), [
    { role: "system", content: "Be brief." },
    { role: "user", content: "one" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "two" },
    { role: "user", content: "three" },
  ])
  assert.equal(chatMessages("  ", [], turn("hi"), auto)[0].role, "user")
})

test("images become image parts, text files are inlined", () => {
  const png = { id: "a", name: "a.png", mediaType: "image/png", data: "AAAA" }
  const txt = { id: "c", name: "c.txt", mediaType: "text/plain", data: Buffer.from("hello file").toString("base64") }
  const current: Turn = { ...turn("look"), attachments: [png, txt] }
  assert.deepEqual(chatMessages("", [], current, gemma), [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        { type: "text", text: '<file name="c.txt">\nhello file\n</file>\n\nlook' },
      ],
    },
  ])
})

test("only free chat models make the picker, with Auto first", () => {
  const models = filterFreeModels([
    { id: "google/gemma-4-31b-it:free", name: "Google: Gemma 4 31B (free)", context_length: 262144, pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["image", "text"] } },
    { id: "google/gemma-4-31b-it", name: "Google: Gemma 4 31B", pricing: { prompt: "0.0000001", completion: "0.0000002" } },
    { id: "nvidia/nemotron-3.5-content-safety:free", name: "Safety (free)", pricing: { prompt: "0", completion: "0" } },
    { id: "odd/model:free", name: "Odd (free)", pricing: { prompt: "0.1", completion: "0" } },
  ])
  assert.deepEqual(
    models.map((m) => m.id),
    ["openrouter/free", "google/gemma-4-31b-it:free"],
  )
  assert.equal(models[1].label, "Google Gemma 4 31B")
  assert.equal(models[1].hint, "Sees images · 262K context")
  assert.deepEqual(filterFreeModels([]), [])
})
