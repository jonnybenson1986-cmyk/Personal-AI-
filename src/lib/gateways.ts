// The OpenAI-compatible gateways the app knows how to talk to, and what each one offers.
// Every gateway is reached the same way (route.ts); this only decides labels, defaults and
// which extra features to show, so one place replaces checks scattered across the app.
import { gatewayRoute } from "./route.ts"

export type GatewayKind = "omniroute" | "freellmapi" | "cheaper" | "custom"

export interface GatewayPreset {
  kind: GatewayKind
  label: string
  /** Filled in when the preset is picked; blank means "type your own" (or the site's own OmniRoute). */
  url: string
  urlHint: string
  keyPlaceholder: string
  keyHint: string
  /** The setting that lets this site call it straight from the browser (a local address). */
  corsEnv?: string
  /** OmniRoute's own tools: web search, page reading, OCR, music and usage. */
  omniTools: boolean
  /** OmniRoute's auto/coding, auto/fast… modes, shown in the picker even if the list omits them. */
  routingModes: boolean
  /** Has an `auto` model that picks for each message, offered before the list loads. */
  auto: boolean
}

export const CHEAPER_INFERENCE_URL = "https://api.cheaperinference.com/v1"

export const GATEWAYS: Record<GatewayKind, GatewayPreset> = {
  omniroute: {
    kind: "omniroute",
    label: "OmniRoute",
    url: "",
    urlHint:
      "From your phone: turn on the Cloudflare tunnel in OmniRoute's Dashboard → Endpoints and paste its https address. On the computer running it: http://localhost:20128.",
    keyPlaceholder: "Your OmniRoute key",
    keyHint: "OmniRoute Dashboard → Endpoints → copy an API key. Saved only on this device.",
    corsEnv: "CORS_ALLOWED_ORIGINS",
    omniTools: true,
    routingModes: true,
    auto: true,
  },
  freellmapi: {
    kind: "freellmapi",
    label: "FreeLLMAPI",
    url: "http://localhost:3001",
    urlHint:
      "On the computer running it: http://localhost:3001. From your phone, put it behind an https tunnel (for example cloudflared tunnel --url http://localhost:3001) and paste that address.",
    keyPlaceholder: "freellmapi-…",
    keyHint: "Its dashboard (http://localhost:3001) → Keys: the unified key in the page header. Saved only on this device.",
    corsEnv: "DASHBOARD_ORIGINS",
    omniTools: false,
    routingModes: false,
    auto: true,
  },
  cheaper: {
    kind: "cheaper",
    label: "Cheaper Inference",
    url: CHEAPER_INFERENCE_URL,
    urlHint: "",
    keyPlaceholder: "Your Cheaper Inference API key",
    keyHint: "Create a key in your Cheaper Inference account. Saved only on this device and sent through this site's proxy to the provider.",
    omniTools: false,
    routingModes: false,
    auto: false,
  },
  custom: {
    kind: "custom",
    label: "Other",
    url: "",
    urlHint: "Any OpenAI-compatible API (LiteLLM, vLLM, Ollama, LM Studio…): the address that serves /v1/chat/completions.",
    keyPlaceholder: "API key",
    keyHint: "Saved only on this device.",
    omniTools: false,
    routingModes: false,
    auto: false,
  },
}

/**
 * Which gateway an address is: Cheaper Inference by its host, otherwise the one picked in
 * Settings. Addresses saved before presets existed count as OmniRoute, as they always have.
 */
export function gatewayKind(url: string, chosen?: GatewayKind): GatewayKind {
  if (gatewayRoute(url)?.base === "https://api.cheaperinference.com") return "cheaper"
  if (chosen === "cheaper") return "custom"
  return chosen && chosen in GATEWAYS ? chosen : "omniroute"
}

export const gatewayPreset = (url: string, chosen?: GatewayKind) => GATEWAYS[gatewayKind(url, chosen)]
