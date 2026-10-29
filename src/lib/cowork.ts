// Cowork: files you bring (uploads or a folder on this device) that the AI reads and works
// on with you. These are the pure parts (file types, CSV, what the AI gets to see), kept free
// of DOM code so they can be unit tested.
import { EDIT_FORMAT } from "./tools.ts"

export type FileKind = "text" | "markdown" | "csv" | "image" | "pdf" | "docx" | "binary"

const TEXT_EXT =
  /\.(txt|text|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|env|log|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|svg|tex|rtf|srt|vtt|ics|vcf|gitignore|dockerfile)$/i

export function fileKind(name: string, mime = ""): FileKind {
  const n = name.toLowerCase()
  if (/\.(md|markdown|mdx)$/.test(n)) return "markdown"
  if (/\.(csv|tsv)$/.test(n) || mime === "text/csv") return "csv"
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf"
  if (n.endsWith(".docx")) return "docx"
  if (n.endsWith(".svg")) return "text"
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/.test(n)) return "image"
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(n) || !/\.[^/]+$/.test(n)) return "text"
  return "binary"
}

/** Kinds whose content is stored and edited as text. */
export const isTextKind = (k: FileKind) => k === "text" || k === "markdown" || k === "csv"

/** Parses CSV (or TSV) with quoted fields, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  if (!delimiter) {
    const first = text.split("\n", 1)[0]
    delimiter = first.includes("\t") && !first.includes(",") ? "\t" : ","
  }
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === "") quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** A file name the AI can refer to and write back: folders kept, odd characters replaced. */
export function safePath(raw: string) {
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim().replace(/[^\w@+\-. ]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((p) => p && p !== "." && p !== "..")
  return parts.join("/") || "file.txt"
}

/** `name`, or `name (2).ext`, `name (3).ext`… whichever isn't taken. */
export function uniquePath(taken: Set<string>, path: string) {
  if (!taken.has(path)) return path
  const m = path.match(/^(.*?)(\.[^./]+)?$/)!
  for (let n = 2; ; n++) {
    const candidate = `${m[1]} (${n})${m[2] ?? ""}`
    if (!taken.has(candidate)) return candidate
  }
}

export interface ContextFile {
  path: string
  kind: FileKind
  size: number
  /** Text content, or text extracted from a PDF or Word file. */
  text?: string
}

/**
 * Which files' contents go to the AI, within a budget of characters: files the user picked
 * (or, if none, every file), with files named in the request first. A file too big for what's
 * left is cut short rather than left out, so long documents still get read in part.
 */
export function pickContext(files: ContextFile[], request: string, picked: string[], budget = 120_000) {
  const named = (f: ContextFile) => request.includes(f.path) || request.toLowerCase().includes(f.path.split("/").pop()!.toLowerCase())
  const pool = picked.length ? files.filter((f) => picked.includes(f.path)) : files
  const ordered = [...pool.filter(named), ...pool.filter((f) => !named(f))]
  const included: { path: string; text: string; truncated: boolean }[] = []
  let left = budget
  for (const f of ordered) {
    if (f.text === undefined || left < 500) continue
    const truncated = f.text.length > left
    const text = truncated ? f.text.slice(0, left) : f.text
    left -= text.length
    included.push({ path: f.path, text, truncated })
  }
  return included
}

export function coworkSystem(extra = "") {
  return [
    "You are a capable colleague working with the user on their files in the Cowork space of Jonny's AI project.",
    "You get a list of the files, the contents of the ones that matter, and sometimes images. Read them carefully and refer to files by name. If a file was cut short, say what you could see.",
    "Answer questions directly. When the user wants something produced or changed (a report, summary, table, cleaned-up data, a rewritten document, code), write it as a file. " +
      EDIT_FORMAT.replace("from the repository root", "(an existing file's name to change it, or a new name)").replace(
        " After the files, give a one-line summary of the change that could serve as a commit message.",
        " After the files, say in a sentence what you made.",
      ),
    "Use Markdown (.md) for documents, CSV (.csv) for tables and HTML (.html) for anything visual. PDFs, Word files and images can't be overwritten: save results under a new name.",
    extra.trim(),
  ]
    .filter(Boolean)
    .join("\n\n")
}

export const QUICK_ASKS = [
  "Summarize these files: key points first, then details.",
  "Compare these files and list the differences that matter.",
  "Pull out every action item, deadline and owner into actions.md.",
  "Turn the important data into a clean table in summary.csv.",
  "Proofread and improve the writing, keeping the meaning. Save as new files.",
  "Write a short report on these files in report.md.",
]

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

/** Plain text from a Word document's document.xml: paragraphs, line breaks and tabs kept. */
export function docxText(xml: string) {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
