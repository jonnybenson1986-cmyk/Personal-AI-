// Proxy to the user's own OpenAI-compatible gateway (OmniRoute) when it has a public https
// address. The browser can't call it directly unless the gateway allows this site's origin,
// so requests come here and are passed on with the user's own gateway key. Only the model
// list, chat, image/audio/video/music generation, search, web reading, OCR and the key's own
// usage are forwarded, and only to public https addresses.
// The site can also have its own gateway (OMNIROUTE_URL and OMNIROUTE_API_KEY on Netlify),
// used when the app sends no address. Its key only ever goes to its own address.

export const GATEWAY_PREFIX = "/api/omniroute"
const ALLOWED = [
  ["GET", /^\/v1\/models$/],
  ["POST", /^\/v1\/chat\/completions$/],
  ["POST", /^\/v1\/images\/(generations|edits)$/],
  ["POST", /^\/v1\/audio\/(transcriptions|speech)$/],
  ["POST", /^\/v1\/(videos|music)\/generations$/],
  ["GET", /^\/v1\/search$/],
  ["POST", /^\/v1\/search$/],
  ["POST", /^\/v1\/web\/fetch$/],
  ["POST", /^\/v1\/ocr$/],
  ["GET", /^\/api\/usage\/om-usage$/],
] as const
const RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "x-ratelimit-remaining", "x-request-id", "x-omniroute-decision", "x-omniroute-version", "x-omniroute-cache"]

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
}

/** The gateway's base URL (without a trailing /v1), if it's a public https address. */
export function gatewayBase(raw: string | null): string | undefined {
  if (!raw) return undefined
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== "https:" || url.username || url.password) return undefined
  const host = url.hostname.toLowerCase()
  if (!host.includes(".") || host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return undefined
  return (url.origin + url.pathname).replace(/\/+$/, "").replace(/\/v1$/, "")
}

type Env = (name: string) => string | undefined

/** The site's own gateway, when OMNIROUTE_URL (public https) and OMNIROUTE_API_KEY are both set. */
export function siteGateway(env: Env): { base: string; key: string } | undefined {
  const base = gatewayBase(env("OMNIROUTE_URL") ?? null)
  const key = env("OMNIROUTE_API_KEY")?.trim()
  return base && key ? { base, key } : undefined
}

export async function gatewayProxy(req: Request, env: Env = () => undefined) {
  const url = new URL(req.url)
  const path = url.pathname.slice(GATEWAY_PREFIX.length)
  if (!ALLOWED.some(([method, rule]) => method === req.method && rule.test(path))) return json(404, { error: { message: `Not allowed: ${req.method} ${path}` } })
  const own = req.headers.get("x-omniroute-url")
  let base: string | undefined
  let auth: string | null
  if (own) {
    base = gatewayBase(own)
    if (!base) return json(400, { error: { message: "OmniRoute address must be a public https:// URL (for a local one, the app connects directly)." } })
    auth = req.headers.get("authorization")
    if (!auth) return json(401, { error: { message: "Add your OmniRoute API key in Settings." } })
  } else {
    const site = siteGateway(env)
    if (!site) return json(400, { error: { message: "Add your OmniRoute address in Settings." } })
    base = site.base
    auth = `Bearer ${site.key}`
  }

  let res: Response
  try {
    res = await fetch(base + path + url.search, {
      method: req.method,
      headers: { authorization: auth, "content-type": req.headers.get("content-type") ?? "application/json", accept: req.headers.get("accept") ?? "*/*" },
      body: req.method === "POST" ? await req.arrayBuffer() : undefined,
      signal: req.signal,
    })
  } catch {
    return json(502, { error: { message: "Couldn't reach your OmniRoute server. Is it running, and is the address right?" } })
  }
  const out = new Headers({ "cache-control": "no-store" })
  for (const name of RESPONSE_HEADERS) {
    const value = res.headers.get(name)
    if (value) out.set(name, value)
  }
  return new Response(res.body, { status: res.status, headers: out })
}
