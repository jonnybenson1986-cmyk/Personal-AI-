// Background AI jobs: a reply is generated on the server, so it keeps going when the app is
// closed or the phone locks. The app posts the request to /api/jobs (an edge function), which
// saves it and starts the run-job background function (up to 15 minutes). That function
// streams from OpenRouter or OmniRoute and saves the text as it arrives. The app reads the
// progress back, and picks the reply up again when it's opened later.
//
// Keys are never stored: they travel with the start request only. The request itself is
// deleted as soon as the job starts, and finished jobs are deleted once the app has them (or
// after a day).
import { gatewayBase, siteGateway } from "./gateway.ts"
import { isFreeModel, json, PLACEHOLDER_KEY } from "./proxy.ts"
import { readTeam, type TeamMember, teamMessages } from "./team.ts"

export interface JobStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

export interface JobInput {
  provider: "openrouter" | "omniroute"
  model: string
  messages: unknown[]
  reasoning?: boolean
  /** Public https address of the user's OmniRoute gateway; without one, the site's own (OMNIROUTE_URL). */
  omnirouteUrl?: string
  /** An OmniRoute request other than chat (video, music, OCR…), whose JSON answer is kept whole. */
  request?: { path: string; body: unknown }
  /** Agents working on a task in order, each reporting back (see team.ts). */
  team?: { task: string; members: TeamMember[] }
}

/** One agent's part of a team job. */
export interface StepRecord {
  name: string
  status: "waiting" | "running" | "done" | "error"
  text: string
  thinking: string
  servedBy?: string
  notice?: string
  error?: string
}

/** The slow OmniRoute endpoints that may run as jobs. */
export const OMNI_JOB_PATH = /^\/v1\/(videos\/generations|music\/generations|images\/generations|ocr|search|web\/fetch)$/

export interface JobSecrets {
  openrouterKey?: string
  omnirouteKey?: string
}

export interface JobRecord {
  status: "queued" | "running" | "done" | "error" | "stopped"
  text: string
  thinking: string
  servedBy?: string
  notice?: string
  error?: string
  /** HTTP status of a failed upstream request, so the app can explain it. */
  code?: number
  /** OmniRoute's routing decision (its X-OmniRoute-Decision header). */
  route?: string
  /** The JSON answer of a non-chat request. */
  result?: unknown
  /** Each agent's report, for a team job. */
  steps?: StepRecord[]
  updated: number
}

const MAX_INPUT = 8 * 1024 * 1024
const KEEP_MS = 24 * 60 * 60 * 1000
/** Stops a little before the 15-minute limit, so the job can still record what happened. */
const RUN_LIMIT_MS = 14 * 60 * 1000
const SAVE_EVERY_MS = 700

export const OPENROUTER_ORIGIN = "https://openrouter.ai/api"

/** The time in the id lets old jobs be cleaned up without reading them. */
export const newJobId = () => `${Date.now().toString(36)}-${crypto.randomUUID()}`
export const validJobId = (id: string) => /^[0-9a-z]{6,12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
const jobTime = (id: string) => parseInt(id.split("-")[0], 36)

const userOpenRouterKey = (k?: string) => (k && k !== PLACEHOLDER_KEY && k.startsWith("sk-or-") ? k : undefined)

/** Where a job's request goes and with which key, or why it can't run. */
export function upstreamFor(input: JobInput, secrets: JobSecrets, env: (name: string) => string | undefined, openrouterOrigin = OPENROUTER_ORIGIN) {
  if (input.provider === "omniroute") {
    // No address from the app means the site's own gateway, with the site's key.
    const site = input.omnirouteUrl ? undefined : siteGateway(env)
    const base = site?.base ?? gatewayBase(input.omnirouteUrl ?? null)
    if (!base) return { error: "Background replies need a public https:// OmniRoute address.", code: 400 }
    const key = site?.key ?? secrets.omnirouteKey
    if (!key) return { error: "Add your OmniRoute API key in Settings.", code: 401 }
    if (input.request) return { url: base + input.request.path, key, extra: {} }
    return { url: `${base}/v1/chat/completions`, key, extra: input.reasoning ? { reasoning_effort: "high" } : {} }
  }
  let key = userOpenRouterKey(secrets.openrouterKey)
  if (!key) {
    key = env("OPENROUTER_API_KEY")
    if (!key) return { error: "Add your free OpenRouter key in Settings to start chatting.", code: 401 }
    if (!isFreeModel(input.model)) return { error: "The site's key only works with free models.", code: 403 }
  }
  return { url: `${openrouterOrigin}/v1/chat/completions`, key, extra: input.reasoning ? { reasoning: { effort: "high" } } : {} }
}

function readInput(raw: unknown): JobInput | string {
  const i = raw as Partial<JobInput> | undefined
  if (!i || (i.provider !== "openrouter" && i.provider !== "omniroute")) return "Unknown provider."
  const omnirouteUrl = typeof i.omnirouteUrl === "string" ? i.omnirouteUrl : undefined
  if (i.request !== undefined) {
    const r = i.request as { path?: unknown; body?: unknown }
    if (i.provider !== "omniroute" || typeof r?.path !== "string" || !OMNI_JOB_PATH.test(r.path) || !r.body || typeof r.body !== "object") return "Not allowed."
    return { provider: "omniroute", model: typeof i.model === "string" ? i.model.slice(0, 200) : "", messages: [], omnirouteUrl, request: { path: r.path, body: r.body } }
  }
  if (typeof i.model !== "string" || !i.model || i.model.length > 200) return "Missing model."
  if (i.team !== undefined) {
    const team = readTeam(i.team)
    if (typeof team === "string") return team
    return { provider: i.provider, model: i.model, messages: [], reasoning: !!i.reasoning, omnirouteUrl, team }
  }
  if (!Array.isArray(i.messages) || !i.messages.length) return "Missing messages."
  return { provider: i.provider, model: i.model, messages: i.messages, reasoning: !!i.reasoning, omnirouteUrl }
}

/**
 * The /api/jobs endpoints:
 * POST /api/jobs {input, secrets} starts a job and returns {id};
 * GET /api/jobs/:id?text=N&thinking=M returns its progress (text after the first N characters);
 * POST /api/jobs/:id/cancel stops it; DELETE /api/jobs/:id removes it.
 */
export async function jobsApi(req: Request, deps: { store: JobStore; env: (name: string) => string | undefined; start: (body: string) => Promise<Response> }) {
  const url = new URL(req.url)
  const [, , , id, action] = url.pathname.split("/")
  const { store } = deps

  if (!id) {
    if (req.method !== "POST") return json(405, { error: { message: "Method not allowed" } })
    const body = await req.text()
    if (body.length > MAX_INPUT) return json(413, { error: { message: "That's too much to send in one message." } })
    let parsed: { input?: unknown; secrets?: JobSecrets }
    try {
      parsed = JSON.parse(body)
    } catch {
      return json(400, { error: { message: "Invalid request." } })
    }
    const input = readInput(parsed.input)
    if (typeof input === "string") return json(400, { error: { message: input } })
    const secrets: JobSecrets = { openrouterKey: parsed.secrets?.openrouterKey, omnirouteKey: parsed.secrets?.omnirouteKey }
    // Problems that are known now are reported now, not as a failed job.
    const up = upstreamFor(input, secrets, deps.env)
    if ("error" in up) return json(up.code ?? 400, { error: { message: up.error } })
    const jobId = newJobId()
    await store.set(`input/${jobId}`, input)
    await store.set(`job/${jobId}`, { status: "queued", text: "", thinking: "", updated: Date.now() } satisfies JobRecord)
    let started: Response | undefined
    try {
      started = await deps.start(JSON.stringify({ id: jobId, secrets }))
    } catch {
      // Handled below.
    }
    if (!started || started.status >= 300) {
      await Promise.all([store.delete(`input/${jobId}`), store.delete(`job/${jobId}`)])
      return json(503, { error: { message: "Background replies aren't available on this server." } })
    }
    return json(201, { id: jobId })
  }

  if (!validJobId(id)) return json(404, { error: { message: "No such job." } })
  if (req.method === "GET" && !action) {
    const job = (await store.get(`job/${id}`)) as JobRecord | null
    if (!job) return json(404, { error: { message: "This reply is no longer on the server." } })
    const from = (name: string) => Math.max(0, Number(url.searchParams.get(name)) || 0)
    return json(200, { ...job, text: job.text.slice(from("text")), thinking: job.thinking.slice(from("thinking")), textLength: job.text.length, thinkingLength: job.thinking.length })
  }
  if (req.method === "POST" && action === "cancel") {
    await store.set(`cancel/${id}`, true)
    return json(200, { ok: true })
  }
  if (req.method === "DELETE" && !action) {
    await Promise.all([store.delete(`job/${id}`), store.delete(`cancel/${id}`), store.delete(`input/${id}`)])
    return json(200, { ok: true })
  }
  return json(405, { error: { message: "Method not allowed" } })
}

/** Removes jobs (and leftovers) older than a day. */
export async function purgeOld(store: JobStore, now = Date.now()) {
  for (const prefix of ["job/", "input/", "cancel/"]) {
    const keys = await store.list(prefix)
    await Promise.all(keys.filter((k) => now - jobTime(k.slice(prefix.length)) > KEEP_MS).map((k) => store.delete(k)))
  }
}

interface Chunk {
  model?: string
  error?: { message?: string }
  choices?: { finish_reason?: string | null; delta?: { content?: string | null; reasoning?: string | null; reasoning_details?: { text?: string; summary?: string }[] } }[]
}

/** Reads an SSE chat-completions stream into the record, calling `progress` as it goes. */
export async function readStream(body: ReadableStream<Uint8Array>, job: JobRecord, progress: () => Promise<void>) {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop()!
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (!data || data === "[DONE]") continue
      let chunk: Chunk
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) throw new Error(chunk.error.message ?? "The model stopped with an error.")
      // OmniRoute's "keepalive" chunks aren't from a model.
      if (!job.servedBy && chunk.model && chunk.model !== "keepalive") job.servedBy = chunk.model
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning) job.thinking += delta.reasoning
      else for (const d of delta?.reasoning_details ?? []) job.thinking += d.text ?? d.summary ?? ""
      if (delta?.content) job.text += delta.content
      if (choice?.finish_reason === "length") job.notice = "The response hit the length limit."
      if (choice?.finish_reason === "error") throw new Error("The model stopped with an error. Try again or pick another model.")
    }
    await progress()
  }
}

/** Runs a job to the end. Called by the background function; never throws (a throw would retry it). */
export async function runJob(id: string, secrets: JobSecrets, deps: { store: JobStore; env: (name: string) => string | undefined; openrouterOrigin?: string; siteUrl?: string }) {
  const { store } = deps
  if (!validJobId(id)) return
  const input = (await store.get(`input/${id}`)) as JobInput | null
  // Unknown, or already started (a retry of this function): nothing to do.
  if (!input) return
  await store.delete(`input/${id}`)
  await purgeOld(store).catch(() => {})

  const job: JobRecord = { status: "running", text: "", thinking: "", updated: Date.now() }
  const save = () => store.set(`job/${id}`, { ...job, updated: Date.now() })
  const up = upstreamFor(input, secrets, deps.env, deps.openrouterOrigin)
  if ("error" in up) {
    Object.assign(job, { status: "error", error: up.error, code: up.code })
    return void (await save().catch(() => {}))
  }
  await save().catch(() => {})
  // Stopped in the app, which has stopped asking about it, so nothing needs keeping.
  const forget = () => Promise.all([store.delete(`job/${id}`), store.delete(`cancel/${id}`)]).catch(() => {})
  if (await store.get(`cancel/${id}`)) return void (await forget())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error("timeout")), RUN_LIMIT_MS)
  let lastSave = Date.now()
  const progress = async () => {
    if (Date.now() - lastSave < SAVE_EVERY_MS) return
    lastSave = Date.now()
    if (await store.get(`cancel/${id}`)) controller.abort(new Error("cancelled"))
    await save().catch(() => {})
  }
  // A request that answers all at once gives no progress to check for cancelling, so check on a timer.
  const watch = input.request
    ? setInterval(() => void store.get(`cancel/${id}`).then((c) => c && controller.abort(new Error("cancelled")), () => {}), 2000)
    : undefined
  const post = (body: unknown) =>
    fetch(up.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${up.key}`,
        "content-type": "application/json",
        accept: input.request ? "application/json" : "text/event-stream",
        ...(deps.siteUrl ? { "http-referer": deps.siteUrl } : {}),
        "x-openrouter-title": "Jonny's AI project",
      },
      body: JSON.stringify(body),
    })
  const failure = async (res: Response) => {
    const text = await res.text().catch(() => "")
    let message = text.slice(0, 500) || `Request failed (${res.status})`
    try {
      const body = JSON.parse(text)
      message = body?.error?.message ?? body?.message ?? message
    } catch {
      // Not JSON: keep the text.
    }
    return { message, code: res.status }
  }
  try {
    if (input.team) {
      // Each agent in turn, with the reports before it; the job is done when the last one is.
      const { task, members } = input.team
      const steps: StepRecord[] = members.map((m) => ({ name: m.name, status: "waiting", text: "", thinking: "" }))
      job.steps = steps
      const reports: string[] = []
      for (let i = 0; i < members.length && job.status === "running"; i++) {
        const step = steps[i]
        step.status = "running"
        await save().catch(() => {})
        const res = await post({ model: input.model, messages: teamMessages(task, members, i, reports), stream: true, ...up.extra })
        job.route = res.headers.get("x-omniroute-decision") ?? job.route
        if (!res.ok || !res.body) {
          const f = await failure(res)
          Object.assign(step, { status: "error", error: f.message })
          Object.assign(job, { status: "error", error: `${step.name}: ${f.message}`, code: f.code })
          break
        }
        await readStream(res.body, step as unknown as JobRecord, progress)
        // The thinking was only worth showing while it ran.
        Object.assign(step, { status: "done", thinking: "" })
        reports.push(step.text)
      }
      if (job.status === "running") job.status = "done"
    } else {
      const res = await post(input.request ? input.request.body : { model: input.model, messages: input.messages, stream: true, ...up.extra })
      job.route = res.headers.get("x-omniroute-decision") ?? undefined
      if (!res.ok || !res.body) {
        const f = await failure(res)
        Object.assign(job, { status: "error", error: f.message, code: f.code })
      } else if (input.request) {
        job.result = await res.json()
        job.status = "done"
      } else {
        await readStream(res.body, job, progress)
        job.status = "done"
      }
    }
  } catch (e) {
    // A team step that was running when it failed is marked as failed too.
    const running = job.steps?.find((st) => st.status === "running")
    if (running) Object.assign(running, { status: "error", error: e instanceof Error ? e.message : String(e) })
    const reason = controller.signal.reason instanceof Error ? controller.signal.reason.message : ""
    if (reason === "cancelled") job.status = "stopped"
    else {
      job.status = "error"
      job.error = reason === "timeout" ? "The reply took longer than 14 minutes and was stopped." : e instanceof Error ? e.message : String(e)
    }
  } finally {
    clearTimeout(timer)
    clearInterval(watch)
  }
  if (job.status === "stopped") await forget()
  else await save().catch(() => {})
}
