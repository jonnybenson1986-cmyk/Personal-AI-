// Provider adapters, after the protocol split in opencode's packages/ai: each one turns a
// conversation into its API's request and normalizes the stream into StreamEvents.
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { anthropicClient, claudeWebSearch, type Credentials, FALLBACK_MODELS, openaiClient, openaiReasons } from "./clients"
import { anthropicMessages, openaiInput } from "./history"
import { filterOpenAIModels } from "./models"
import type { Conversation, Effort, ModelInfo, ModelRef, StreamEvents, StreamResult, Turn } from "./types"

export type { Credentials }

export interface StreamRequest {
  conversation: Conversation
  history: Turn[]
  current: Turn
  model: ModelRef
  effort: Effort
  credentials: Credentials
  signal: AbortSignal
  events: StreamEvents
}

async function streamAnthropic(req: StreamRequest): Promise<StreamResult> {
  const client = anthropicClient(req.credentials)
  const model = req.model.id
  const fallback = FALLBACK_MODELS.has(model)
  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 64000,
      system: req.conversation.system || undefined,
      messages: anthropicMessages(req.history, req.current, req.model) as unknown as Anthropic.Beta.BetaMessageParam[],
      // Summarized thinking is shown in the UI. drop_block keeps a chat going if an earlier
      // thinking block can no longer be verified (for example after switching models).
      thinking: { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: req.effort },
      tools: req.conversation.webSearch ? [claudeWebSearch(model)] : undefined,
      betas: ["thinking-binding-controls-2026-08-01", ...(fallback ? ["server-side-fallback-2026-07-01"] : [])],
      ...(fallback ? { fallbacks: "default" as const } : {}),
    },
    { signal: req.signal },
  )

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block
      if (block.type === "server_tool_use") req.events.activity("Searching the web")
      if (block.type === "web_search_tool_result") {
        req.events.activity(undefined)
        if (Array.isArray(block.content)) for (const r of block.content) req.events.source({ url: r.url, title: r.title })
      }
      if (block.type === "text") req.events.activity(undefined)
    }
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") req.events.text(event.delta.text)
      if (event.delta.type === "thinking_delta") req.events.thinking(event.delta.thinking)
    }
  }

  const message = await stream.finalMessage()
  if (message.stop_reason === "refusal") return { notice: "Claude declined to respond to this request." }
  if (message.stop_reason === "max_tokens") return { raw: message.content, notice: "The response hit the length limit." }
  return { raw: message.content }
}

async function streamOpenAI(req: StreamRequest): Promise<StreamResult> {
  const client = openaiClient(req.credentials)
  const model = req.model.id
  const stream = await client.responses.create(
    {
      model,
      instructions: req.conversation.system || undefined,
      input: openaiInput(req.history, req.current, req.model) as unknown as OpenAI.Responses.ResponseInput,
      store: false,
      stream: true,
      tools: req.conversation.webSearch ? [{ type: "web_search" }] : undefined,
      reasoning: openaiReasons(model) ? { effort: req.effort } : undefined,
    },
    { signal: req.signal },
  )

  let notice: string | undefined
  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        req.events.activity(undefined)
        req.events.text(event.delta)
        break
      case "response.reasoning_summary_text.delta":
        req.events.thinking(event.delta)
        break
      case "response.web_search_call.searching":
        req.events.activity("Searching the web")
        break
      case "response.output_text.annotation.added": {
        const a = event.annotation
        if (a?.type === "url_citation") req.events.source({ url: a.url, title: a.title })
        break
      }
      case "response.refusal.delta":
        req.events.text(event.delta)
        break
      case "response.incomplete":
        notice = "The response was cut short."
        break
      case "response.failed":
        throw new Error(event.response.error?.message ?? "The response failed.")
      case "error":
        throw new Error(event.message)
    }
  }
  return { notice }
}

export function streamReply(req: StreamRequest) {
  return req.model.provider === "anthropic" ? streamAnthropic(req) : streamOpenAI(req)
}

/** Live model lists from both APIs; either may fail if its key isn't configured. */
export async function listModels(credentials: Credentials, providers: Status) {
  const out: ModelInfo[] = []
  const [claude, gpt] = await Promise.allSettled([
    providers.anthropic ? anthropicClient(credentials).models.list({ limit: 50 }) : Promise.reject(),
    providers.openai ? openaiClient(credentials).models.list() : Promise.reject(),
  ])
  if (claude.status === "fulfilled")
    for (const m of claude.value.data)
      if (!/claude-(3|instant|2)/.test(m.id)) out.push({ provider: "anthropic", id: m.id, label: m.display_name })
  if (gpt.status === "fulfilled") out.push(...filterOpenAIModels(gpt.value.data))
  return out
}

/** Which providers the app can use right now. */
export interface Status {
  anthropic: boolean
  openai: boolean
}

export interface ServerStatus extends Status {
  passcodeSet: boolean
  unlocked: boolean
}

export async function serverStatus(passcode: string): Promise<ServerStatus> {
  try {
    const res = await fetch("/api/status", { headers: { "x-app-passcode": passcode } })
    if (res.ok) return (await res.json()) as ServerStatus
  } catch {
    // Offline: only keys entered in the app count.
  }
  return { anthropic: false, openai: false, passcodeSet: false, unlocked: false }
}

/** A provider works with a key from Settings, or with the server's key behind its passcode. */
export function availability(credentials: Credentials, server: ServerStatus): Status {
  return {
    anthropic: !!credentials.anthropicKey.trim() || (server.anthropic && server.unlocked),
    openai: !!credentials.openaiKey.trim() || (server.openai && server.unlocked),
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    const body = error.error as { error?: { message?: string }; message?: string } | undefined
    return body?.error?.message ?? body?.message ?? error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function isAbort(error: unknown) {
  return (
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof DOMException && error.name === "AbortError")
  )
}
