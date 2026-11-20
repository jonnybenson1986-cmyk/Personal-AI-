// Small, predictable routing decisions made before a message is sent. Pure functions, unit
// tested: links in a message that should be read for it, and a model that can see the
// pictures in it when the chosen one can't.
import type { ChatMessage } from "./history"
import type { Attachment, ModelInfo, ModelRef } from "./types"

/** At most this many links in one message are read for it. */
export const MAX_LINKS = 2

/**
 * The web links in a message worth reading for it: http(s) only, trailing punctuation
 * trimmed, no repeats, none already attached (attached pages start "Source: <url>").
 */
export function linksToRead(text: string, attached: string[] = [], max = MAX_LINKS) {
  const seen = new Set(attached)
  const out: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    let url = match[0].replace(/[.,;:!?]+$/, "")
    // A closing bracket belongs to the link only if it opened one: (see https://x.com/a_(b)).
    while (/[)\]}]$/.test(url) && count(url, url.at(-1)!) > count(url, { ")": "(", "]": "[", "}": "{" }[url.at(-1)!]!)) url = url.slice(0, -1)
    try {
      url = new URL(url).href
    } catch {
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= max) break
  }
  return out
}

const count = (text: string, ch: string) => text.split(ch).length - 1

/** The address a page attachment was read from (web.ts starts them "Source: <url>"), if it is one. */
export function pageSource(a: Attachment) {
  if (a.mediaType !== "text/plain") return undefined
  try {
    // The first 1 KB is plenty (base64 decodes in blocks of 4 characters).
    return atob(a.data.slice(0, 1368)).match(/^Source: (\S+)/)?.[1]
  } catch {
    return undefined
  }
}

/** Whether any message carries a picture. */
export const hasImages = (messages: ChatMessage[]) =>
  messages.some((m) => Array.isArray(m.content) && m.content.some((p) => (p as { type?: string }).type === "image_url"))

/**
 * A model that can see pictures, when the chosen one is known not to. Undefined means keep
 * the chosen one: it sees images, or we can't tell (not in the list, or the list doesn't say,
 * as with routers and combos on some gateways). `auto` is the router to prefer.
 */
export function visionModel(model: ModelRef, known: ModelInfo[], auto: string): ModelRef | undefined {
  if (known.find((m) => m.id === model.id)?.vision !== false) return undefined
  const seeing = known.filter((m) => m.vision === true)
  const pick = seeing.find((m) => m.id === auto) ?? seeing[0]
  return pick && { id: pick.id }
}
