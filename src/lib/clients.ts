import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

// The real keys are added by the edge proxy; the SDKs just need a placeholder.
export function anthropicClient(passcode: string) {
  return new Anthropic({
    baseURL: `${location.origin}/api/anthropic`,
    apiKey: "set-on-server",
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "x-app-passcode": passcode },
    maxRetries: 1,
  })
}

export function openaiClient(passcode: string) {
  return new OpenAI({
    baseURL: `${location.origin}/api/openai/v1`,
    apiKey: "set-on-server",
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "x-app-passcode": passcode },
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
