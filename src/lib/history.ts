// Builds the chat-completions message list from a conversation. Kept free of SDK and DOM
// code so it can be unit tested.
import { EDIT_FORMAT, findTool } from "./tools.ts"
import type { Attachment, ModelRef, Reply, Turn } from "./types"

function usable(reply: Reply) {
  return (reply.status === "done" || reply.status === "stopped") && reply.text.trim() !== ""
}

/** The earlier reply a model should see for a turn: its own if it answered (compare mode), otherwise the first. */
export function pickReply(turn: Turn, target: ModelRef) {
  const replies = turn.replies.filter(usable)
  return replies.find((r) => r.model.id === target.id) ?? replies[0]
}

function decodeText(data: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function isImage(a: Attachment) {
  return a.mediaType.startsWith("image/")
}

/** Text files are inlined into the prompt, after the AI tool's instruction if one was picked. */
export function promptText(turn: Turn) {
  const files = turn.attachments.filter((a) => !isImage(a)).map((a) => `<file name="${a.name}">\n${decodeText(a.data)}\n</file>`)
  const tool = findTool(turn.tool)
  // A connected repo means answers may include files to push, so ask for the pushable format.
  const repo = turn.repo
    ? `This is about the GitHub repository ${turn.repo.owner}/${turn.repo.repo}${turn.repo.ref ? ` (branch ${turn.repo.ref})` : ""}.${tool?.id === "repo" ? "" : " " + EDIT_FORMAT}`
    : ""
  return [repo, tool?.instruction ?? "", ...files, turn.text].filter((part) => part.trim() !== "").join("\n\n")
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Part[] }
  | { role: "assistant"; content: string }

function userMessage(turn: Turn, withImages = true): ChatMessage {
  const images = turn.attachments.filter(isImage)
  const text = promptText(turn)
  // Older pictures are named rather than resent: they cost far more than text.
  if (!withImages && images.length) return { role: "user", content: [...images.map((a) => `[picture: ${a.name}]`), text].filter(Boolean).join("\n") }
  // Plain string content when there are no images: every model accepts that.
  if (!images.length) return { role: "user", content: text }
  const parts: Part[] = images.map((a) => ({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } }))
  if (text) parts.push({ type: "text", text })
  return { role: "user", content: parts }
}

export function chatMessages(system: string, history: Turn[], current: Turn, target: ModelRef): ChatMessage[] {
  const out: ChatMessage[] = system.trim() ? [{ role: "system", content: system.trim() }] : []
  for (const turn of history) {
    out.push(userMessage(turn))
    const reply = pickReply(turn, target)
    if (reply) out.push({ role: "assistant", content: reply.text })
  }
  out.push(userMessage(current))
  return out
}

/** Rough size in tokens: about 4 characters a token, and about 1,000 for a picture. */
export function estimateTokens(m: ChatMessage) {
  if (typeof m.content === "string") return Math.ceil(m.content.length / 4) + 4
  return m.content.reduce((n, p) => n + (p.type === "text" ? Math.ceil(p.text.length / 4) : 1000), 4)
}

/** How much of a model's context window the conversation may use, leaving room for the reply. */
export function inputBudget(contextWindow?: number) {
  const window = contextWindow && contextWindow > 0 ? contextWindow : 32_000
  return Math.max(4_000, Math.min(120_000, Math.floor(window * 0.6)))
}

/** A summary of the oldest turns, standing in for them once they no longer fit. */
export interface HistorySummary {
  text: string
  /** The id of the last turn it covers. */
  through: string
}

/** Pictures are sent again only for this many of the most recent earlier turns. */
const RECENT_IMAGE_TURNS = 2

/**
 * The messages for a reply, fitted to a token budget: the system prompt and the current
 * message always, then earlier turns from the newest back while they fit. Turns left out are
 * returned (oldest first) so they can be summarized; a summary of them is put in their place.
 */
export function fitMessages(system: string, history: Turn[], current: Turn, target: ModelRef, budget: number, summary?: HistorySummary) {
  const last = userMessage(current)
  const note = (text: string) => ({ role: "system" as const, content: text })
  let used = estimateTokens(last) + Math.ceil(system.length / 4) + (summary ? Math.ceil(summary.text.length / 4) + 40 : 0)
  const kept: ChatMessage[][] = []
  let first = history.length
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]
    const reply = pickReply(turn, target)
    const pair: ChatMessage[] = [userMessage(turn, history.length - i <= RECENT_IMAGE_TURNS)]
    if (reply) pair.push({ role: "assistant", content: reply.text })
    const cost = pair.reduce((n, m) => n + estimateTokens(m), 0)
    if (used + cost > budget) break
    used += cost
    kept.unshift(pair)
    first = i
  }
  const dropped = history.slice(0, first)
  const extra = !dropped.length
    ? ""
    : summary
      ? `Summary of the earlier part of this conversation (older messages were condensed to fit):\n${summary.text.trim()}`
      : "Older messages in this conversation were left out to fit the model's memory."
  const messages: ChatMessage[] = [
    ...(system.trim() || extra ? [note([system.trim(), extra].filter(Boolean).join("\n\n"))] : []),
    ...kept.flat(),
    last,
  ]
  return { messages, dropped }
}

/** Whether a summary already covers every turn that was left out (they're the oldest of `history`). */
export function summaryCovers(summary: HistorySummary | undefined, dropped: Turn[], history: Turn[]) {
  if (!dropped.length) return true
  if (!summary) return false
  return history.findIndex((t) => t.id === summary.through) >= dropped.length - 1
}

const SUMMARY_TURN_CHARS = 4_000
const SUMMARY_TOTAL_CHARS = 60_000

/** Asks for a summary of turns that no longer fit, building on the summary so far. */
export function summaryRequest(previous: HistorySummary | undefined, turns: Turn[], target: ModelRef): ChatMessage[] {
  const transcript = turns
    .map((t) => {
      const reply = pickReply(t, target)?.text ?? ""
      const files = t.attachments.map((a) => a.name)
      return `User: ${t.text.slice(0, SUMMARY_TURN_CHARS)}${files.length ? ` [attached: ${files.join(", ")}]` : ""}\nAssistant: ${reply.slice(0, SUMMARY_TURN_CHARS)}`
    })
    .join("\n\n")
    .slice(-SUMMARY_TOTAL_CHARS)
  return [
    {
      role: "system",
      content:
        "You condense conversations so they can continue without the full history. Write a compact summary (at most 300 words) of the facts, decisions, names, numbers, code and open questions that matter later. Plain text, no preamble.",
    },
    { role: "user", content: `${previous ? `Summary so far:\n${previous.text}\n\n` : ""}Conversation to add:\n\n${transcript}` },
  ]
}
