// Calls to the user's OmniRoute gateway for the Omni tools: web search, reading pages,
// video, music, OCR and usage. Public https gateways go through the site's proxy (and slow
// requests run as server jobs, so they finish even if the app closes); local ones are called
// straight from the browser.
import { followJob, startJob } from "./jobs"
import { gatewayFor, gatewayReady } from "./route"
import { settings } from "./store"
import type { StreamEvents } from "./types"

export class OmniError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

/** Whether OmniRoute can be used: an address and key, or the site's own (it needn't be the chat provider). */
export const omniConfigured = () => gatewayReady(settings.omnirouteUrl, settings.omnirouteKey)

function route() {
  const r = gatewayFor(settings.omnirouteUrl)
  if (!r || !omniConfigured()) throw new OmniError("Connect OmniRoute first: add its address and API key under Set up.")
  return r
}

async function errorFrom(res: Response) {
  const text = await res.text().catch(() => "")
  let message = text.slice(0, 300)
  try {
    const body = JSON.parse(text)
    message = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : message)
  } catch {
    // Plain text.
  }
  if (res.status === 401) message = "OmniRoute didn't accept the API key. Check it under Set up."
  return new OmniError(message || `OmniRoute answered ${res.status}.`, res.status)
}

/** A request to OmniRoute, through the site's proxy or straight to a local one. */
export async function omniFetch(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const r = route()
  // The site's own gateway (no base) gets its address and key on the server.
  const headers: Record<string, string> = r.base ? { authorization: `Bearer ${settings.omnirouteKey.trim()}` } : {}
  if (init.body !== undefined) headers["content-type"] = "application/json"
  if (r.mode === "proxy" && r.base) headers["x-omniroute-url"] = r.base
  let res: Response
  try {
    res = await fetch(r.mode === "proxy" ? `/api/omniroute${path}` : r.base + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    })
  } catch (e) {
    if (init.signal?.aborted) throw e
    throw new OmniError(
      r.mode === "direct"
        ? `Couldn't reach OmniRoute at ${r.base}. Check it's running and allows this site: CORS_ALLOWED_ORIGINS=${location.origin}`
        : "Couldn't reach the server. Check your connection.",
    )
  }
  if (!res.ok) throw await errorFrom(res)
  return res
}

const quiet: StreamEvents = { text: () => {}, thinking: () => {}, servedBy: () => {} }

/**
 * A slow request (video, music…). Through the proxy it runs as a server job when it can, so
 * it carries on if the app closes; `onJob` gets the id to save for picking it up later.
 */
export async function omniRun(path: string, body: Record<string, unknown>, signal?: AbortSignal, onJob?: (id: string) => void): Promise<unknown> {
  const r = route()
  if (r.mode === "proxy" && settings.background !== false) {
    const id = await startJob(
      { input: { provider: "omniroute", model: String(body.model ?? ""), messages: [], omnirouteUrl: r.base || undefined, request: { path, body } }, secrets: r.base ? { omnirouteKey: settings.omnirouteKey.trim() } : {} },
      signal,
    )
    if (id) {
      onJob?.(id)
      return (await followJob(id, quiet, signal ?? new AbortController().signal)).result
    }
  }
  return (await omniFetch(path, { body, signal })).json()
}

/** Picks up a slow request that kept running on the server. */
export async function resumeOmni(id: string, signal: AbortSignal) {
  return (await followJob(id, quiet, signal)).result
}

/** Checks the connection: how many models, and OmniRoute's version. */
export async function omniStatus() {
  const res = await omniFetch("/v1/models")
  const body = (await res.json()) as { data?: unknown[] }
  return { models: body.data?.length ?? 0, version: res.headers.get("x-omniroute-version") ?? undefined }
}

/** Model ids of one kind ("video", "music", "image"…) from OmniRoute's catalog. */
export async function omniModels(kind: string) {
  const res = await omniFetch(`/v1/models?kind=${encodeURIComponent(kind)}`).catch(() => undefined)
  if (!res) return []
  const body = (await res.json()) as { data?: { id?: string; type?: string }[] }
  return (body.data ?? [])
    .filter((m) => typeof m.id === "string" && (!m.type || m.type === kind))
    .map((m) => m.id!)
    .sort()
}

export const webSearch = (query: string, opts: { type?: "web" | "news"; max?: number } = {}, signal?: AbortSignal) =>
  omniRun("/v1/search", { query, max_results: opts.max ?? 8, search_type: opts.type ?? "web" }, signal)

export async function readPage(url: string, signal?: AbortSignal) {
  const r = (await omniRun("/v1/web/fetch", { url, format: "markdown", include_metadata: true }, signal)) as {
    content?: string
    metadata?: { title?: string | null } | null
  }
  return { title: r?.metadata?.title ?? url, text: r?.content ?? "" }
}

export const makeVideo = (prompt: string, model: string, signal?: AbortSignal, onJob?: (id: string) => void) =>
  omniRun("/v1/videos/generations", { model, prompt }, signal, onJob)

export const makeMusic = (prompt: string, model: string, seconds: number, instrumental: boolean, signal?: AbortSignal, onJob?: (id: string) => void) =>
  omniRun("/v1/music/generations", { model, prompt, duration: seconds, instrumental }, signal, onJob)

function dataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Reads the text in a PDF or picture (OmniRoute's OCR; Mistral OCR unless a model is named). */
export async function readDocument(file: Blob, model?: string, signal?: AbortSignal, onJob?: (id: string) => void) {
  if (file.size > 6 * 1024 * 1024) throw new OmniError("That file is too big to read here (6 MB at most).")
  const url = await dataUrl(file)
  const document = file.type === "application/pdf" ? { type: "document_url", document_url: url } : { type: "image_url", image_url: url }
  return omniRun("/v1/ocr", { ...(model ? { model } : {}), document }, signal, onJob)
}

/** The API key's own usage. Needs "allow usage" on the key in OmniRoute's dashboard. */
export async function omniUsage() {
  try {
    return await (await omniFetch("/api/usage/om-usage?format=json")).json()
  } catch (e) {
    if (e instanceof OmniError && e.status === 403) return { allowed: false, error: { message: "Turn on usage for this key in OmniRoute: Dashboard → API Keys." } }
    throw e
  }
}
