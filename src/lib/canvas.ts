import { createSignal } from "solid-js"

export interface CanvasDoc {
  title: string
  lang: string
  code: string
}

/** The code or page open in the side canvas, if any. */
export const [canvas, setCanvas] = createSignal<CanvasDoc>()

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A full HTML document for the sandboxed preview; bare SVG or fragments get wrapped. */
export function previewDocument(doc: CanvasDoc) {
  const code = doc.code.trim()
  if (/^<!doctype html|^<html/i.test(code)) return code
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style></head><body>${code}</body></html>`
}
