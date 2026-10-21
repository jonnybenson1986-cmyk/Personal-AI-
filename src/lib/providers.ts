// Talks to OpenRouter's OpenAI-compatible API through the edge proxy, using the official
// `openai` SDK, and normalizes the stream into StreamEvents.
import OpenAI from "openai"
import { chatMessages } from "./history"
import { filterFreeModels, type OpenRouterModel } from "./models"
import { findTool } from "./tools"
import type { Conversation, ModelInfo, ModelRef, StreamEvents, StreamResult, Turn } from "./types"

export interface Credentials {
  openrouterKey: string
}

// With a key from Settings the SDK sends it and the proxy passes it on; without one, the
// placeholder asks the proxy to use the site's own key (free models only).
const PLACEHOLDER_KEY = "set-on-server"

function client(c: Credentials) {
  return new OpenAI({
    baseURL: `${location.origin}/api/openrouter/v1`,
    apiKey: c.openrouterKey.trim() || PLACEHOLDER_KEY,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  })
}

export interface StreamRequest {
  conversation: Conversation
  history: Turn[]
  current: Turn
  model: ModelRef
  credentials: Credentials
  signal: AbortSignal
  events: StreamEvents
}

// OpenRouter extends chat-completion chunks with reasoning text and in-stream errors.
interface Chunk {
  model?: string
  error?: { message?: string; code?: string | number }
  choices?: {
    finish_reason?: string | null
    delta?: { content?: string | null; reasoning?: string | null; reasoning_details?: { type: string; text?: string; summary?: string }[] }
  }[]
}

export async function streamReply(req: StreamRequest): Promise<StreamResult> {
  const stream = await client(req.credentials).chat.completions.create(
    {
      model: req.model.id,
      messages: chatMessages(req.conversation.system, req.history, req.current, req.model) as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
      // OpenRouter's reasoning control; models that don't reason ignore it.
      ...(findTool(req.current.tool)?.reasoning ? { reasoning: { effort: "high" } } : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    { signal: req.signal },
  )

  let served = false
  let notice: string | undefined
  for await (const raw of stream) {
    const chunk = raw as unknown as Chunk
    // Errors after the stream started arrive as a chunk with an `error` field.
    if (chunk.error) throw new Error(chunk.error.message ?? "The model stopped with an error.")
    if (!served && chunk.model) {
      served = true
      req.events.servedBy(chunk.model)
    }
    const choice = chunk.choices?.[0]
    const delta = choice?.delta
    if (delta?.reasoning) req.events.thinking(delta.reasoning)
    else for (const d of delta?.reasoning_details ?? []) if (d.text ?? d.summary) req.events.thinking(d.text ?? d.summary ?? "")
    if (delta?.content) req.events.text(delta.content)
    if (choice?.finish_reason === "length") notice = "The response hit the length limit."
    if (choice?.finish_reason === "error") throw new Error("The model stopped with an error. Try again or pick another model.")
  }
  return { notice }
}

/** Free chat models from OpenRouter's live list. Needs no key. */
export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/openrouter/v1/models")
  if (!res.ok) throw new Error(`Model list failed: ${res.status}`)
  const body = (await res.json()) as { data: OpenRouterModel[] }
  return filterFreeModels(body.data)
}

/** Whether the site has its own OpenRouter key (set on Netlify). */
export async function hasServerKey() {
  try {
    const res = await fetch("/api/status")
    if (res.ok) return ((await res.json()) as { serverKey: boolean }).serverKey
  } catch {
    // Offline: only a key entered in the app counts.
  }
  return false
}

export function errorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : String(error)
  if (error instanceof OpenAI.APIError) {
    const body = error.error as { error?: { message?: string }; message?: string } | undefined
    message = body?.error?.message ?? body?.message ?? error.message
    if (error.status === 401 && !/Settings/.test(message)) return "OpenRouter didn't accept the key. Check it in Settings → OpenRouter key."
    if (error.status === 429) return "Free-model limit reached for now. Wait a minute, or try another model. (Free models allow about 20 messages a minute and 50 a day.)"
  }
  // Some free models are only offered to accounts that allow providers to use prompts.
  if (/data policy|privacy/i.test(message))
    return `${message} — To use free models, open openrouter.ai/settings/privacy and allow free model providers, or pick another model.`
  return message
}

export function isAbort(error: unknown) {
  return error instanceof OpenAI.APIUserAbortError || (error instanceof DOMException && error.name === "AbortError")
}
