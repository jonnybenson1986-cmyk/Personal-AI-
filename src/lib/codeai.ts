// The Code workspace's AI: sees the repo's file list and the files that matter for the
// request, and answers with complete files that can be applied to the working copy.
import { parseFileChanges } from "./changes"
import type { ChatMessage } from "./history"
import { errorMessage, isAbort, resumeChat, streamChat } from "./providers"
import { settings } from "./store"
import { EDIT_FORMAT } from "./tools"
import type { StreamEvents, StreamResult } from "./types"
import { readFile, update, workingFiles, writeFile, ws } from "./workspace"

const CONTEXT_BYTES = 150_000
let controller: AbortController | undefined

export const aiBusy = () => ws.chat.some((t) => t.status === "streaming")

export function stopAI() {
  controller?.abort()
}

/** Files to show the AI: the open one, ones with edits, and any named in the request. */
async function contextFiles(request: string) {
  const all = workingFiles()
  const named = all.filter((p) => request.includes(p) || new RegExp(`(^|[\\s\`'"(/])${p.split("/").pop()!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(request))
  const wanted = [...new Set([ws.open, ...Object.keys(ws.changes), ...named].filter((p): p is string => !!p && all.includes(p)))]
  const out: { path: string; text: string }[] = []
  let total = 0
  for (const path of wanted) {
    const text = await readFile(path).catch(() => undefined)
    if (text === undefined || total + text.length > CONTEXT_BYTES) continue
    total += text.length
    out.push({ path, text })
  }
  return out
}

function system() {
  const t = ws.target!
  return [
    `You are an expert software engineer working in the GitHub repository ${t.owner}/${t.repo} on branch ${ws.branch}, in the Code workspace of Jonny's AI project.`,
    "You can see the file list and the contents of the files given to you. If you need a file you weren't given, ask for it by path.",
    EDIT_FORMAT,
    "To delete or rename a file, say so in words; the user does that in the terminal. Keep explanations short.",
    settings.system.trim(),
  ]
    .filter(Boolean)
    .join("\n\n")
}

export async function askAI(request: string) {
  const id = crypto.randomUUID()
  const files = await contextFiles(request)
  const list = workingFiles()
  const context = [
    `Files in the repo (${list.length}):\n${list.slice(0, 600).join("\n")}${list.length > 600 ? "\n…" : ""}`,
    ...files.map((f) => `<file path="${f.path}">\n${f.text}\n</file>`),
    ws.open ? `The file open in the editor is ${ws.open}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  // Earlier exchanges without their file context, to keep the request small.
  const history: ChatMessage[] = ws.chat
    .filter((t) => t.status === "done" && t.reply)
    .slice(-6)
    .flatMap((t): ChatMessage[] => [
      { role: "user", content: t.text },
      { role: "assistant", content: t.reply },
    ])
  update((s) => {
    s.chat.push({ id, text: request, reply: "", status: "streaming" })
  })
  await follow(id, (events, signal) =>
    streamChat({
      messages: [{ role: "system", content: system() }, ...history, { role: "user", content: `${context}\n\n${request}` }],
      model: settings.models[0],
      credentials: settings,
      signal,
      events,
      job: { started: (job) => edit(id, (t) => (t.job = job)) },
    }),
  )
}

const edit = (id: string, fn: (t: (typeof ws.chat)[number]) => void) =>
  update((s) => {
    const t = s.chat.find((x) => x.id === id)
    if (t) fn(t)
  })

async function follow(id: string, start: (events: StreamEvents, signal: AbortSignal) => Promise<StreamResult>) {
  controller = new AbortController()
  try {
    const result = await start({ text: (d) => edit(id, (t) => (t.reply += d)), thinking: () => {}, servedBy: () => {} }, controller.signal)
    edit(id, (t) => {
      t.status = "done"
      t.job = undefined
      if (result.notice) t.error = result.notice
    })
  } catch (e) {
    edit(id, (t) => {
      t.job = undefined
      if (isAbort(e)) t.status = "stopped"
      else {
        t.status = "error"
        t.error = errorMessage(e)
      }
    })
  }
}

/** After a reload: picks up a reply still running on the server; one that ran in the app is over. */
let resumed = false
export function resumeCodeAI() {
  if (resumed) return
  resumed = true
  for (const t of ws.chat) {
    if (t.status !== "streaming") continue
    if (!t.job) {
      edit(t.id, (x) => (x.status = "stopped"))
      continue
    }
    const job = t.job
    void follow(t.id, (events, signal) => resumeChat(job, settings, events, signal, () => edit(t.id, (x) => (x.reply = ""))))
  }
}

/** Writes the files from a reply into the working copy; returns their paths. */
export async function applyReply(turnId: string) {
  const turn = ws.chat.find((t) => t.id === turnId)
  if (!turn) return []
  const files = parseFileChanges(turn.reply)
  for (const f of files) await writeFile(f.path, f.content)
  update((s) => {
    const t = s.chat.find((x) => x.id === turnId)
    if (t) t.applied = true
    if (files[0]) s.open = files[0].path
  })
  return files.map((f) => f.path)
}

export function clearChat() {
  update((s) => {
    s.chat = []
  })
}
