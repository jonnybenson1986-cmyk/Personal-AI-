// The Design studio's design types, the instructions sent to the AI, and reading the design
// back out of its reply. Kept free of DOM code so it can be tested.

export interface DesignKind {
  id: string
  label: string
  /** Fixed canvas in pixels; undefined for responsive web pages. */
  size?: [number, number]
  format: "html" | "svg"
  example: string
}

export const KINDS: DesignKind[] = [
  { id: "landing", label: "Landing page", format: "html", example: "A landing page for a cosy coffee shop in Manchester with opening times and a menu" },
  { id: "social", label: "Social post", size: [1080, 1080], format: "html", example: "An Instagram post announcing a summer sale, 30% off, bold and colourful" },
  { id: "story", label: "Story", size: [1080, 1920], format: "html", example: "An Instagram story for a new podcast episode about AI" },
  { id: "poster", label: "Poster", size: [1080, 1350], format: "html", example: "A poster for a jazz night on Friday at 8pm, art-deco style" },
  { id: "logo", label: "Logo", size: [512, 512], format: "svg", example: "A logo for 'Jonny's AI', modern and friendly" },
  { id: "card", label: "Business card", size: [1050, 600], format: "html", example: "A business card for Jonny Benson, product designer, minimalist" },
  { id: "app", label: "App screen", size: [390, 844], format: "html", example: "A home screen for a habit-tracking app with streaks and a calendar" },
  { id: "slide", label: "Slide", size: [1920, 1080], format: "html", example: "A title slide for a talk called 'Building with free AI models'" },
]

export const findKind = (id: string) => KINDS.find((k) => k.id === id) ?? KINDS[0]

export function designSystem(kind: DesignKind) {
  const base = [
    "You are a senior visual designer and front-end developer. You create beautiful, modern, polished designs with strong typography, spacing, hierarchy and colour, and realistic copy (never lorem ipsum).",
  ]
  if (kind.format === "svg") {
    base.push(
      "Reply with a single SVG in one ```svg code block, viewBox=\"0 0 512 512\" with width=\"512\" height=\"512\". Simple, memorable shapes that still work small. Use only inline SVG (text may use a common font-family like 'Inter, Arial, sans-serif'). Include the name as text only if the request asks for it.",
    )
  } else {
    base.push(
      "Reply with one complete, self-contained HTML document in one ```html code block: inline <style>, no JavaScript frameworks or external CSS (Google Fonts via <link> are fine). Do not use external images: make imagery with CSS gradients, shapes, inline SVG and emoji.",
    )
    base.push(
      kind.size
        ? `The design is a fixed ${kind.size[0]}×${kind.size[1]} pixel canvas: set html, body { margin: 0; width: ${kind.size[0]}px; height: ${kind.size[1]}px; overflow: hidden } and fill that area exactly.`
        : "It's a responsive web page that looks great from 360px phones to 1440px desktops.",
    )
  }
  base.push("After the code block, add one short sentence describing the design.")
  return base.join("\n\n")
}

export function designRequest(kind: DesignKind, instruction: string, current?: string) {
  if (!current) return `Design this ${kind.label.toLowerCase()}: ${instruction}`
  return `Here is the current design:\n\n\`\`\`${kind.format}\n${current}\n\`\`\`\n\nChange it: ${instruction}\n\nReply with the complete updated ${kind.format === "svg" ? "SVG" : "HTML document"}.`
}

/**
 * The design in a reply: the first ```html/```svg block, or a bare document/SVG.
 * While a reply is still streaming, returns the partial code so the preview can grow.
 */
export function extractDesign(reply: string, format: "html" | "svg"): string | undefined {
  const fenced = reply.match(new RegExp("```(?:" + (format === "svg" ? "svg|xml" : "html|htm") + ")?[^\\n]*\\n([\\s\\S]*?)(?:```|$)", "i"))
  const code = fenced?.[1] ?? reply
  const start = format === "svg" ? code.search(/<svg[\s>]/i) : code.search(/<!doctype html|<html[\s>]/i)
  if (start < 0) return fenced && fenced[1].trim() ? fenced[1].trim() : undefined
  return code.slice(start).trim()
}

/** The sentence after the code, if any. */
export function designSummary(reply: string) {
  const after = reply.slice(reply.lastIndexOf("```") + 3).trim()
  return reply.includes("```") && after ? after.split("\n")[0].slice(0, 200) : undefined
}

/** A full document for previewing or exporting; SVG is centred on a plain page. */
export function designDocument(code: string, format: "html" | "svg") {
  if (format === "html") return code
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:512px;height:512px;overflow:hidden;background:#fff}svg{display:block;width:512px;height:512px}</style></head><body>${code}</body></html>`
}
