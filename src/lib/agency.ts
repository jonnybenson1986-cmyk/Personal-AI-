// The Agents screen's work: tasks given to agents from The Agency, run on the site's server
// when possible (so they finish with the app closed) or in the app otherwise, and the reports
// they come back with. Tasks are kept in IndexedDB.
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { get, set } from "idb-keyval"
import { type TeamMember, teamMessages } from "../../netlify/shared/team.ts"
import type { AgentIndex, AgentInfo } from "./agents"
import { pickContext } from "./cowork"
import { DETACH, followJob, type StepProgress, startJob } from "./jobs"
import { omniConfigured, webSearch } from "./omniapi"
import { errorMessage, isAbort, serverTarget, streamChat } from "./providers"
import { searchHits } from "./omni"
import { settings, uid } from "./store"

export interface TaskStep {
  slug: string
  name: string
  emoji?: string
  status: "waiting" | "running" | "done" | "error"
  text: string
  servedBy?: string
  notice?: string
  error?: string
}

export interface AgentTask {
  id: string
  /** What the user asked for. */
  task: string
  /** What went with it: "notes.md", "example.com", "Web search"… */
  context: string[]
  status: "preparing" | "running" | "done" | "error" | "stopped"
  /** The server job, while it runs there. */
  job?: string
  steps: TaskStep[]
  error?: string
  at: number
  /** Whether the finished report has been looked at. */
  seen?: boolean
}

export interface ContextOptions {
  /** Cowork files (the ones picked there, or all). */
  cowork: boolean
  /** Search the web for the task first (OmniRoute). */
  search: boolean
}

const KEY = "agents:tasks"
const URLS = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g
const MAX_PAGES = 3

export const [agency, setAgency] = createStore<{ tasks: AgentTask[] }>({ tasks: [] })

let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
function save() {
  if (!loaded) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void set(KEY, structuredClone(unwrap(agency))).catch(() => {}), 300)
}

function edit(id: string, fn: (t: AgentTask) => void) {
  setAgency("tasks", (t) => t.id === id, produce(fn))
  save()
}

const controllers = new Map<string, AbortController>()

// The roster and briefs are static files made by scripts/import-agents.ts.
let index: Promise<AgentIndex> | undefined
export function loadIndex() {
  index ??= fetch("/agents/index.json").then((r) => {
    if (!r.ok) throw new Error("Couldn't load the agents.")
    return r.json() as Promise<AgentIndex>
  })
  index.catch(() => (index = undefined))
  return index
}

const briefs = new Map<string, Promise<string>>()
export function loadBrief(slug: string) {
  if (!briefs.has(slug))
    briefs.set(
      slug,
      fetch(`/agents/${encodeURIComponent(slug)}.md`).then((r) => {
        if (!r.ok) throw new Error("Couldn't load that agent's brief.")
        return r.text()
      }),
    )
  const p = briefs.get(slug)!
  p.catch(() => briefs.delete(slug))
  return p
}

async function readUrl(url: string) {
  const res = await fetch(`/api/read?url=${encodeURIComponent(url)}`)
  const body = (await res.json().catch(() => ({}))) as { title?: string; text?: string; url?: string }
  if (!res.ok || !body.text) return undefined
  return { title: body.title || new URL(url).hostname, url: body.url ?? url, text: body.text.slice(0, 40_000) }
}

/** The task with what goes with it: Cowork files, web pages it links to, and search results. */
async function withContext(task: string, opts: ContextOptions) {
  const parts: string[] = [task]
  const labels: string[] = []
  if (opts.cowork) {
    const { cw, restoreCowork } = await import("./coworkspace")
    await restoreCowork()
    const files = pickContext(cw.files, task, cw.picked, 80_000)
    if (files.length) {
      parts.push(`Files from the user's Cowork space:\n\n${files.map((f) => `<file path="${f.path}"${f.truncated ? ' truncated="true"' : ""}>\n${f.text}\n</file>`).join("\n\n")}`)
      labels.push(...files.map((f) => f.path))
    }
  }
  const urls = [...new Set(task.match(URLS) ?? [])].slice(0, MAX_PAGES)
  const pages = (await Promise.all(urls.map((u) => readUrl(u).catch(() => undefined)))).filter((p) => !!p)
  if (pages.length) {
    parts.push(`Web pages linked in the task:\n\n${pages.map((p) => `<page url="${p.url}" title="${p.title}">\n${p.text}\n</page>`).join("\n\n")}`)
    labels.push(...pages.map((p) => new URL(p.url).hostname))
  }
  if (opts.search && omniConfigured()) {
    try {
      const { hits, answer } = searchHits(await webSearch(task.replace(URLS, "").slice(0, 300), { max: 8 }))
      if (hits.length) {
        parts.push(`Web search results for the task:\n\n${answer ? `Summary: ${answer}\n\n` : ""}${hits.map((h, i) => `${i + 1}. ${h.title} (${h.url})\n${h.snippet}`).join("\n\n")}`)
        labels.push("Web search")
      }
    } catch {
      // No search provider connected in OmniRoute: carry on without it.
    }
  }
  return { text: parts.join("\n\n---\n\n"), labels }
}

function applySteps(id: string, steps: StepProgress[]) {
  edit(id, (t) => {
    steps.forEach((s, i) => {
      const step = t.steps[i]
      if (step) Object.assign(step, { status: s.status, text: s.text, servedBy: s.servedBy, notice: s.notice, error: s.error })
    })
  })
}

/** Tells the user a report is in, if the app is in the background and they allowed it. */
async function notify(task: AgentTask) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  const title = task.status === "done" ? "Report ready" : "Task stopped"
  const body = `${task.steps.map((s) => s.name).join(" → ")}: ${task.task.slice(0, 80)}`
  if (reg) await reg.showNotification(title, { body, tag: task.id }).catch(() => {})
  else new Notification(title, { body })
}

function finish(id: string, fn: (t: AgentTask) => void) {
  edit(id, (t) => {
    fn(t)
    t.job = undefined
    t.seen = false
    // Steps that never started stay waiting; one cut short is marked.
    for (const s of t.steps) if (s.status === "running") s.status = t.status === "done" ? "done" : "error"
  })
  const t = agency.tasks.find((x) => x.id === id)
  if (t) void notify(t)
}

/** Runs the team: as one server job when the server can, otherwise step by step here. */
async function run(id: string, members: TeamMember[], task: string) {
  const controller = new AbortController()
  controllers.set(id, controller)
  const signal = controller.signal
  const model = settings.models[0]
  try {
    edit(id, (t) => (t.status = "running"))
    const target = serverTarget(settings)
    const job = target && (await startJob({ input: { ...target.where, model: model.id, messages: [], team: { task, members } }, secrets: target.secrets }, signal))
    if (job) {
      edit(id, (t) => (t.job = job))
      await followJob(job, { text: () => {}, thinking: () => {}, servedBy: () => {} }, signal, (steps) => applySteps(id, steps))
    } else {
      const reports: string[] = []
      for (let i = 0; i < members.length; i++) {
        edit(id, (t) => (t.steps[i].status = "running"))
        const result = await streamChat({
          messages: teamMessages(task, members, i, reports),
          model,
          credentials: settings,
          signal,
          events: {
            text: (d) => edit(id, (t) => (t.steps[i].text += d)),
            thinking: () => {},
            servedBy: (m) => edit(id, (t) => (t.steps[i].servedBy = m)),
          },
        })
        edit(id, (t) => Object.assign(t.steps[i], { status: "done", notice: result.notice }))
        reports.push(agency.tasks.find((t) => t.id === id)!.steps[i].text)
      }
    }
    finish(id, (t) => (t.status = "done"))
  } catch (e) {
    if (signal.reason === DETACH) return
    finish(id, (t) => {
      if (isAbort(e)) t.status = "stopped"
      else {
        t.status = "error"
        t.error = errorMessage(e)
      }
    })
  } finally {
    controllers.delete(id)
  }
}

/** Gives a task to one agent, or a team working in the order given. */
export async function assign(task: string, agents: AgentInfo[], opts: ContextOptions) {
  const id = uid()
  setAgency("tasks", (list) => [
    { id, task, context: [], status: "preparing", steps: agents.map((a) => ({ slug: a.slug, name: a.name, emoji: a.emoji, status: "waiting", text: "" })), at: Date.now() },
    ...list,
  ])
  save()
  try {
    const [members, context] = await Promise.all([Promise.all(agents.map(async (a) => ({ name: a.name, brief: await loadBrief(a.slug) }))), withContext(task, opts)])
    edit(id, (t) => (t.context = context.labels))
    await run(id, members, context.text)
  } catch (e) {
    finish(id, (t) => {
      t.status = "error"
      t.error = errorMessage(e)
    })
  }
  return id
}

export function stopTask(id: string) {
  controllers.get(id)?.abort()
}

export function removeTask(id: string) {
  controllers.get(id)?.abort()
  setAgency("tasks", (list) => list.filter((t) => t.id !== id))
  save()
}

export function markSeen() {
  if (agency.tasks.some((t) => t.seen === false)) {
    setAgency("tasks", (t) => t.seen === false, "seen", true)
    save()
  }
}

/** Finished reports not looked at yet. */
export const unseenReports = () => agency.tasks.filter((t) => t.seen === false).length

let restoring: Promise<void> | undefined
/** Loads saved tasks once, and picks up ones still running on the server. */
export function restoreAgency() {
  restoring ??= (async () => {
    const saved = await get<{ tasks: AgentTask[] }>(KEY).catch(() => undefined)
    if (saved?.tasks) setAgency(reconcile({ tasks: saved.tasks }))
    loaded = true
    for (const t of agency.tasks) {
      if (t.status !== "running" && t.status !== "preparing") continue
      if (!t.job) {
        finish(t.id, (x) => {
          x.status = "stopped"
          x.error = "Interrupted when the app closed."
        })
        continue
      }
      const job = t.job
      const controller = new AbortController()
      controllers.set(t.id, controller)
      followJob(job, { text: () => {}, thinking: () => {}, servedBy: () => {} }, controller.signal, (steps) => applySteps(t.id, steps))
        .then(
          () => finish(t.id, (x) => (x.status = "done")),
          (e) =>
            finish(t.id, (x) => {
              if (isAbort(e)) x.status = "stopped"
              else {
                x.status = "error"
                x.error = errorMessage(e)
              }
            }),
        )
        .finally(() => controllers.delete(t.id))
    }
  })()
  return restoring
}
