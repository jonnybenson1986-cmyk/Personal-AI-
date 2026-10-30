// Replies generated on the server (see netlify/shared/jobs.ts), so they finish even when the
// app is closed. Starting one returns an id the caller saves; following it reads the progress
// and turns it into the same text/thinking events a live stream gives.
import type { TeamMember } from "../../netlify/shared/team.ts"
import type { StreamEvents, StreamResult } from "./types"

/** A failed job, with the upstream HTTP status when there was one. */
export class JobError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface JobStart {
  input: {
    provider: "openrouter" | "omniroute"
    model: string
    messages: unknown[]
    reasoning?: boolean
    omnirouteUrl?: string
    request?: { path: string; body: unknown }
    team?: { task: string; members: TeamMember[] }
  }
  secrets: { openrouterKey?: string; omnirouteKey?: string }
}

/** Starts a job; undefined when this server can't run them (then the app streams directly). */
export async function startJob(req: JobStart, signal?: AbortSignal): Promise<string | undefined> {
  let res: Response
  try {
    res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal })
  } catch (e) {
    if (signal?.aborted) throw e
    return undefined
  }
  // No jobs endpoint (local dev), too large for it, or it couldn't start one.
  if ([404, 405, 413, 501, 502, 503].includes(res.status) || !res.headers.get("content-type")?.includes("json")) return undefined
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
  if (!res.ok || !body.id) throw new JobError(body.error?.message ?? `Couldn't start the reply (${res.status}).`, res.status)
  return body.id
}

/** One agent's part of a team job, as the server reports it. */
export interface StepProgress {
  name: string
  status: "waiting" | "running" | "done" | "error"
  text: string
  thinking: string
  servedBy?: string
  notice?: string
  error?: string
}

interface Progress {
  status: "queued" | "running" | "done" | "error" | "stopped"
  text: string
  thinking: string
  textLength: number
  thinkingLength: number
  servedBy?: string
  notice?: string
  error?: string
  code?: number
  route?: string
  result?: unknown
  steps?: StepProgress[]
}

/**
 * Events for picking a reply up again: the server sends it from the start, so what the app
 * saved earlier is cleared, but only once something arrives (if the job is gone, it's kept).
 */
export function restartEvents(events: StreamEvents, clear: () => void): StreamEvents {
  let cleared = false
  const once = () => {
    if (!cleared) clear()
    cleared = true
  }
  return {
    text: (d) => (once(), events.text(d)),
    thinking: (d) => (once(), events.thinking(d)),
    servedBy: (m) => events.servedBy(m),
  }
}

/** Abort reason for "stop watching, but let it finish on the server" (e.g. leaving a screen). */
export const DETACH = "detach"

const abortError = () => new DOMException("The reply was stopped.", "AbortError")

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener("abort", stop, { once: true })
  })
}

const FORGET_AFTER_MS = 5000

/** How long a job may stay queued before it counts as lost. */
const QUEUE_LIMIT_MS = 2 * 60 * 1000

/**
 * Follows a job until it ends, passing new text on as events. Stopping (the signal) cancels
 * the job on the server. Network failures are retried, since the job carries on regardless.
 */
export async function followJob(id: string, events: StreamEvents, signal: AbortSignal, onSteps?: (steps: StepProgress[]) => void): Promise<StreamResult> {
  let text = 0
  let thinking = 0
  let served = false
  let wait = 400
  const queuedSince = Date.now()
  const cancel = () => signal.reason !== DETACH && void fetch(`/api/jobs/${id}/cancel`, { method: "POST", keepalive: true }).catch(() => {})
  signal.addEventListener("abort", cancel, { once: true })
  // A finished reply is removed from the server a little later, once the app has saved it. If the
  // app closes first, it's still there to pick up next time (and is cleaned up after a day).
  const forget = () => setTimeout(() => void fetch(`/api/jobs/${id}`, { method: "DELETE", keepalive: true }).catch(() => {}), FORGET_AFTER_MS)
  try {
    for (;;) {
      if (signal.aborted) throw abortError()
      let res: Response | undefined
      try {
        res = await fetch(`/api/jobs/${id}?text=${text}&thinking=${thinking}`, { signal, cache: "no-store" })
      } catch (e) {
        if (signal.aborted) throw abortError()
        // Offline or a network blip: the job keeps going on the server, so try again soon.
        await sleep((wait = Math.min(wait * 2, 5000)), signal)
        continue
      }
      if (res.status === 404) throw new JobError("This reply is no longer on the server (replies are kept for a day).")
      if (!res.ok) {
        await sleep((wait = Math.min(wait * 2, 5000)), signal)
        continue
      }
      const p = (await res.json()) as Progress
      // A team's reports come whole each time (they're kept even if a later step fails).
      if (p.steps) onSteps?.(p.steps)
      if (!served && p.servedBy) {
        served = true
        events.servedBy(p.servedBy)
      }
      if (p.thinking) events.thinking(p.thinking)
      if (p.text) events.text(p.text)
      text = p.textLength
      thinking = p.thinkingLength
      if (p.status === "done") {
        forget()
        return { notice: p.notice, route: p.route, result: p.result }
      }
      if (p.status === "error") {
        forget()
        throw new JobError(p.error ?? "The reply failed.", p.code)
      }
      if (p.status === "stopped") {
        forget()
        throw abortError()
      }
      if (p.status === "queued" && Date.now() - queuedSince > QUEUE_LIMIT_MS) {
        forget()
        throw new JobError("The server didn't start this reply. Try again.")
      }
      wait = 600
      await sleep(wait, signal)
    }
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}
