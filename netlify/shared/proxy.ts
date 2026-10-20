// Shared logic for the edge proxies. The browser talks to the official Anthropic
// and OpenAI SDKs with their baseURL pointed here; this layer checks the app
// passcode, swaps in the real API key, and streams the upstream response back.

export interface Upstream {
  /** Public prefix the edge function is mounted on, e.g. "/api/anthropic". */
  prefix: string
  origin: string
  /** Paths (after the prefix) this proxy is willing to forward, keyed by method. */
  allow: Record<string, RegExp[]>
  /** Request headers copied from the browser to the upstream. */
  forward: string[]
  auth: (key: string) => Record<string, string>
  keyEnv: string
}

const RESPONSE_HEADERS = ["content-type", "request-id", "x-request-id", "retry-after", "cache-control"]

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
}

/** Constant-time comparison of the supplied passcode against the configured one. */
export async function checkPasscode(req: Request, env: (name: string) => string | undefined) {
  const expected = env("APP_PASSCODE")
  if (!expected) return json(503, { error: { message: "APP_PASSCODE is not set on the server. Add it in Netlify → Site configuration → Environment variables." } })
  const a = await digest(req.headers.get("x-app-passcode") ?? "")
  const b = await digest(expected)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  if (diff !== 0) return json(401, { error: { message: "Wrong or missing passcode." } })
  return undefined
}

export async function proxy(req: Request, upstream: Upstream, env: (name: string) => string | undefined) {
  const denied = await checkPasscode(req, env)
  if (denied) return denied

  const key = env(upstream.keyEnv)
  if (!key) return json(503, { error: { message: `${upstream.keyEnv} is not set on the server.` } })

  const url = new URL(req.url)
  const path = url.pathname.slice(upstream.prefix.length)
  const rules = upstream.allow[req.method] ?? []
  if (!rules.some((rule) => rule.test(path))) return json(404, { error: { message: `Not allowed: ${req.method} ${path}` } })

  const headers = new Headers(upstream.auth(key))
  for (const name of upstream.forward) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }

  const res = await fetch(upstream.origin + path + url.search, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    signal: req.signal,
  })

  // fetch has already decoded the body, so content-encoding/length must not be passed on.
  const out = new Headers({ "cache-control": "no-store" })
  for (const name of RESPONSE_HEADERS) {
    const value = res.headers.get(name)
    if (value) out.set(name, value)
  }
  return new Response(res.body, { status: res.status, headers: out })
}

export const anthropic: Upstream = {
  prefix: "/api/anthropic",
  origin: "https://api.anthropic.com",
  allow: {
    GET: [/^\/v1\/models(\/[\w.-]+)?$/],
    POST: [/^\/v1\/messages$/],
  },
  forward: ["content-type", "accept", "anthropic-version", "anthropic-beta"],
  auth: (key) => ({ "x-api-key": key }),
  keyEnv: "ANTHROPIC_API_KEY",
}

export const openai: Upstream = {
  prefix: "/api/openai",
  origin: "https://api.openai.com",
  allow: {
    GET: [/^\/v1\/models(\/[\w.:-]+)?$/],
    POST: [/^\/v1\/responses$/],
  },
  forward: ["content-type", "accept"],
  auth: (key) => ({ authorization: `Bearer ${key}` }),
  keyEnv: "OPENAI_API_KEY",
}
