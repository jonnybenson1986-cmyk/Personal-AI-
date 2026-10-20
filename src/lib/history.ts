// Builds each provider's request history from a conversation. Kept free of SDK and DOM
// code so it can be unit tested.
import type { Attachment, ModelRef, Reply, Turn } from "./types"

function usable(reply: Reply) {
  return (reply.status === "done" || reply.status === "stopped") && (reply.text.trim() !== "" || reply.raw !== undefined || !!reply.media?.id)
}

/** How a generated image or video appears in a later request's history. */
export function replyText(reply: Reply) {
  if (reply.media?.id) return `[Generated ${reply.media.kind}: "${reply.media.prompt}"]`
  return reply.text
}

/**
 * The earlier reply a model should see for a turn: its own if it answered (compare mode),
 * otherwise one from the same provider, otherwise whichever answered first.
 */
export function pickReply(turn: Turn, target: ModelRef) {
  const replies = turn.replies.filter(usable)
  return (
    replies.find((r) => r.model.provider === target.provider && r.model.id === target.id) ??
    replies.find((r) => r.model.provider === target.provider) ??
    replies[0]
  )
}

function decodeText(data: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function isImage(a: Attachment) {
  return a.mediaType.startsWith("image/")
}

export function isPdf(a: Attachment) {
  return a.mediaType === "application/pdf"
}

/** Text files are inlined into the prompt so both providers read them the same way. */
export function promptText(turn: Turn) {
  const files = turn.attachments
    .filter((a) => !isImage(a) && !isPdf(a))
    .map((a) => `<file name="${a.name}">\n${decodeText(a.data)}\n</file>`)
  return [...files, turn.text].filter((part) => part.trim() !== "").join("\n\n")
}

type AnthropicBlock = Record<string, unknown>
export interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicBlock[]
}

function anthropicUser(turn: Turn): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = []
  for (const a of turn.attachments) {
    if (isImage(a)) blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } })
    if (isPdf(a)) blocks.push({ type: "document", source: { type: "base64", media_type: a.mediaType, data: a.data }, title: a.name })
  }
  const text = promptText(turn)
  if (text) blocks.push({ type: "text", text })
  return blocks
}

export function anthropicMessages(history: Turn[], current: Turn, target: ModelRef): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  const push = (role: AnthropicMessage["role"], content: AnthropicBlock[]) => {
    const last = out[out.length - 1]
    // A turn whose reply failed leaves two user messages in a row; merge them.
    if (last && last.role === role) last.content.push(...content)
    else out.push({ role, content })
  }
  for (const turn of history) {
    push("user", anthropicUser(turn))
    const reply = pickReply(turn, target)
    if (!reply) continue
    // Claude's own blocks go back unchanged so its earlier thinking stays valid.
    if (reply.model.provider === "anthropic" && reply.raw) push("assistant", reply.raw as AnthropicBlock[])
    else push("assistant", [{ type: "text", text: replyText(reply) }])
  }
  push("user", anthropicUser(current))
  return out
}

export type OpenAIInput =
  | { role: "user"; content: Record<string, unknown>[] }
  | { role: "assistant"; content: string }

function openaiUser(turn: Turn): OpenAIInput {
  const content: Record<string, unknown>[] = []
  for (const a of turn.attachments) {
    if (isImage(a)) content.push({ type: "input_image", image_url: `data:${a.mediaType};base64,${a.data}`, detail: "auto" })
    if (isPdf(a)) content.push({ type: "input_file", filename: a.name, file_data: `data:${a.mediaType};base64,${a.data}` })
  }
  const text = promptText(turn)
  if (text) content.push({ type: "input_text", text })
  return { role: "user", content }
}

export function openaiInput(history: Turn[], current: Turn, target: ModelRef): OpenAIInput[] {
  const out: OpenAIInput[] = []
  for (const turn of history) {
    out.push(openaiUser(turn))
    const reply = pickReply(turn, target)
    if (reply && replyText(reply).trim()) out.push({ role: "assistant", content: replyText(reply) })
  }
  out.push(openaiUser(current))
  return out
}
