// Builds the chat-completions message list from a conversation. Kept free of SDK and DOM
// code so it can be unit tested.
import { findTool } from "./tools.ts"
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
  const instruction = findTool(turn.tool)?.instruction ?? ""
  return [instruction, ...files, turn.text].filter((part) => part.trim() !== "").join("\n\n")
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Part[] }
  | { role: "assistant"; content: string }

function userMessage(turn: Turn): ChatMessage {
  const images = turn.attachments.filter(isImage)
  const text = promptText(turn)
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
