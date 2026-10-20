import assert from "node:assert/strict"
import { test } from "node:test"
import { anthropicMessages, openaiInput, pickReply } from "../src/lib/history.ts"
import type { Reply, Turn } from "../src/lib/types.ts"

const claude = { provider: "anthropic" as const, id: "claude-opus-5-5" }
const sonnet = { provider: "anthropic" as const, id: "claude-sonnet-5-5" }
const gpt = { provider: "openai" as const, id: "gpt-5" }

function reply(model: Reply["model"], text: string, extra: Partial<Reply> = {}): Reply {
  return { id: text, model, text, thinking: "", sources: [], status: "done", createdAt: 0, ...extra }
}

function turn(text: string, replies: Reply[] = []): Turn {
  return { id: text, text, attachments: [], replies, createdAt: 0 }
}

const rawBlocks = [
  { type: "thinking", thinking: "hmm", signature: "sig" },
  { type: "text", text: "claude answer" },
]

test("pickReply prefers the same model, then provider, then any", () => {
  const t = turn("q", [reply(gpt, "g"), reply(sonnet, "s"), reply(claude, "c")])
  assert.equal(pickReply(t, claude)?.text, "c")
  assert.equal(pickReply(t, { provider: "anthropic", id: "claude-haiku-5-5" })?.text, "s")
  assert.equal(pickReply(turn("q", [reply(claude, "c")]), gpt)?.text, "c")
})

test("pickReply skips failed and empty replies", () => {
  const t = turn("q", [reply(claude, "", { status: "error", error: "x" }), reply(gpt, "g")])
  assert.equal(pickReply(t, claude)?.text, "g")
  assert.equal(pickReply(turn("q", [reply(claude, "partial", { status: "streaming" })]), claude), undefined)
})

test("Claude gets its own raw blocks back unchanged, other replies as text", () => {
  const history = [turn("one", [reply(claude, "claude answer", { raw: rawBlocks })]), turn("two", [reply(gpt, "gpt answer")])]
  const messages = anthropicMessages(history, turn("three"), claude)
  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "one" }] },
    { role: "assistant", content: rawBlocks },
    { role: "user", content: [{ type: "text", text: "two" }] },
    { role: "assistant", content: [{ type: "text", text: "gpt answer" }] },
    { role: "user", content: [{ type: "text", text: "three" }] },
  ])
})

test("the Claude history is identical on every turn (append-only)", () => {
  const history = [turn("one", [reply(claude, "claude answer", { raw: rawBlocks })])]
  const first = anthropicMessages(history, turn("two"), claude)
  const second = anthropicMessages([...history, turn("two", [reply(claude, "b")])], turn("three"), claude)
  assert.deepEqual(second.slice(0, first.length), first)
})

test("a failed turn merges into the next user message instead of breaking alternation", () => {
  const history = [turn("one", [reply(claude, "", { status: "error" })])]
  const messages = anthropicMessages(history, turn("two"), claude)
  assert.deepEqual(messages, [{ role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }])
})

test("attachments map to each provider's format", () => {
  const png = { id: "a", name: "a.png", mediaType: "image/png", data: "AAAA" }
  const pdf = { id: "b", name: "b.pdf", mediaType: "application/pdf", data: "BBBB" }
  const txt = { id: "c", name: "c.txt", mediaType: "text/plain", data: Buffer.from("hello file").toString("base64") }
  const current: Turn = { ...turn("look"), attachments: [png, pdf, txt] }
  const [claudeMsg] = anthropicMessages([], current, claude)
  assert.deepEqual(claudeMsg.content, [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" }, title: "b.pdf" },
    { type: "text", text: '<file name="c.txt">\nhello file\n</file>\n\nlook' },
  ])
  const [gptMsg] = openaiInput([], current, gpt)
  assert.deepEqual(gptMsg, {
    role: "user",
    content: [
      { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
      { type: "input_file", filename: "b.pdf", file_data: "data:application/pdf;base64,BBBB" },
      { type: "input_text", text: '<file name="c.txt">\nhello file\n</file>\n\nlook' },
    ],
  })
})

test("OpenAI history uses plain text for every reply", () => {
  const history = [turn("one", [reply(claude, "claude answer", { raw: rawBlocks }), reply(gpt, "gpt answer")])]
  assert.deepEqual(openaiInput(history, turn("two"), gpt), [
    { role: "user", content: [{ type: "input_text", text: "one" }] },
    { role: "assistant", content: "gpt answer" },
    { role: "user", content: [{ type: "input_text", text: "two" }] },
  ])
})
