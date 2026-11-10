// A per-visitor request limit kept in Netlify Blobs, for endpoints that Netlify's own rate
// rules can't cover (the free plan allows two per site). Fixed one-minute windows, counted per
// IP address. Approximate under bursts: two requests landing at the same instant can both pass.
export interface CounterStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  list(prefix: string): Promise<string[]>
  delete(key: string): Promise<void>
}

const WINDOW_MS = 60_000

/** Counts a request. Returns the seconds to wait when the visitor is over the limit, otherwise undefined. */
export async function overLimit(store: CounterStore, scope: string, ip: string, limit: number, now = Date.now()): Promise<number | undefined> {
  const window = Math.floor(now / WINDOW_MS)
  const key = `rl/${scope}/${ip}/${window}`
  const count = Number((await store.get(key)) ?? 0)
  if (count >= limit) return Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000))
  await store.set(key, count + 1)
  return undefined
}

/** The visitor's address: the edge's own value, or Netlify's header for it. */
export function visitorIp(req: Request, contextIp?: string) {
  return contextIp || req.headers.get("x-nf-client-connection-ip") || undefined
}

/**
 * A 429 for an over-limit visitor, or undefined to carry on. Fails open: a storage fault never
 * blocks a visitor. If no address is known, the visitor is counted under one shared key, so
 * the limit still applies rather than being skipped.
 */
export async function limitResponse(store: CounterStore, scope: string, ip: string | undefined, limit: number): Promise<Response | undefined> {
  ip ??= "unknown"
  try {
    const wait = await overLimit(store, scope, ip, limit)
    if (wait === undefined) return undefined
    return new Response(JSON.stringify({ error: { message: "Too many requests. Wait a minute and try again." } }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(wait), "cache-control": "no-store" },
    })
  } catch (e) {
    console.error(JSON.stringify({ event: "rate-limit-store-error", scope, message: e instanceof Error ? e.message : String(e) }))
    return undefined
  }
}

/** Drops counters from windows older than an hour. */
export async function purgeLimits(store: CounterStore, now = Date.now()) {
  for (const key of await store.list("rl/")) {
    const window = Number(key.split("/").pop())
    if (Number.isFinite(window) && now - window * WINDOW_MS > 60 * 60_000) await store.delete(key)
  }
}
