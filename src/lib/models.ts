import type { ModelInfo, ModelRef } from "./types"
import { ROUTING_MODES } from "./omni.ts"

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

/** OmniRoute's own router: picks a model from your connected providers for each request. */
export const GATEWAY_AUTO = "auto"

export interface GatewayModel {
  id: string
  type?: string
  subtype?: string
  display_name?: string
  owned_by?: string
  context_length?: number
  input_modalities?: string[]
  capabilities?: { vision?: boolean }
}

// Image, audio, embedding and similar models can't chat.
const NOT_GATEWAY_CHAT = new Set(["embedding", "image", "rerank", "audio", "moderation", "video", "music", "tts", "stt"])

/** The chat models (and combos) from an OpenAI-compatible gateway's model list, auto first. */
export function filterGatewayModels(list: GatewayModel[]): ModelInfo[] {
  const models = list
    .filter((m) => typeof m.id === "string" && (!m.type || !NOT_GATEWAY_CHAT.has(m.type)))
    .map((m): ModelInfo => {
      const vision = m.capabilities?.vision === true || !!m.input_modalities?.includes("image")
      const context = m.context_length ? `${Math.round(m.context_length / 1000)}K context` : undefined
      const kind = m.owned_by === "combo" ? "Combo" : undefined
      return {
        id: m.id,
        label: m.id === GATEWAY_AUTO ? "Auto (OmniRoute picks)" : (m.display_name ?? m.id),
        hint: m.id === GATEWAY_AUTO ? "Routes each message across your connected providers" : [kind, vision ? "Sees images" : undefined, context].filter(Boolean).join(" · ") || undefined,
        vision,
      }
    })
  // OmniRoute's routing modes always come first, with plain names, even if the list omits them.
  const modes: ModelInfo[] = ROUTING_MODES.map((m) => ({ id: m.id, label: m.label, hint: m.hint, vision: models.find((x) => x.id === m.id)?.vision }))
  const auto = models.filter((m) => (m.id === GATEWAY_AUTO || m.id.startsWith(`${GATEWAY_AUTO}/`)) && !ROUTING_MODES.some((r) => r.id === m.id))
  const rest = models.filter((m) => !auto.includes(m) && !ROUTING_MODES.some((r) => r.id === m.id)).sort((a, b) => a.label.localeCompare(b.label))
  return [...modes, ...auto, ...rest]
}

/** The gateway's image, speech (text to voice) and transcription models. */
export function gatewayMediaModels(list: GatewayModel[]) {
  const ids = (fn: (m: GatewayModel) => boolean) => list.filter(fn).map((m) => m.id).sort()
  return {
    image: ids((m) => m.type === "image"),
    speech: ids((m) => (m.type === "audio" && m.subtype === "speech") || m.type === "tts"),
    transcription: ids((m) => (m.type === "audio" && m.subtype !== "speech") || m.type === "stt"),
  }
}
