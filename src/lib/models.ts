import type { ModelInfo, ModelRef, ProviderId } from "./types"

export const PROVIDER_NAME: Record<ProviderId, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
}

// Shown before (or if) the live model lists load from each API.
export const DEFAULT_MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Most capable for everyday work" },
  { provider: "anthropic", id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Fast and capable" },
  { provider: "anthropic", id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest, lowest cost" },
  { provider: "anthropic", id: "claude-fable-5-1", label: "Claude Fable 5.1", hint: "Deepest reasoning, premium price" },
  { provider: "openai", id: "gpt-5.5", label: "GPT-5.5" },
  { provider: "openai", id: "gpt-5", label: "GPT-5" },
  { provider: "openai", id: "gpt-5-mini", label: "GPT-5 mini" },
]

export const DEFAULT_SELECTION: ModelRef[] = [{ provider: "anthropic", id: "claude-opus-5-5" }]

export function sameModel(a: ModelRef, b: ModelRef) {
  return a.provider === b.provider && a.id === b.id
}

export function modelLabel(ref: ModelRef, known: ModelInfo[]) {
  return known.find((m) => sameModel(m, ref))?.label ?? ref.id
}

/** Turns an OpenAI model id into a readable label: "gpt-5-mini" -> "GPT-5 mini". */
export function openaiLabel(id: string) {
  const [head, ...rest] = id.split("-")
  if (head !== "gpt") return id
  const version = rest.shift() ?? ""
  return [`GPT-${version}`, ...rest].join(" ")
}

const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/
const OPENAI_SKIP = /(audio|tts|transcribe|realtime|image|search|embedding|instruct|moderation|codex|\d{4}-\d{2}-\d{2})/

/** Picks the chat models out of OpenAI's full model list, newest first. */
export function filterOpenAIModels(list: { id: string; created: number }[]) {
  return list
    .filter((m) => OPENAI_CHAT.test(m.id) && !OPENAI_SKIP.test(m.id))
    .sort((a, b) => b.created - a.created)
    .slice(0, 14)
    .map((m): ModelInfo => ({ provider: "openai", id: m.id, label: openaiLabel(m.id) }))
}
