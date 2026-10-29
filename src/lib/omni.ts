// OmniRoute (github.com/diegosouzapw/OmniRoute, MIT): what you need to run it, its routing
// modes, and small helpers for its answers. Pure data and functions, unit tested; the network
// calls are in omniapi.ts. Everything here comes from OmniRoute's own documentation.

export const OMNI_PORT = 20128
export const OMNI_LOCAL = `http://localhost:${OMNI_PORT}`
export const OMNI_REPO = "https://github.com/diegosouzapw/OmniRoute"
export const OMNI_SITE = "https://www.omniroute.online"

export interface SetupStep {
  title: string
  text?: string
  /** Commands to copy, one per line. */
  code?: string
}

export interface SetupOption {
  id: string
  label: string
  hint: string
  steps: SetupStep[]
}

/** Ways to install and run OmniRoute (Node 22 or 24+ is required for npm installs). */
export const SETUP_OPTIONS: SetupOption[] = [
  {
    id: "computer",
    label: "Computer",
    hint: "Windows, Mac or Linux with Node.js",
    steps: [
      { title: "Install Node.js 22 or newer", text: "From nodejs.org, if you don't have it. Check with:", code: "node --version" },
      { title: "Install OmniRoute", code: "npm install -g omniroute" },
      { title: "Start it", text: `The dashboard opens at ${OMNI_LOCAL}/dashboard.`, code: "omniroute" },
    ],
  },
  {
    id: "android",
    label: "Android phone",
    hint: "Runs in Termux, no root needed",
    steps: [
      { title: "Install Termux", text: "From F-Droid or Termux's GitHub releases (not the Play Store version)." },
      { title: "Install Node.js and build tools", code: "pkg update && pkg upgrade\npkg install nodejs python build-essential git" },
      { title: "Install and start OmniRoute", text: `Then open ${OMNI_LOCAL} in the phone's browser.`, code: "npm install -g omniroute\nomniroute" },
      { title: "Keep it running in the background (optional)", code: "nohup omniroute > omniroute.log 2>&1 &" },
    ],
  },
  {
    id: "docker",
    label: "Docker",
    hint: "A server, NAS or cloud machine",
    steps: [
      { title: "Run the container", text: "Works on Intel/AMD and ARM machines.", code: `docker run -d --name omniroute -p ${OMNI_PORT}:${OMNI_PORT} diegosouzapw/omniroute:latest` },
      { title: "Open the dashboard", text: `http://<that machine's address>:${OMNI_PORT}/dashboard` },
    ],
  },
  {
    id: "source",
    label: "From source",
    hint: "For developers",
    steps: [{ title: "Clone and run", code: "git clone https://github.com/diegosouzapw/OmniRoute.git\ncd OmniRoute\nnpm install\nnpm run dev" }],
  },
]

/** After installing: the same on every device. */
export function connectSteps(origin: string): SetupStep[] {
  return [
    {
      title: "Connect AI providers",
      text: "In the dashboard, open Providers and connect a few. Free ones are listed below. OmniRoute switches between them automatically when one is busy or out of quota.",
    },
    {
      title: "Create an API key",
      text: `Dashboard → API Keys (${OMNI_LOCAL}/dashboard/api-manager) → new key. Copy it straight away: it's only shown once. To see usage here too, turn on "allow usage" for the key.`,
    },
    {
      title: "Make it reachable from this app",
      text: "Anywhere (phone, other networks): Dashboard → Endpoints → turn on Cloudflare Quick Tunnel and copy its https://….trycloudflare.com address. It changes each time OmniRoute restarts. Only on the computer running OmniRoute: use the local address, and start OmniRoute so it allows this site:",
      code: `CORS_ALLOWED_ORIGINS=${origin} omniroute`,
    },
    { title: "Connect it below", text: "Paste the address and key, then Test connection. Chat, Code, Design, Cowork, Photo, Audio and the Omni tools then use it." },
  ]
}

export interface FreeProvider {
  name: string
  free: string
  connect: string
}

/** Representative free-access providers from OmniRoute's Free Tiers Guide. Limits change; check each provider's terms. */
export const FREE_PROVIDERS: FreeProvider[] = [
  { name: "Gemini", free: "Recurring free quota (rate limits vary)", connect: "Google AI Studio API key" },
  { name: "Groq", free: "~15M tokens a month", connect: "Groq API key" },
  { name: "Cloudflare Workers AI", free: "Daily free allowance (~30M tokens a month)", connect: "Cloudflare account and API token" },
  { name: "GitHub Models", free: "~18M tokens a month", connect: "GitHub token" },
  { name: "Mistral", free: "Free tier with a monthly allowance", connect: "Mistral API key" },
  { name: "Pollinations", free: "Keyless, rate limited", connect: "Nothing to set up" },
  { name: "OpenRouter free models", free: "Shared, request limited", connect: "OpenRouter API key" },
  { name: "Hugging Face", free: "Small monthly allowance", connect: "Hugging Face token" },
  { name: "DeepSeek", free: "5M tokens once, on signup", connect: "DeepSeek API key" },
  { name: "Ollama / LM Studio", free: "Unlimited, runs on your own computer", connect: "Local address" },
]

/** OmniRoute's built-in routing modes. */
export const ROUTING_MODES: { id: string; label: string; hint: string }[] = [
  { id: "auto", label: "Auto (OmniRoute picks)", hint: "Balances speed, cost, quality and availability" },
  { id: "auto/coding", label: "Auto · best for code", hint: "Models that are good at writing and fixing code" },
  { id: "auto/fast", label: "Auto · fastest", hint: "Quickest answer, lowest latency" },
  { id: "auto/cheap", label: "Auto · cheapest", hint: "Lowest cost first" },
  { id: "auto/smart", label: "Auto · smartest", hint: "Quality first, sometimes tries new models" },
  { id: "auto/offline", label: "Auto · most available", hint: "Providers with the most quota left, for busy times" },
]

/** "strategy=auto; provider=groq; latency_ms=812" → { strategy: "auto", provider: "groq", latencyMs: 812 } */
export function parseDecision(raw: string | undefined) {
  if (!raw) return undefined
  const fields = Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.split("=").map((s) => s.trim()))
      .filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0] && !!kv[1]),
  )
  if (!fields.provider) return undefined
  const latency = Number(fields.latency_ms)
  return { strategy: fields.strategy as string | undefined, provider: fields.provider as string, latencyMs: Number.isFinite(latency) ? latency : undefined }
}

/** A short label for a routing decision, like "via groq · 0.8 s". */
export function decisionLabel(raw: string | undefined) {
  const d = parseDecision(raw)
  if (!d) return undefined
  const time = d.latencyMs === undefined ? "" : d.latencyMs < 1000 ? ` · ${d.latencyMs} ms` : ` · ${(d.latencyMs / 1000).toFixed(1)} s`
  return `via ${d.provider}${time}`
}

export interface MediaItem {
  b64_json?: string
  url?: string
  format?: string
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  png: "image/png",
}

/** The MIME type for a generated file's format ("mp4", "wav"…). */
export const mediaType = (format: string | undefined, fallback: string) => MEDIA_TYPES[(format ?? "").toLowerCase()] ?? fallback

/** The generated items of a video/music/image answer: `{ data: [{ b64_json | url, format }] }`. */
export function mediaItems(result: unknown): MediaItem[] {
  const data = (result as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data.filter((d): d is MediaItem => !!d && typeof d === "object" && (typeof d.b64_json === "string" || typeof d.url === "string"))
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
  published?: string
}

/** Results of POST /v1/search: `{ results: [{ title, url, snippet, … }], answer? }`. */
export function searchHits(result: unknown): { hits: SearchHit[]; answer?: string; provider?: string } {
  const r = result as { results?: unknown; answer?: { text?: string | null } | null; provider?: string } | undefined
  const hits = (Array.isArray(r?.results) ? r!.results : [])
    .filter((x): x is { title?: string; url: string; snippet?: string; published_at?: string | null } => !!x && typeof (x as { url?: unknown }).url === "string")
    .map((x) => ({ title: x.title || x.url, url: x.url, snippet: x.snippet ?? "", published: x.published_at ?? undefined }))
  return { hits, answer: r?.answer?.text ?? undefined, provider: r?.provider }
}

/** Text of an OCR answer: `{ pages: [{ index, markdown }] }`. */
export function ocrText(result: unknown) {
  const pages = (result as { pages?: { index?: number; markdown?: string }[] })?.pages
  if (!Array.isArray(pages)) return ""
  return pages.map((p, i) => (pages.length > 1 ? `## Page ${(p.index ?? i) + 1}\n\n` : "") + (p.markdown ?? "").trim()).join("\n\n")
}

/** The parts of the usage answer (`/api/usage/om-usage?format=json`) worth showing. */
export function usageSummary(result: unknown) {
  const r = result as {
    allowed?: boolean
    error?: { message?: string }
    personal?: { dailySpentUsd?: number; dailyLimitUsd?: number; weeklySpentUsd?: number; weeklyLimitUsd?: number }
    providers?: { provider?: string; plan?: string }[]
  }
  if (!r || r.allowed === false) return { allowed: false as const, message: r?.error?.message }
  const money = (n: number | undefined) => (typeof n === "number" ? `$${n.toFixed(2)}` : undefined)
  const lines: string[] = []
  const p = r.personal
  if (p?.dailySpentUsd !== undefined) lines.push(`Today: ${money(p.dailySpentUsd)}${p.dailyLimitUsd ? ` of ${money(p.dailyLimitUsd)}` : ""}`)
  if (p?.weeklySpentUsd !== undefined) lines.push(`This week: ${money(p.weeklySpentUsd)}${p.weeklyLimitUsd ? ` of ${money(p.weeklyLimitUsd)}` : ""}`)
  const providers = (r.providers ?? []).map((x) => [x.provider, x.plan].filter(Boolean).join(" · ")).filter(Boolean)
  return { allowed: true as const, lines, providers }
}
