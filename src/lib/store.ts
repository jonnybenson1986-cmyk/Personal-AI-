import { createStore, produce, reconcile } from "solid-js/store"
import { createSignal } from "solid-js"
import { del, get, set } from "idb-keyval"
import { DEFAULT_SELECTION, GATEWAY_AUTO } from "./models"
import { errorMessage, isAbort, resumeChat, streamReply } from "./providers"
import type { Attachment, Conversation, ModelRef, RepoTarget, Reply, Settings, Turn } from "./types"

const SETTINGS_KEY = "personal-ai:settings"
const INDEX_KEY = "conversations"
const convKey = (id: string) => `conversation:${id}`

export const uid = () => crypto.randomUUID()

const defaults: Settings = {
  provider: "openrouter",
  omnirouteUrl: "",
  omnirouteKey: "",
  openrouterKey: "",
  githubToken: "",
  recentRepos: [],
  system: "",
  theme: "system",
  models: DEFAULT_SELECTION,
  background: true,
}

function loadSettings(): Settings {
  try {
    const stored = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") } as Settings
    // Model choices saved before the switch to OpenRouter (bare ids like "claude-opus-5-5") no longer exist.
    if (!Array.isArray(stored.models) || !stored.models.length || (stored.provider !== "omniroute" && !stored.models.every((m) => m?.id?.includes("/"))))
      stored.models = stored.provider === "omniroute" ? [{ id: GATEWAY_AUTO }] : DEFAULT_SELECTION
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
  // A reply that was streaming in the app when it closed can't resume; one running on the server can.
  const resumable: [string, string, string, string][] = []
  for (const c of list)
    for (const t of c.turns)
      for (const r of t.replies) {
        if (r.status !== "streaming") continue
        if (r.job) resumable.push([c.id, t.id, r.id, r.job])
        else Object.assign(r, { status: r.text ? "stopped" : "error", error: r.text ? undefined : "Interrupted" })
      }
  setConversations(list.sort((a, b) => b.updatedAt - a.updatedAt))
  setLoaded(true)
  for (const [convId, turnId, replyId, job] of resumable) void resumeOne(convId, turnId, replyId, job)
}

const pending = new Map<string, number>()
function persist(id: string) {
  // Streaming updates many times a second; write at most a few times a second.
  if (pending.has(id)) return
  pending.set(id, window.setTimeout(() => save(id), 400))
}

function save(id: string) {
  clearTimeout(pending.get(id))
  pending.delete(id)
  const conv = conversations.find((c) => c.id === id)
  return conv ? set(convKey(id), JSON.parse(JSON.stringify(conv))) : Promise.resolve()
}

// Write anything still waiting when the app is hidden or closed.
addEventListener("pagehide", () => [...pending.keys()].forEach((id) => void save(id)))
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && [...pending.keys()].forEach((id) => void save(id)))

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

/** An agent the next new chat talks to: its brief becomes the chat's system prompt. */
export const [chatPersona, setChatPersona] = createSignal<{ name: string; system: string }>()

export function newChat() {
  setActiveId(undefined)
  setChatPersona(undefined)
}

/** Opens a new chat with an agent from the Agents screen. */
export function chatWith(name: string, system: string) {
  setActiveId(undefined)
  setChatPersona({ name, system })
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
export function send(text: string, attachments: Attachment[], tool?: string, repo?: RepoTarget) {
  let id = activeId()
  if (!id) {
    const now = Date.now()
    const persona = chatPersona()
    setChatPersona(undefined)
    const conv: Conversation = {
      id: uid(),
      title: persona ? `${persona.name}: ${titleFrom(text, attachments)}` : titleFrom(text, attachments),
      system: persona ? [persona.system, settings.system.trim()].filter(Boolean).join("\n\n") : settings.system.trim(),
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
  const conv = conversations.find((c) => c.id === id)!
  // A repo stays connected for the rest of the chat once added.
  const target = repo ?? conv.repo
  const turn: Turn = { id: uid(), tool, repo: target && { ...target }, text, attachments, replies: [], createdAt: Date.now() }
  mutate(id, (c) => {
    c.models = settings.models.map((m) => ({ ...m }))
    if (target) c.repo = { ...target }
    c.turns.push(turn)
  })
  answer(id, turn.id)
}

export function markPushed(convId: string, replyId: string, pushed: NonNullable<Reply["pushed"]>) {
  mutate(convId, (c) => {
    for (const t of c.turns) for (const r of t.replies) if (r.id === replyId) r.pushed = pushed
  })
  // Saved straight away so the push card can't come back and push twice.
  return save(convId)
}

/** Stops later messages in this chat being about the connected repo. */
export function disconnectRepo(convId: string) {
  mutate(convId, (c) => {
    c.repo = undefined
  })
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

const replyUpdater = (convId: string, turnId: string, replyId: string) => (fn: (r: Reply) => void) =>
  mutate(convId, (c) => {
    const r = c.turns.find((t) => t.id === turnId)?.replies.find((x) => x.id === replyId)
    if (r) fn(r)
  })

function addReply(convId: string, turnId: string, reply: Reply) {
  mutate(convId, (c) => c.turns.find((t) => t.id === turnId)?.replies.push(reply))
  return replyUpdater(convId, turnId, reply.id)
}

const replyEvents = (update: (fn: (r: Reply) => void) => void) => ({
  text: (d: string) => update((r) => (r.text += d)),
  thinking: (d: string) => update((r) => (r.thinking += d)),
  servedBy: (m: string) => update((r) => (r.servedBy = m)),
})

async function settle(run: Promise<{ notice?: string; route?: string }>, update: (fn: (r: Reply) => void) => void, done: () => void) {
  try {
    const result = await run
    update((r) => {
      r.status = "done"
      r.job = undefined
      if (result.route) r.route = result.route
      if (result.notice) r.error = result.notice
    })
  } catch (error) {
    update((r) => {
      r.job = undefined
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

/** Picks up a reply that kept going on the server while the app was closed. */
function resumeOne(convId: string, turnId: string, replyId: string, job: string) {
  const update = replyUpdater(convId, turnId, replyId)
  const clear = () =>
    update((r) => {
      r.text = ""
      r.thinking = ""
    })
  const { controller, done } = track(convId)
  return settle(resumeChat(job, settings, replyEvents(update), controller.signal, clear), update, done)
}

async function streamOne(convId: string, turnId: string, model: ModelRef) {
  const reply: Reply = { id: uid(), model: { ...model }, text: "", thinking: "", status: "streaming", createdAt: Date.now() }
  const update = addReply(convId, turnId, reply)
  const { controller, done } = track(convId)

  const snapshot = JSON.parse(JSON.stringify(conversations.find((c) => c.id === convId))) as Conversation
  const index = snapshot.turns.findIndex((t) => t.id === turnId)

  await settle(
    streamReply({
      conversation: snapshot,
      history: snapshot.turns.slice(0, index),
      current: snapshot.turns[index],
      model,
      credentials: settings,
      signal: controller.signal,
      events: replyEvents(update),
      job: {
        started: (id) => {
          update((r) => (r.job = id))
          void save(convId)
        },
      },
    }),
    update,
    done,
  )
}
