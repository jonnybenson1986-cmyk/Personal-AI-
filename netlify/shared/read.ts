// Fetches a web page for the AI to read and boils it down to plain text.

const MAX_BYTES = 3_000_000
const MAX_CHARS = 60_000

/** Only public http(s) sites: no local, private-network or bare-IP addresses. */
export function allowedUrl(input: string | null): URL | undefined {
  if (!input) return undefined
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (url.username || url.password) return undefined
  const host = url.hostname.toLowerCase()
  if (!host.includes(".") || host.startsWith("[")) return undefined
  if (/^(localhost|.*\.(localhost|local|internal|lan|home|corp))$/.test(host)) return undefined
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined
  return url
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" }

function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
}

/** HTML to readable text: drops scripts, styles and navigation, keeps paragraph breaks. */
export function htmlToText(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()
  const main = html.match(/<(article|main)[\s>][\s\S]*<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html
  const text = decode(
    main
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form|aside)[\s>][\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(b|i|em|strong|span|a|code|small|sup|sub|mark|u|s|abbr|time|label)\b[^>]*>/gi, "")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/?(p|div|section|article|main|li|ul|ol|h[1-6]|tr|table|blockquote|pre|figure|dd|dt)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { title, text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n\n[Page cut short]" : text }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
}

export async function readPage(req: Request) {
  // Only this app's own pages may use the reader (browsers send this header).
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin") return json(403, { error: { message: "Not allowed." } })
  const url = allowedUrl(new URL(req.url).searchParams.get("url"))
  if (!url) return json(400, { error: { message: "That doesn't look like a public web address." } })

  let res: Response
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; JonnysAI/1.0; +reader)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return json(502, { error: { message: "Couldn't reach that site." } })
  }
  if (!res.ok) return json(502, { error: { message: `The site returned ${res.status}.` } })
  const type = res.headers.get("content-type") ?? ""
  if (!/text\/html|text\/plain|application\/xhtml|text\/markdown|application\/json/.test(type)) return json(415, { error: { message: "That link isn't a web page the AI can read." } })

  // Read at most MAX_BYTES so a huge download can't stall the function.
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.length
  }
  const raw = new TextDecoder().decode(bytes)
  const page = /html|xhtml/.test(type) ? htmlToText(raw) : { title: "", text: raw.slice(0, MAX_CHARS) }
  if (!page.text) return json(422, { error: { message: "That page has no readable text (it may need JavaScript)." } })
  return json(200, { url: res.url || url.href, ...page })
}
