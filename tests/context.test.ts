import assert from "node:assert/strict"
import { test } from "node:test"
import { estimateTokens, fitMessages, inputBudget, summaryCovers, summaryRequest } from "../src/lib/history.ts"
import type { Turn } from "../src/lib/types.ts"

const model = { id: "m:free" }
const turn = (n: number, size = 400, picture = false): Turn => ({
  id: `t${n}`,
  text: `question ${n} ` + "x".repeat(size),
  attachments: picture ? [{ id: `a${n}`, name: `photo${n}.png`, mediaType: "image/png", data: "AAAA" }] : [],
  replies: [{ id: `r${n}`, model, text: `answer ${n} ` + "y".repeat(size), thinking: "", status: "done", createdAt: n }],
  createdAt: n,
})

test("budgets come from the model's context window, with room for the reply", () => {
  assert.equal(inputBudget(128_000), 76_800)
  assert.equal(inputBudget(1_000_000), 120_000)
  assert.equal(inputBudget(4_096), 4_000)
  assert.equal(inputBudget(), 19_200)
  assert.equal(estimateTokens({ role: "user", content: "x".repeat(400) }), 104)
  assert.equal(estimateTokens({ role: "user", content: [{ type: "image_url", image_url: { url: "data:" } }, { type: "text", text: "abcd" }] }), 1005)
})

test("a short chat goes whole", () => {
  const history = [turn(1), turn(2)]
  const { messages, dropped } = fitMessages("Be brief.", history, turn(3), model, 10_000)
  assert.equal(dropped.length, 0)
  assert.deepEqual(messages.map((m) => m.role), ["system", "user", "assistant", "user", "assistant", "user"])
  assert.equal(messages[0].content, "Be brief.")
})

test("a long chat keeps the newest turns, says older ones were left out, and returns them oldest first", () => {
  const history = Array.from({ length: 20 }, (_, i) => turn(i + 1, 2000))
  const { messages, dropped } = fitMessages("", history, turn(21), model, 6_000)
  assert.ok(dropped.length > 0)
  assert.equal(dropped[0].id, "t1")
  const kept = messages.filter((m) => m.role === "user").length - 1
  assert.equal(kept + dropped.length, 20)
  assert.match(String(messages[0].content), /left out to fit/)
  assert.match(String(messages.at(-1)!.content), /^question 21/)
  assert.ok(messages.reduce((n, m) => n + estimateTokens(m), 0) <= 6_000 + 600)
})

test("a summary stands in for the turns left out", () => {
  const history = Array.from({ length: 20 }, (_, i) => turn(i + 1, 2000))
  const summary = { text: "They planned a launch for March.", through: "t15" }
  const { messages, dropped } = fitMessages("Be brief.", history, turn(21), model, 6_000, summary)
  assert.match(String(messages[0].content), /^Be brief\.\n\nSummary of the earlier part[^]*launch for March/)
  assert.equal(summaryCovers(summary, dropped, history), dropped.length <= 15)
  assert.equal(summaryCovers(undefined, [], history), true)
  assert.equal(summaryCovers(undefined, dropped, history), false)
})

test("pictures are only resent for the last two turns; older ones are named", () => {
  const history = [turn(1, 10, true), turn(2, 10, true), turn(3, 10, true)]
  const { messages } = fitMessages("", history, turn(4, 10, true), model, 50_000)
  const users = messages.filter((m) => m.role === "user")
  assert.equal(typeof users[0].content, "string")
  assert.match(users[0].content as string, /\[picture: photo1\.png\]/)
  assert.ok(Array.isArray(users[1].content) && Array.isArray(users[2].content) && Array.isArray(users[3].content))
})

test("the summary request carries the summary so far and the turns to add, trimmed", () => {
  const msgs = summaryRequest({ text: "Earlier: names agreed.", through: "t1" }, [turn(2, 10_000)], model)
  assert.equal(msgs[0].role, "system")
  assert.match(String(msgs[1].content), /^Summary so far:\nEarlier: names agreed\./)
  assert.match(String(msgs[1].content), /User: question 2/)
  assert.ok(String(msgs[1].content).length < 9_000)
})
