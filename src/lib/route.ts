// How the app reaches the user's OmniRoute gateway, from the address they entered.

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|.+\.(local|lan|home|internal))$/i

/**
 * Where an OmniRoute address is reached from: "proxy" (public https, through this site's
 * server) or "direct" (localhost or a home network, from the browser itself).
 */
export function gatewayRoute(raw: string): { mode: "proxy" | "direct"; base: string } | undefined {
  const text = raw.trim()
  if (!text) return undefined
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `${/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(text) ? "http" : "https"}://${text}`)
  } catch {
    return undefined
  }
  const base = (url.origin + url.pathname).replace(/\/+$/, "").replace(/\/v1$/, "")
  return { mode: url.protocol === "https:" && !PRIVATE_HOST.test(url.hostname) ? "proxy" : "direct", base }
}
