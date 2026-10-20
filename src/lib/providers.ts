// Provider adapters, after the protocol split in opencode's packages/ai: each one turns a
// conversation into its API's request and normalizes the stream into StreamEvents.
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { anthropicMessages, openaiInput } from "./history"
import { filterOpenAIModels } from "./models"
import type { Conversation, Effort, ModelInfo, ModelRef, StreamEvents, StreamResult, Turn } from "./types"

export interface StreamRequest {
  conversation: Conversation
  history: Turn[]
  current: Turn
  model: ModelRef
  effort: Effort
  passcode: string
  signal: AbortSignal
  events: StreamEvents
}

function anthropicClient(passcode: string) {
  // The real key is added by the edge proxy; the SDK just needs a placeholder.
  return new Anthropic({
    baseURL: `${location.origin}/api/anthropic`,
    apiKey: "set-on-server",
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "x-app-passcode": passcode },
    maxRetries: 1,
  })
}

function openaiClient(passcode: string) {
  return new OpenAI({
    baseURL: `${location.origin}/api/openai/v1`,
    apiKey: "set-on-server",
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "x-app-passcode": passcode },
    maxRetries: 1,
  })
}

// Models that accept server-side refusal fallbacks ("default" routes by refusal category).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"])
// Models that take the dynamic-filtering web search tool; others use the basic one.
const DYNAMIC_SEARCH = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))/

async function streamAnthropic(req: StreamRequest): Promise<StreamResult> {
  const client = anthropicClient(req.passcode)
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
      tools: req.conversation.webSearch
        ? [DYNAMIC_SEARCH.test(model) ? { type: "web_search_20260209", name: "web_search" } : { type: "web_search_20250305", name: "web_search" }]
        : undefined,
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

const REASONING = /^(gpt-5|gpt-6|o\d)/

async function streamOpenAI(req: StreamRequest): Promise<StreamResult> {
  const client = openaiClient(req.passcode)
  const model = req.model.id
  const stream = await client.responses.create(
    {
      model,
      instructions: req.conversation.system || undefined,
      input: openaiInput(req.history, req.current, req.model) as unknown as OpenAI.Responses.ResponseInput,
      store: false,
      stream: true,
      tools: req.conversation.webSearch ? [{ type: "web_search" }] : undefined,
      reasoning: REASONING.test(model) && !model.includes("chat") ? { effort: req.effort } : undefined,
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
export async function listModels(passcode: string, providers: { anthropic: boolean; openai: boolean }) {
  const out: ModelInfo[] = []
  const [claude, gpt] = await Promise.allSettled([
    providers.anthropic ? anthropicClient(passcode).models.list({ limit: 50 }) : Promise.reject(),
    providers.openai ? openaiClient(passcode).models.list() : Promise.reject(),
  ])
  if (claude.status === "fulfilled")
    for (const m of claude.value.data)
      if (!/claude-(3|instant|2)/.test(m.id)) out.push({ provider: "anthropic", id: m.id, label: m.display_name })
  if (gpt.status === "fulfilled") out.push(...filterOpenAIModels(gpt.value.data))
  return out
}

export interface Status {
  anthropic: boolean
  openai: boolean
}

export async function checkStatus(passcode: string): Promise<Status> {
  const res = await fetch("/api/status", { headers: { "x-app-passcode": passcode } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message ?? `Server returned ${res.status}`)
  return body as Status
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
