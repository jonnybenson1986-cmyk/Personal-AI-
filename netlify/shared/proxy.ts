// The edge proxy between the app and OpenRouter. The browser uses the `openai` SDK pointed
// here. A key the user entered in the app is passed straight through. The site's own key
// (OPENROUTER_API_KEY) is only ever used for free models, so it can't run up a bill.

export interface Upstream {
  /** Public prefix the edge function is mounted on. */
  prefix: string
  origin: string
  /** Paths (after the prefix) this proxy is willing to forward, keyed by method. */
  allow: Record<string, RegExp[]>
  /** Paths that work without any key. */
  open: RegExp[]
  /** Request headers copied from the browser to the upstream. */
  forward: string[]
  keyEnv: string
}

/** What the SDK sends when the app has no key of its own and relies on the server's. */
export const PLACEHOLDER_KEY = "set-on-server"

const RESPONSE_HEADERS = ["content-type", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "cache-control"]

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}

/** Free models end in ":free"; openrouter/free routes to one of them. */
export function isFreeModel(id: unknown) {
  return typeof id === "string" && (id.endsWith(":free") || id === "openrouter/free")
}

/** Why a request may not use the site's key, if it may not. */
export function paidFeature(body: ArrayBuffer) {
  let request: Record<string, unknown>
  try {
    request = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return "Invalid request."
  }
  if (!isFreeModel(request.model)) return "The site's key only works with free models."
  if (Array.isArray(request.models) && !request.models.every(isFreeModel)) return "The site's key only works with free models."
  // Plugins such as web search are billed even on free models.
  if (request.plugins !== undefined) return "The site's key can't use paid plugins."
  return undefined
}

function userKey(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  return key && key !== PLACEHOLDER_KEY && key.startsWith("sk-or-") ? key : undefined
}

export async function proxy(req: Request, upstream: Upstream, env: (name: string) => string | undefined) {
  const url = new URL(req.url)
  const path = url.pathname.slice(upstream.prefix.length)
  const rules = upstream.allow[req.method] ?? []
  if (!rules.some((rule) => rule.test(path))) return json(404, { error: { message: `Not allowed: ${req.method} ${path}` } })

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer()
  let key = userKey(req)
  if (!key && !upstream.open.some((rule) => rule.test(path))) {
    key = env(upstream.keyEnv)
    if (!key) return json(401, { error: { message: "Add your free OpenRouter key in Settings to start chatting." } })
    const paid = body && paidFeature(body)
    if (paid) return json(403, { error: { message: paid } })
  }

  const headers = new Headers({ "http-referer": url.origin, "x-openrouter-title": "Jonny's AI project" })
  if (key) headers.set("authorization", `Bearer ${key}`)
  for (const name of upstream.forward) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }

  const res = await fetch(upstream.origin + path + url.search, { method: req.method, headers, body, signal: req.signal })

  // fetch has already decoded the body, so content-encoding/length must not be passed on.
  const out = new Headers({ "cache-control": "no-store" })
  for (const name of RESPONSE_HEADERS) {
    const value = res.headers.get(name)
    if (value) out.set(name, value)
  }
  return new Response(res.body, { status: res.status, headers: out })
}

export const openrouter: Upstream = {
  prefix: "/api/openrouter",
  origin: "https://openrouter.ai/api",
  allow: {
    GET: [/^\/v1\/models$/],
    POST: [/^\/v1\/chat\/completions$/],
  },
  open: [/^\/v1\/models$/],
  forward: ["content-type", "accept"],
  keyEnv: "OPENROUTER_API_KEY",
}
