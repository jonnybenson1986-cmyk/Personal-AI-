// Talks to OpenRouter, the AI behind the site, with the official `openai` SDK, through the
// site's edge proxy (which adds the site's key when the app has none). Normalizes the stream
// into StreamEvents.
import OpenAI from "openai"
import { type ChatMessage, fitMessages, inputBudget } from "./history"
import { AUTO_MODEL, DEFAULT_MODELS, filterOpenRouterModels, modelLabel, type OpenRouterModel } from "./models"
import { freeFallback } from "../../netlify/shared/proxy.ts"
import { followJob, JobError, restartEvents, startJob } from "./jobs"
import { hasImages, visionModel } from "./routing"
import { findTool } from "./tools"
import type { Conversation, ModelInfo, ModelRef, StreamEvents, StreamResult, Turn } from "./types"

export interface Credentials {
  openrouterKey: string
  /** This device's pass for paid models on the site's key (Settings → passcode). */
  sitePass?: string
  /** Run replies on the server when the caller can pick them up again (default on). */
  background?: boolean
}

/** Lets a caller save the id of a reply running on the server, to pick it up again later. */
export interface JobHooks {
  started(id: string): void
}

// With a key from Settings the SDK sends it and the proxy passes it on; without one, the
// placeholder asks the proxy to use the site's own key (free models only).
const PLACEHOLDER_KEY = "set-on-server"

export function client(c: Credentials) {
  return new OpenAI({
    baseURL: `${location.origin}/api/openrouter/v1`,
    apiKey: c.openrouterKey.trim() || PLACEHOLDER_KEY,
    defaultHeaders: !c.openrouterKey.trim() && c.sitePass ? { "x-site-pass": c.sitePass } : undefined,
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
  job?: JobHooks
  /** Tokens the conversation may use (see inputBudget); older turns beyond it are left out. */
  budget?: number
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

// The last model list loaded, to tell which models can see pictures.
let listed: ModelInfo[] = DEFAULT_MODELS

export async function streamReply(req: StreamRequest): Promise<StreamResult> {
  const messages = fitMessages(req.conversation.system, req.history, req.current, req.model, req.budget ?? inputBudget(), req.conversation.summary).messages
  // A picture sent to a model that can't see would fail ("no endpoints support image input"),
  // so that message goes to one that can, and the reply says so.
  const swap = hasImages(messages) ? visionModel(req.model, listed, AUTO_MODEL) : undefined
  const result = await streamChat({
    messages,
    model: swap ?? req.model,
    credentials: req.credentials,
    signal: req.signal,
    events: req.events,
    // OpenRouter's reasoning control; models that don't reason ignore it.
    reasoning: !!findTool(req.current.tool)?.reasoning,
    job: req.job,
  })
  if (!swap) return result
  const note = `${modelLabel(req.model, listed)} can't see pictures, so ${modelLabel(swap, listed)} answered this one.`
  return { ...result, notice: [note, result.notice].filter(Boolean).join(" ") }
}

/** Where and with which keys a reply can run on the server, unless background replies are off (see jobs.ts). */
export function serverTarget(c: Credentials) {
  if (c.background === false) return undefined
  return { where: { provider: "openrouter" as const }, secrets: { openrouterKey: c.openrouterKey.trim() || undefined, sitePass: c.sitePass || undefined } }
}


interface ChatRequest {
  messages: ChatMessage[]
  model: ModelRef
  credentials: Credentials
  signal: AbortSignal
  events: StreamEvents
  reasoning?: boolean
  job?: JobHooks
}

/**
 * Streams one chat completion. With `job` hooks it runs on the server when it can, so it
 * finishes even if the app closes; the caller saves the id and calls `resumeChat` later.
 */
export async function streamChat(req: ChatRequest): Promise<StreamResult> {
  const target = req.job && serverTarget(req.credentials)
  if (target) {
    const id = await startJob({ input: { ...target.where, model: req.model.id, messages: req.messages, reasoning: req.reasoning }, secrets: target.secrets }, req.signal)
    if (id) {
      req.job!.started(id)
      return followJob(id, req.events, req.signal)
    }
  }
  const stream = await client(req.credentials)
    .chat.completions.create(
      {
        model: req.model.id,
        messages: req.messages as OpenAI.Chat.ChatCompletionMessageParam[],
        stream: true,
        // A busy free model falls back to OpenRouter's free router instead of failing.
        ...freeFallback(req.model.id),
        // OpenRouter's reasoning control; models that don't reason ignore it.
        ...(req.reasoning ? { reasoning: { effort: "high" } } : {}),
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

/**
 * Picks up a reply that was running on the server (after the app was closed, say). It comes
 * from the start again, so `clear` is called to drop the partial copy first.
 */
export function resumeChat(id: string, credentials: Credentials, events: StreamEvents, signal: AbortSignal, clear: () => void) {
  return followJob(id, restartEvents(events, clear), signal)
}

/** OpenRouter's full model list from the last load, including image and audio models. */
export let lastOpenRouterModels: OpenRouterModel[] = []

/** Whether these are the user's own OpenRouter key, which can pay for any model. */
export const ownOpenRouterKey = (c?: Credentials) => !!c?.openrouterKey?.trim().startsWith("sk-or-")

/** Whether paid models can be used: the user's own key, or the site's key unlocked with the passcode. */
export const paidModels = (c?: Credentials) => ownOpenRouterKey(c) || !!c?.sitePass

/**
 * OpenRouter's chat models from its live list (needs no key): the free ones, and every other
 * one too when paid models are allowed.
 */
export async function listModels(credentials?: Credentials): Promise<ModelInfo[]> {
  const res = await fetch("/api/openrouter/v1/models")
  if (!res.ok) throw new Error(`Model list failed: ${res.status}`)
  const body = (await res.json()) as { data: OpenRouterModel[] }
  lastOpenRouterModels = body.data
  const models = filterOpenRouterModels(body.data, paidModels(credentials))
  if (models.length) listed = models
  return models
}

/**
 * What the site has set on Netlify: an OpenRouter key and a passcode for paid models; and
 * whether this device's pass (if any) is still good.
 */
export async function serverStatus(sitePass?: string) {
  try {
    const res = await fetch("/api/status", { headers: sitePass ? { "x-site-pass": sitePass } : {} })
    if (res.ok) {
      const body = (await res.json()) as { serverKey?: boolean; passcode?: boolean; paidUnlocked?: boolean }
      return { serverKey: !!body.serverKey, passcode: !!body.passcode, paidUnlocked: body.paidUnlocked === true, known: true }
    }
  } catch {
    // Offline: only keys entered in the app count.
  }
  return { serverKey: false, passcode: false, paidUnlocked: false, known: false }
}

/** Swaps the owner's passcode for this device's pass; throws with the server's reason. */
export async function unlockPaid(passcode: string) {
  const res = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) })
  const body = (await res.json().catch(() => ({}))) as { pass?: string; error?: { message?: string } }
  if (!res.ok || !body.pass) throw new Error(body.error?.message ?? `Couldn't unlock (${res.status}).`)
  return body.pass
}

export function errorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : String(error)
  if (error instanceof OpenAI.APIError || error instanceof JobError) {
    if (error instanceof OpenAI.APIError) {
      const body = error.error as { error?: { message?: string }; message?: string } | undefined
      message = body?.error?.message ?? body?.message ?? error.message
    }
    if (error.status === 401 && !/Settings/.test(message)) return "OpenRouter didn't accept the key. Check it in Settings → OpenRouter key."
    if (error.status === 402 || /insufficient credits|more credits/i.test(message))
      return "That model needs credit on the OpenRouter account. Add some at openrouter.ai → Credits, or pick a free model."
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
