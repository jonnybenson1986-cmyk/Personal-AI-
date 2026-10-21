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
  architecture?: { input_modalities?: string[] }
}

// Classifiers and guard models aren't chat assistants.
const NOT_CHAT = /(safety|guard|moderation|embed|rerank)/i

/** The free chat models from OpenRouter's model list, Auto first. */
export function filterFreeModels(list: OpenRouterModel[]): ModelInfo[] {
  const free = list
    .filter((m) => m.id.endsWith(":free") && m.pricing?.prompt === "0" && m.pricing?.completion === "0")
    .filter((m) => !NOT_CHAT.test(m.id) && (m.architecture?.input_modalities ?? ["text"]).includes("text"))
    .map((m): ModelInfo => {
      const vision = !!m.architecture?.input_modalities?.includes("image")
      const context = m.context_length ? `${Math.round(m.context_length / 1000)}K context` : undefined
      return {
        id: m.id,
        label: (m.name ?? m.id).replace(/\s*\(free\)\s*$/i, "").replace(/:\s+/, " ").replace(/\s+/g, " "),
        hint: [vision ? "Sees images" : undefined, context].filter(Boolean).join(" · ") || undefined,
        vision,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  return free.length ? [DEFAULT_MODELS[0], ...free] : []
}
