import { textAttachment } from "./github"

/** Reads a web page as plain text through the site's /api/read function. */
export async function readPage(url: string) {
  const res = await fetch(`/api/read?url=${encodeURIComponent(url.trim())}`)
  const body = (await res.json().catch(() => ({}))) as { title?: string; text?: string; url?: string; error?: { message?: string } }
  if (!res.ok || !body.text) throw new Error(body.error?.message ?? `Couldn't read that page (${res.status}).`)
  const host = new URL(body.url ?? url).hostname.replace(/^www\./, "")
  return textAttachment(`${body.title || host} (${host})`, `Source: ${body.url ?? url}\n\n${body.text}`)
}
