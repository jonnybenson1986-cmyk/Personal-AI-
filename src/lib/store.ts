import { createStore, produce, reconcile } from "solid-js/store"
import { createSignal } from "solid-js"
import { del, get, set } from "idb-keyval"
import { DEFAULT_SELECTION } from "./models"
import { deleteMedia, generateImage, generateVideo, saveMedia } from "./media"
import { errorMessage, isAbort, streamReply } from "./providers"
import type { Attachment, Conversation, ModelRef, Reply, Settings, Turn, TurnMode } from "./types"

const SETTINGS_KEY = "personal-ai:settings"
const INDEX_KEY = "conversations"
const convKey = (id: string) => `conversation:${id}`

export const uid = () => crypto.randomUUID()

const defaults: Settings = {
  passcode: "",
  system: "",
  effort: "medium",
  webSearch: true,
  theme: "system",
  models: DEFAULT_SELECTION,
  imageModel: "gpt-image-2",
  videoModel: "sora-2",
  shape: "square",
  videoSeconds: "8",
}

function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }
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
      for (const r of t.replies) if (r.status === "streaming") Object.assign(r, { status: r.text ? "stopped" : "error", error: r.text ? undefined : "Interrupted", activity: undefined })
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
  for (const turn of conversations.find((c) => c.id === id)?.turns ?? [])
    for (const reply of turn.replies) if (reply.media?.id) void deleteMedia(reply.media.id)
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
  const line = text.trim().split("\n")[0] || attachments[0]?.name || "New chat"
  return line.length > 48 ? line.slice(0, 47).trimEnd() + "…" : line
}

/** Previews of images still being drawn, by reply id. Not persisted. */
export const [previews, setPreviews] = createStore<Record<string, string>>({})

/** Sends a message: starts a chat if needed, then streams one reply per selected model. */
export function send(text: string, attachments: Attachment[], mode: TurnMode = "chat") {
  let id = activeId()
  if (!id) {
    const now = Date.now()
    const conv: Conversation = {
      id: uid(),
      title: titleFrom(text, attachments),
      system: settings.system.trim(),
      webSearch: settings.webSearch,
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
  const turn: Turn = { id: uid(), mode, text, attachments, replies: [], createdAt: Date.now() }
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
  const turn = conv.turns.find((t) => t.id === turnId)!
  if (turn.mode === "image" || turn.mode === "video") return void createMedia(convId, turnId, turn.mode)
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

/** Image and video turns go straight to OpenAI's image or video model. */
async function createMedia(convId: string, turnId: string, kind: "image" | "video") {
  const turn = conversations.find((c) => c.id === convId)!.turns.find((t) => t.id === turnId)!
  const prompt = turn.text
  const images = turn.attachments.filter((a) => a.mediaType.startsWith("image/"))
  const model = { provider: "openai" as const, id: kind === "image" ? settings.imageModel : settings.videoModel }
  const reply: Reply = { id: uid(), model, text: "", thinking: "", sources: [], status: "streaming", media: { kind, prompt }, createdAt: Date.now() }
  const update = addReply(convId, turnId, reply)
  const { controller, done } = track(convId)
  update((r) => (r.activity = kind === "image" ? "Creating image" : "Starting video"))
  try {
    const blob =
      kind === "image"
        ? await generateImage({
            passcode: settings.passcode,
            model: model.id,
            prompt,
            shape: settings.shape,
            references: images,
            signal: controller.signal,
            onPartial: (b) => {
              const old = previews[reply.id]
              setPreviews(reply.id, URL.createObjectURL(b))
              if (old) URL.revokeObjectURL(old)
            },
          })
        : await generateVideo({
            passcode: settings.passcode,
            model: model.id,
            prompt,
            shape: settings.shape,
            seconds: settings.videoSeconds,
            reference: images[0],
            signal: controller.signal,
            onProgress: (progress, status) =>
              update((r) => {
                r.media!.progress = progress
                r.activity = status === "downloading" ? "Downloading video" : status === "queued" ? "Waiting in queue" : "Rendering video"
              }),
          })
    const mediaId = `media-${reply.id}`
    await saveMedia(mediaId, blob)
    update((r) => {
      r.status = "done"
      r.activity = undefined
      r.media!.id = mediaId
    })
  } catch (error) {
    update((r) => {
      r.activity = undefined
      if (isAbort(error)) r.status = "stopped"
      else {
        r.status = "error"
        r.error = errorMessage(error)
      }
    })
  } finally {
    done()
    const preview = previews[reply.id]
    if (preview) {
      URL.revokeObjectURL(preview)
      setPreviews(reply.id, undefined!)
    }
  }
}

async function streamOne(convId: string, turnId: string, model: ModelRef) {
  const reply: Reply = { id: uid(), model: { ...model }, text: "", thinking: "", sources: [], status: "streaming", createdAt: Date.now() }
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
      effort: settings.effort,
      passcode: settings.passcode,
      signal: controller.signal,
      events: {
        text: (d) => update((r) => (r.text += d)),
        thinking: (d) => update((r) => (r.thinking += d)),
        activity: (a) => update((r) => (r.activity = a)),
        source: (s) => update((r) => !r.sources.some((x) => x.url === s.url) && r.sources.push(s)),
      },
    })
    update((r) => {
      r.status = "done"
      r.activity = undefined
      r.raw = result.raw
      if (result.notice) r.error = result.notice
    })
  } catch (error) {
    update((r) => {
      r.activity = undefined
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
