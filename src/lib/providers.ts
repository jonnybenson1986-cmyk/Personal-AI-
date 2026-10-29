// Talks to an OpenAI-compatible API with the official `openai` SDK: OpenRouter's free models
// through the edge proxy, or the user's own OmniRoute gateway. Normalizes the stream into
// StreamEvents.
import OpenAI from "openai"
import { type ChatMessage, chatMessages } from "./history"
import { filterFreeModels, filterGatewayModels, type GatewayModel, type OpenRouterModel } from "./models"
import { gatewayRoute } from "./route"
import { findTool } from "./tools"
import type { Conversation, ModelInfo, ModelRef, Provider, StreamEvents, StreamResult, Turn } from "./types"

export interface Credentials {
  openrouterKey: string
  provider?: Provider
  omnirouteUrl?: string
  omnirouteKey?: string
}

// With a key from Settings the SDK sends it and the proxy passes it on; without one, the
// placeholder asks the proxy to use the site's own key (free models only).
const PLACEHOLDER_KEY = "set-on-server"

// Remembered for error messages, which don't otherwise know where a request went.
let lastGateway: { mode: "proxy" | "direct"; base: string } | undefined

export function client(c: Credentials) {
  if (c.provider === "omniroute") {
    const route = gatewayRoute(c.omnirouteUrl ?? "")
    if (!route) throw new Error("Add your OmniRoute address in Settings.")
    lastGateway = route
    return new OpenAI({
      baseURL: route.mode === "direct" ? `${route.base}/v1` : `${location.origin}/api/omniroute/v1`,
      apiKey: c.omnirouteKey?.trim() || "no-key",
      defaultHeaders: route.mode === "proxy" ? { "x-omniroute-url": route.base } : undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
    })
  }
  lastGateway = undefined
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
  return streamChat({
    messages: chatMessages(req.conversation.system, req.history, req.current, req.model),
    model: req.model,
    credentials: req.credentials,
    signal: req.signal,
    events: req.events,
    // OpenRouter's reasoning control; models that don't reason ignore it.
    reasoning: !!findTool(req.current.tool)?.reasoning,
  })
}

/** Streams one chat completion from OpenRouter. */
export async function streamChat(req: {
  messages: ChatMessage[]
  model: ModelRef
  credentials: Credentials
  signal: AbortSignal
  events: StreamEvents
  reasoning?: boolean
}): Promise<StreamResult> {
  const stream = await client(req.credentials).chat.completions.create(
    {
      model: req.model.id,
      messages: req.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
      // OpenRouter's reasoning control, or the standard OpenAI field for a gateway.
      ...(req.reasoning ? (req.credentials.provider === "omniroute" ? { reasoning_effort: "high" } : { reasoning: { effort: "high" } }) : {}),
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

/** OmniRoute's full model list (including image and audio models) from the last load. */
export let lastGatewayModels: GatewayModel[] = []

/** Free chat models from OpenRouter's live list (needs no key), or the gateway's models. */
export async function listModels(credentials?: Credentials): Promise<ModelInfo[]> {
  if (credentials?.provider === "omniroute") {
    const page = await client(credentials).models.list()
    lastGatewayModels = page.data as unknown as GatewayModel[]
    return filterGatewayModels(lastGatewayModels)
  }
  const res = await fetch("/api/openrouter/v1/models")
  if (!res.ok) throw new Error(`Model list failed: ${res.status}`)
  const body = (await res.json()) as { data: OpenRouterModel[] }
  return filterFreeModels(body.data)
}

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
    if (error.status === 401 && !/Settings/.test(message))
      return lastGateway ? "OmniRoute didn't accept the API key. Check it in Settings → OmniRoute." : "OpenRouter didn't accept the key. Check it in Settings → OpenRouter key."
    if (error instanceof OpenAI.APIConnectionError && lastGateway?.mode === "direct")
      return `Couldn't reach OmniRoute at ${lastGateway.base}. Check it's running, and that it allows this site: start it with CORS_ALLOWED_ORIGINS=${location.origin}`
    if (lastGateway) return message
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
