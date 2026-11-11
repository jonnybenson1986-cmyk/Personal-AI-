// Preserve the caller's transport and streaming response; never add generation retries.
const JSON_PATHS = new Set(["/v1/chat/completions", "/v1/completions", "/v1/responses", "/v1/messages", "/v1/messages/count_tokens", "/v1/images/generations", "/v1/videos/generations"])
export async function inferenceFetch(url: string, init: RequestInit, transport: typeof fetch = globalThis.fetch): Promise<Response> {
  const target = new URL(url)
  const headers = new Headers(init.headers)
  if (target.origin !== "https://api.cheaperinference.com" || !JSON_PATHS.has(target.pathname) || init.method !== "POST" || headers.has("content-encoding") || headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !init.body) return transport(url, init)
  init.signal?.throwIfAborted()
  const bytes = await new Response(init.body).arrayBuffer()
  const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()
  init.signal?.throwIfAborted()
  headers.set("content-encoding", "gzip")
  headers.delete("content-length")
  headers.delete("transfer-encoding")
  return transport(url, { ...init, headers, body: compressed })
}
