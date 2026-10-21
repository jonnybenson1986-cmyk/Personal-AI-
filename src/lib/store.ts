import { createStore, produce, reconcile } from "solid-js/store"
import { createSignal } from "solid-js"
import { del, get, set } from "idb-keyval"
import { DEFAULT_SELECTION } from "./models"
import { errorMessage, isAbort, streamReply } from "./providers"
import type { Attachment, Conversation, ModelRef, Reply, Settings, Turn } from "./types"

const SETTINGS_KEY = "personal-ai:settings"
const INDEX_KEY = "conversations"
const convKey = (id: string) => `conversation:${id}`

export const uid = () => crypto.randomUUID()

const defaults: Settings = {
  openrouterKey: "",
  githubToken: "",
  recentRepos: [],
  system: "",
  theme: "system",
  models: DEFAULT_SELECTION,
}

function loadSettings(): Settings {
  try {
    const stored = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") } as Settings
    // Model choices saved before the switch to OpenRouter (bare ids like "claude-opus-5-5") no longer exist.
    if (!Array.isArray(stored.models) || !stored.models.length || !stored.models.every((m) => m?.id?.includes("/"))) stored.models = DEFAULT_SELECTION
    return stored
  } catch {
    return defaults
  }
}

export const [settings, setSettingsStore] = createStore<Settings>(loadSettings())

export function updateSettings(patch: Partial<Settings>) {
  setSettingsStore(patch)
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage may be unavailable (private mode); settings then last for this session.
  }
}

// Conversations live in IndexedDB: attachments make them too large for localStorage.
export const [conversations, setConversations] = createStore<Conversation[]>([])
export const [activeId, setActiveId] = createSignal<string | undefined>()
export const [loaded, setLoaded] = createSignal(false)

export async function loadConversations() {
  const ids = ((await get<string[]>(INDEX_KEY)) ?? []) as string[]
  const list = (await Promise.all(ids.map((id) => get<Conversation>(convKey(id))))).filter(Boolean) as Conversation[]
  // A reply that was streaming when the app closed can't resume.
  for (const c of list)
    for (const t of c.turns)
      for (const r of t.replies) if (r.status === "streaming") Object.assign(r, { status: r.text ? "stopped" : "error", error: r.text ? undefined : "Interrupted" })
  setConversations(list.sort((a, b) => b.updatedAt - a.updatedAt))
  setLoaded(true)
}

const pending = new Map<string, number>()
function persist(id: string) {
  // Streaming updates many times a second; write at most a few times a second.
  if (pending.has(id)) return
  pending.set(
    id,
    window.setTimeout(() => {
      pending.delete(id)
      const conv = conversations.find((c) => c.id === id)
      if (conv) void set(convKey(id), JSON.parse(JSON.stringify(conv)))
    }, 400),
  )
}

function persistIndex() {
  void set(INDEX_KEY, conversations.map((c) => c.id))
}

function mutate(id: string, fn: (c: Conversation) => void) {
  setConversations(
    (c) => c.id === id,
    produce((c) => {
      fn(c)
      c.updatedAt = Date.now()
    }),
  )
  persist(id)
}

export const activeConversation = () => conversations.find((c) => c.id === activeId())

export function newChat() {
  setActiveId(undefined)
}

export async function deleteConversation(id: string) {
  controllers.get(id)?.forEach((c) => c.abort())
  setConversations(reconcile(conversations.filter((c) => c.id !== id)))
  if (activeId() === id) setActiveId(undefined)
  persistIndex()
  await del(convKey(id))
}

export function renameConversation(id: string, title: string) {
  mutate(id, (c) => {
    c.title = title.trim() || c.title
  })
}

export async function clearAll() {
  for (const c of [...conversations]) await deleteConversation(c.id)
}

// Abort controllers for in-flight replies, per conversation.
const controllers = new Map<string, Set<AbortController>>()
export const isStreaming = (id: string | undefined) =>
  !!conversations.find((c) => c.id === id)?.turns.some((t) => t.replies.some((r) => r.status === "streaming"))

export function stop(id: string) {
  controllers.get(id)?.forEach((c) => c.abort())
}

function titleFrom(text: string, attachments: Attachment[]) {
  const line = text.trim().split("\n")[0] || attachments.find((a) => !a.name.endsWith("(file list)"))?.name || attachments[0]?.name || "New chat"
  return line.length > 48 ? line.slice(0, 47).trimEnd() + "…" : line
}

/** Sends a message: starts a chat if needed, then streams one reply per selected model. */
export function send(text: string, attachments: Attachment[], tool?: string) {
  let id = activeId()
  if (!id) {
    const now = Date.now()
    const conv: Conversation = {
      id: uid(),
      title: titleFrom(text, attachments),
      system: settings.system.trim(),
      models: settings.models.map((m) => ({ ...m })),
      turns: [],
      createdAt: now,
      updatedAt: now,
    }
    setConversations((list) => [conv, ...list])
    setActiveId(conv.id)
    persistIndex()
    id = conv.id
  }
  const turn: Turn = { id: uid(), tool, text, attachments, replies: [], createdAt: Date.now() }
  mutate(id, (c) => {
    c.models = settings.models.map((m) => ({ ...m }))
    c.turns.push(turn)
  })
  answer(id, turn.id)
}

/** Edits a past message: later turns are dropped and the message is answered again. */
export function editAndResend(convId: string, turnId: string, text: string) {
  stop(convId)
  mutate(convId, (c) => {
    const index = c.turns.findIndex((t) => t.id === turnId)
    if (index < 0) return
    c.turns[index].text = text
    c.turns[index].replies = []
    c.turns.splice(index + 1)
  })
  answer(convId, turnId)
}

/** Regenerates the replies to the last message. */
export function regenerate(convId: string) {
  const conv = conversations.find((c) => c.id === convId)
  const last = conv?.turns[conv.turns.length - 1]
  if (!conv || !last) return
  stop(convId)
  mutate(convId, (c) => {
    c.models = settings.models.map((m) => ({ ...m }))
    c.turns[c.turns.length - 1].replies = []
  })
  answer(convId, last.id)
}

function answer(convId: string, turnId: string) {
  const conv = conversations.find((c) => c.id === convId)!
  for (const model of conv.models) void streamOne(convId, turnId, model)
}

function track(convId: string) {
  const controller = new AbortController()
  if (!controllers.has(convId)) controllers.set(convId, new Set())
  controllers.get(convId)!.add(controller)
  return { controller, done: () => controllers.get(convId)?.delete(controller) }
}

function addReply(convId: string, turnId: string, reply: Reply) {
  mutate(convId, (c) => c.turns.find((t) => t.id === turnId)?.replies.push(reply))
  return (fn: (r: Reply) => void) =>
    mutate(convId, (c) => {
      const r = c.turns.find((t) => t.id === turnId)?.replies.find((x) => x.id === reply.id)
      if (r) fn(r)
    })
}

async function streamOne(convId: string, turnId: string, model: ModelRef) {
  const reply: Reply = { id: uid(), model: { ...model }, text: "", thinking: "", status: "streaming", createdAt: Date.now() }
  const update = addReply(convId, turnId, reply)
  const { controller, done } = track(convId)

  const snapshot = JSON.parse(JSON.stringify(conversations.find((c) => c.id === convId))) as Conversation
  const index = snapshot.turns.findIndex((t) => t.id === turnId)

  try {
    const result = await streamReply({
      conversation: snapshot,
      history: snapshot.turns.slice(0, index),
      current: snapshot.turns[index],
      model,
      credentials: settings,
      signal: controller.signal,
      events: {
        text: (d) => update((r) => (r.text += d)),
        thinking: (d) => update((r) => (r.thinking += d)),
        servedBy: (m) => update((r) => (r.servedBy = m)),
      },
    })
    update((r) => {
      r.status = "done"
      if (result.notice) r.error = result.notice
    })
  } catch (error) {
    update((r) => {
      if (isAbort(error)) r.status = "stopped"
      else {
        r.status = "error"
        r.error = errorMessage(error)
      }
    })
  } finally {
    done()
  }
}
