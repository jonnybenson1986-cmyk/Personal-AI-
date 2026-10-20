import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

export interface Credentials {
  passcode: string
  anthropicKey: string
  openaiKey: string
}

// Requests go through the edge proxy. With a key from Settings the SDK sends it and the proxy
// passes it on; without one, the placeholder asks the proxy to use the server's key.
const PLACEHOLDER_KEY = "set-on-server"

export function anthropicClient(c: Credentials) {
  return new Anthropic({
    baseURL: `${location.origin}/api/anthropic`,
    apiKey: c.anthropicKey.trim() || PLACEHOLDER_KEY,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "x-app-passcode": c.passcode },
    maxRetries: 1,
  })
}

export function openaiClient(c: Credentials) {
  return new OpenAI({
    baseURL: `${location.origin}/api/openai/v1`,
    apiKey: c.openaiKey.trim() || PLACEHOLDER_KEY,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "x-app-passcode": c.passcode },
    maxRetries: 1,
  })
}

// Models that accept server-side refusal fallbacks ("default" routes by refusal category).
export const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"])
// Models that take the dynamic-filtering web search tool; others use the basic one.
const DYNAMIC_SEARCH = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))/

export function claudeWebSearch(model: string) {
  return DYNAMIC_SEARCH.test(model)
    ? ({ type: "web_search_20260209", name: "web_search" } as const)
    : ({ type: "web_search_20250305", name: "web_search" } as const)
}

export const OPENAI_REASONING = /^(gpt-5|gpt-6|o\d)/
export const openaiReasons = (model: string) => OPENAI_REASONING.test(model) && !model.includes("chat")
