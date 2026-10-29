// Cowork's state and file handling: files added from this device (or a connected folder) are
// kept in the browser, the AI reads them and can write new or changed files back.
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { del, get, set } from "idb-keyval"
import { parseFileChanges } from "./changes"
import { coworkSystem, fileKind, type FileKind, isTextKind, pickContext, safePath, uniquePath, docxText } from "./cowork"
import { readFile as readAttachment } from "./files"
import type { ChatMessage } from "./history"
import { errorMessage, isAbort, streamChat } from "./providers"
import { settings } from "./store"

export interface CoworkFile {
  path: string
  kind: FileKind
  type: string
  size: number
  /** Contents of text files; text pulled out of PDFs and Word files. */
  text?: string
  /** The original bytes of anything that isn't plain text. */
  blob?: Blob
  /** Text before the first edit, so it can be reverted; undefined for files that are new. */
  original?: string
  /** Changed or created here since it was added or last saved to the folder. */
  changed?: boolean
  /** Made by the AI or created here, rather than added. */
  created?: boolean
}

export interface CoworkTurn {
  id: string
  text: string
  reply: string
  status: "streaming" | "done" | "error" | "stopped"
  error?: string
  /** Files in the reply, once applied. */
  applied?: string[]
}

interface State {
  files: CoworkFile[]
  /** Files the user picked for the AI to focus on (none = all). */
  picked: string[]
  open?: string
  chat: CoworkTurn[]
  /** Name of the connected folder, if any. */
  folder?: string
}

const KEY = "cowork:state"
const FOLDER_KEY = "cowork:folder"
const MAX_TEXT = 4 * 1024 * 1024
const MAX_FILE = 30 * 1024 * 1024
const MAX_FOLDER_FILES = 400

export const [cw, setCw] = createStore<State>({ files: [], picked: [], chat: [] })

let loaded = false
let timer: ReturnType<typeof setTimeout> | undefined
function save() {
  // Never save before the saved state has loaded, or it would be overwritten with nothing.
  if (!loaded) return
  clearTimeout(timer)
  timer = setTimeout(() => void set(KEY, unwrap(cw)).catch(() => {}), 300)
}

export function update(fn: (s: State) => void) {
  setCw(produce(fn))
  save()
}

let restoring: Promise<void> | undefined
export function restoreCowork() {
  restoring ??= (async () => {
    const saved = await get<State>(KEY).catch(() => undefined)
    if (saved) setCw(reconcile({ ...saved, picked: saved.picked ?? [], files: saved.files ?? [], chat: (saved.chat ?? []).map((t) => (t.status === "streaming" ? { ...t, status: "stopped" as const } : t)) }))
    loaded = true
  })()
  return restoring
}

export const findFile = (path: string) => cw.files.find((f) => f.path === path)

async function extractText(kind: FileKind, blob: Blob): Promise<string | undefined> {
  if (kind === "pdf") {
    const pdfjs = await import("pdfjs-dist")
    // Bundled as a classic .js worker, which every host serves with the right type.
    if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new (await import("pdfjs-dist/build/pdf.worker.min.mjs?worker")).default()
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      const text = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("")
      pages.push(`--- Page ${i} ---\n${text.trim()}`)
    }
    await task.destroy()
    return pages.join("\n\n")
  }
  if (kind === "docx") {
    const { unzipSync, strFromU8 } = await import("fflate")
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => f.name === "word/document.xml" })
    const xml = files["word/document.xml"]
    return xml ? docxText(strFromU8(xml)) : undefined
  }
  return undefined
}

/** Reads a file from the device into a Cowork file (text, or bytes plus any text inside). */
async function toCoworkFile(file: File, path: string): Promise<CoworkFile> {
  const kind = fileKind(file.name, file.type)
  const base = { path, kind, type: file.type || (kind === "pdf" ? "application/pdf" : ""), size: file.size }
  if (isTextKind(kind)) {
    if (file.size > MAX_TEXT) throw new Error(`${file.name} is larger than 4 MB.`)
    return { ...base, text: await file.text() }
  }
  if (file.size > MAX_FILE) throw new Error(`${file.name} is larger than 30 MB.`)
  let text: string | undefined
  try {
    text = await extractText(kind, file)
  } catch {
    // Unreadable (or protected) documents are still kept, just without text for the AI.
  }
  return { ...base, blob: file, text }
}

/** Adds files from the device; a file with the same name gets a new name. Returns any errors. */
export async function addFiles(files: Iterable<File>) {
  const errors: string[] = []
  for (const file of files) {
    try {
      const taken = new Set(cw.files.map((f) => f.path))
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      const added = await toCoworkFile(file, uniquePath(taken, safePath(rel)))
      update((s) => {
        s.files.push(added)
        s.open ??= added.path
      })
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return errors
}

/** Creates or replaces a text file (replacing keeps the first version so it can be reverted). */
export function writeText(path: string, text: string) {
  update((s) => {
    const f = s.files.find((x) => x.path === path)
    if (!f) {
      s.files.push({ path, kind: fileKind(path), type: "", size: new Blob([text]).size, text, changed: true, created: true })
      return
    }
    if (!f.created && f.original === undefined) f.original = f.text
    f.text = text
    f.size = new Blob([text]).size
    f.changed = true
  })
}

export function revert(path: string) {
  update((s) => {
    const f = s.files.find((x) => x.path === path)
    if (!f || f.original === undefined) return
    f.text = f.original
    f.size = new Blob([f.original]).size
    f.original = undefined
    f.changed = false
  })
}

export function removeFile(path: string) {
  update((s) => {
    s.files = s.files.filter((f) => f.path !== path)
    s.picked = s.picked.filter((p) => p !== path)
    if (s.open === path) s.open = s.files[0]?.path
  })
}

export function renameFile(path: string, name: string) {
  const next = safePath(name)
  if (next === path || findFile(next)) return false
  update((s) => {
    const f = s.files.find((x) => x.path === path)
    if (!f) return
    f.path = next
    f.changed = true
    s.picked = s.picked.map((p) => (p === path ? next : p))
    if (s.open === path) s.open = next
  })
  return true
}

export function togglePicked(path: string) {
  update((s) => {
    s.picked = s.picked.includes(path) ? s.picked.filter((p) => p !== path) : [...s.picked, path]
  })
}

export async function clearAll() {
  update((s) => {
    s.files = []
    s.picked = []
    s.open = undefined
    s.chat = []
    s.folder = undefined
  })
  await del(FOLDER_KEY).catch(() => {})
}

export function fileBlob(f: CoworkFile) {
  if (f.blob && !f.changed) return f.blob
  return new Blob([f.text ?? ""], { type: f.type || "text/plain" })
}

/** Every file as one zip, folders kept. */
export async function zipAll() {
  const { zipSync } = await import("fflate")
  const entries: Record<string, Uint8Array> = {}
  for (const f of cw.files) entries[f.path] = new Uint8Array(await fileBlob(f).arrayBuffer())
  return new Blob([zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" })
}

// Folders, through the File System Access API (Chrome and Edge on computers).

interface DirHandle {
  name: string
  kind: "directory"
  values(): AsyncIterable<DirHandle | FileHandle>
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>
  queryPermission(o: { mode: "read" | "readwrite" }): Promise<PermissionState>
  requestPermission(o: { mode: "read" | "readwrite" }): Promise<PermissionState>
}
interface FileHandle {
  name: string
  kind: "file"
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}

type Picker = (o?: { mode?: "read" | "readwrite"; id?: string }) => Promise<DirHandle>
const picker = () => (globalThis as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
export const canOpenFolder = () => typeof picker() === "function" && window.self === window.top

const SKIP_DIR = /^(\..*|node_modules|dist|build|__pycache__|venv)$/

async function walk(dir: DirHandle, prefix: string, out: { path: string; handle: FileHandle }[]) {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FOLDER_FILES) return
    if (entry.kind === "directory") {
      if (!SKIP_DIR.test(entry.name)) await walk(entry, `${prefix}${entry.name}/`, out)
    } else if (!entry.name.startsWith(".")) out.push({ path: prefix + entry.name, handle: entry })
  }
}

/** Opens a folder on this device: its files replace the current ones, and changes can be saved back. */
export async function openFolder() {
  const dir = await picker()!({ mode: "readwrite", id: "cowork" })
  const found: { path: string; handle: FileHandle }[] = []
  await walk(dir, "", found)
  const files: CoworkFile[] = []
  const errors: string[] = []
  for (const { path, handle } of found) {
    try {
      files.push(await toCoworkFile(await handle.getFile(), path))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  update((s) => {
    s.files = files
    s.picked = []
    s.open = files[0]?.path
    s.folder = dir.name
  })
  await set(FOLDER_KEY, dir).catch(() => {})
  if (found.length >= MAX_FOLDER_FILES) errors.unshift(`Only the first ${MAX_FOLDER_FILES} files were opened.`)
  return errors
}

/** Writes changed and new files into the connected folder; returns how many were saved. */
export async function saveToFolder() {
  const dir = await get<DirHandle>(FOLDER_KEY).catch(() => undefined)
  if (!dir) throw new Error("Open the folder again to save to it.")
  if ((await dir.queryPermission({ mode: "readwrite" })) !== "granted" && (await dir.requestPermission({ mode: "readwrite" })) !== "granted")
    throw new Error("Permission to save in the folder was denied.")
  const changed = cw.files.filter((f) => f.changed)
  for (const f of changed) {
    const parts = f.path.split("/")
    let d = dir
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true })
    const w = await (await d.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
    await w.write(fileBlob(f))
    await w.close()
  }
  update((s) => {
    for (const f of s.files) {
      f.changed = false
      f.created = false
      f.original = undefined
    }
  })
  return changed.length
}

// The AI.

let controller: AbortController | undefined
export const aiBusy = () => cw.chat.some((t) => t.status === "streaming")
export const stopAI = () => controller?.abort()

const MAX_IMAGES = 4

export async function askAI(request: string) {
  const id = crypto.randomUUID()
  const context = pickContext(cw.files, request, cw.picked)
  const listing = cw.files.map((f) => `${f.path} (${f.kind}${f.text === undefined && !isTextKind(f.kind) ? ", no text" : ""})`)
  const text = [
    listing.length ? `Files (${listing.length}):\n${listing.join("\n")}` : "There are no files yet.",
    ...context.map((f) => `<file path="${f.path}"${f.truncated ? ' truncated="true"' : ""}>\n${f.text}\n</file>`),
    cw.picked.length ? `The user picked these files to focus on: ${cw.picked.join(", ")}.` : "",
    request,
  ]
    .filter(Boolean)
    .join("\n\n")
  // Images are only sent when picked: not every model can see them.
  const images = cw.files.filter((f) => f.kind === "image" && f.blob && cw.picked.includes(f.path)).slice(0, MAX_IMAGES)
  const parts = await Promise.all(images.map((f) => readAttachment(new File([f.blob!], f.path.split("/").pop()!, { type: f.type || "image/png" }))))
  const user: ChatMessage = parts.length
    ? { role: "user", content: [...parts.map((a) => ({ type: "image_url" as const, image_url: { url: `data:${a.mediaType};base64,${a.data}` } })), { type: "text" as const, text }] }
    : { role: "user", content: text }
  const history: ChatMessage[] = cw.chat
    .filter((t) => t.status === "done" && t.reply)
    .slice(-6)
    .flatMap((t): ChatMessage[] => [
      { role: "user", content: t.text },
      { role: "assistant", content: t.reply },
    ])
  update((s) => {
    s.chat.push({ id, text: request, reply: "", status: "streaming" })
  })
  const edit = (fn: (t: CoworkTurn) => void) =>
    update((s) => {
      const t = s.chat.find((x) => x.id === id)
      if (t) fn(t)
    })
  controller = new AbortController()
  try {
    const result = await streamChat({
      messages: [{ role: "system", content: coworkSystem(settings.system) }, ...history, user],
      model: settings.models[0],
      credentials: settings,
      signal: controller.signal,
      events: { text: (d) => edit((t) => (t.reply += d)), thinking: () => {}, servedBy: () => {} },
    })
    edit((t) => {
      t.status = "done"
      if (result.notice) t.error = result.notice
    })
  } catch (e) {
    edit((t) => {
      if (isAbort(e)) t.status = "stopped"
      else {
        t.status = "error"
        t.error = errorMessage(e)
      }
    })
  }
}

/** Writes the files from a reply. Documents and images are never overwritten: those get a new name. */
export function applyReply(turnId: string) {
  const turn = cw.chat.find((t) => t.id === turnId)
  if (!turn) return []
  const written: string[] = []
  for (const change of parseFileChanges(turn.reply)) {
    let path = safePath(change.path)
    const existing = findFile(path)
    if (existing && !isTextKind(existing.kind)) path = uniquePath(new Set(cw.files.map((f) => f.path)), path.replace(/\.[^./]+$/, "") + ".md")
    writeText(path, change.content)
    written.push(path)
  }
  update((s) => {
    const t = s.chat.find((x) => x.id === turnId)
    if (t) t.applied = written
    if (written[0]) s.open = written[0]
  })
  return written
}

export function clearChat() {
  update((s) => {
    s.chat = []
  })
}
