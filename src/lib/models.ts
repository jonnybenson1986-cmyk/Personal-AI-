import type { ModelInfo, ModelRef } from "./types"

export const AUTO_MODEL = "openrouter/free"

// Shown before (or if) the live list loads. OpenRouter adds and retires free models often,
// so the live list is what the picker normally shows.
export const DEFAULT_MODELS: ModelInfo[] = [
  { id: AUTO_MODEL, label: "Auto (free)", hint: "Picks an available free model for each message", vision: true },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA Nemotron 3 Ultra" },
  { id: "google/gemma-4-31b-it:free", label: "Google Gemma 4 31B", vision: true },
  { id: "minimax/minimax-m3.1-flash:free", label: "MiniMax M3.1 Flash", vision: true },
  { id: "thinkingmachines/inkling:free", label: "Thinking Machines Inkling", vision: true },
]

export const DEFAULT_SELECTION: ModelRef[] = [{ id: AUTO_MODEL }]

export function sameModel(a: ModelRef, b: ModelRef) {
  return a.id === b.id
}

export function modelLabel(ref: ModelRef | string, known: ModelInfo[]) {
  const id = typeof ref === "string" ? ref : ref.id
  return known.find((m) => m.id === id)?.label ?? id.replace(/:free$/, "")
}

export interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number | null
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

// Classifiers and guard models aren't chat assistants.
const NOT_CHAT = /(safety|guard|moderation|embed|rerank)/i

const isFree = (m: OpenRouterModel) => m.id.endsWith(":free") && m.pricing?.prompt === "0" && m.pricing?.completion === "0"

/** Dollars per million tokens, from OpenRouter's per-token price; undefined if not a real price. */
function perMillion(price?: string) {
  const n = Number(price)
  if (price === undefined || !Number.isFinite(n) || n < 0) return undefined
  const m = n * 1e6
  return m >= 10 ? `$${Math.round(m)}` : `$${Number(m.toPrecision(2))}`
}

/**
 * The chat models from OpenRouter's model list: Auto first, then the free ones. With `paid`
 * (the user's own key, which pays for them) every other chat model follows, with its price.
 */
export function filterOpenRouterModels(list: OpenRouterModel[], paid = false): ModelInfo[] {
  const chat = list.filter(
    (m) =>
      !NOT_CHAT.test(m.id) &&
      (m.architecture?.input_modalities ?? ["text"]).includes("text") &&
      (m.architecture?.output_modalities ?? ["text"]).includes("text"),
  )
  const info = (m: OpenRouterModel, price?: string): ModelInfo => {
    const vision = !!m.architecture?.input_modalities?.includes("image")
    const context = m.context_length ? `${Math.round(m.context_length / 1000)}K context` : undefined
    return {
      id: m.id,
      ...(m.context_length ? { context: m.context_length } : {}),
      label: (m.name ?? m.id).replace(/\s*\(free\)\s*$/i, "").replace(/:\s+/, " ").replace(/\s+/g, " "),
      hint: [price, vision ? "Sees images" : undefined, context].filter(Boolean).join(" · ") || undefined,
      vision,
      ...(price ? { paid: true } : {}),
    }
  }
  const byLabel = (a: ModelInfo, b: ModelInfo) => a.label.localeCompare(b.label)
  const free = chat.filter(isFree).map((m) => info(m)).sort(byLabel)
  if (!free.length) return []
  const others = paid
    ? chat
        .filter((m) => !isFree(m) && m.id !== AUTO_MODEL)
        .flatMap((m) => {
          const input = perMillion(m.pricing?.prompt)
          const output = perMillion(m.pricing?.completion)
          return input && output ? [info(m, `${input} in / ${output} out per M tokens`)] : []
        })
        .sort(byLabel)
    : []
  return [DEFAULT_MODELS[0], ...free, ...others]
}

/** The free chat models from OpenRouter's model list, Auto first. */
export const filterFreeModels = (list: OpenRouterModel[]) => filterOpenRouterModels(list)

const windows = new Map<string, number>()
/** Keeps the context windows from the last model list loaded, to fit long chats to them. */
export function rememberWindows(models: ModelInfo[]) {
  for (const m of models) if (m.context) windows.set(m.id, m.context)
}
export const contextWindow = (id: string) => windows.get(id)
