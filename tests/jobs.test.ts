import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { type JobRecord, type JobStore, jobsApi, newJobId, purgeOld, readStream, runJob, upstreamFor, validJobId } from "../netlify/shared/jobs.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function memoryStore() {
  const data = new Map<string, unknown>()
  const store: JobStore = {
    get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    set: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  }
  return { store, data }
}

const sse = (...events: unknown[]) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("")
const chunk = (content: string, extra: Record<string, unknown> = {}) => ({ model: "google/gemma:free", choices: [{ index: 0, delta: { content } }], ...extra })
const env = (vars: Record<string, string>) => (n: string) => vars[n]
const input = { provider: "openrouter", model: "openrouter/free", messages: [{ role: "user", content: "hi" }] }

async function api(store: JobStore, method: string, path: string, body?: unknown, opts: { vars?: Record<string, string>; start?: () => Promise<Response> } = {}) {
  const starts: string[] = []
  const res = await jobsApi(new Request(`https://site.example${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), {
    store,
    env: env(opts.vars ?? {}),
    start: async (b) => {
      starts.push(b)
      return opts.start ? opts.start() : new Response(null, { status: 202 })
    },
  })
  return { res, json: (await res.json()) as Record<string, any>, starts }
}

test("job ids carry their time and are hard to guess", () => {
  const id = newJobId()
  assert.ok(validJobId(id))
  assert.ok(!validJobId("../job"))
  assert.ok(!validJobId("abc"))
})

test("the site's key is only used for free models; a user key goes straight through", () => {
  assert.deepEqual(upstreamFor({ ...input, provider: "openrouter" }, {}, env({})), { error: "Add your free OpenRouter key in Settings to start chatting.", code: 401 })
  assert.equal((upstreamFor({ ...input, provider: "openrouter", model: "openai/gpt-5" }, {}, env({ OPENROUTER_API_KEY: "sk-or-site" })) as { code: number }).code, 403)
  const site = upstreamFor({ ...input, provider: "openrouter" }, { openrouterKey: "set-on-server" }, env({ OPENROUTER_API_KEY: "sk-or-site" }))
  assert.equal((site as { key: string }).key, "sk-or-site")
  const mine = upstreamFor({ ...input, provider: "openrouter", model: "openai/gpt-5", reasoning: true }, { openrouterKey: "sk-or-mine" }, env({}))
  assert.deepEqual(mine, { url: "https://openrouter.ai/api/v1/chat/completions", key: "sk-or-mine", extra: { reasoning: { effort: "high" } } })
})

test("OmniRoute jobs need a public https address and the user's key", () => {
  const omni = { ...input, provider: "omniroute" as const }
  assert.equal((upstreamFor({ ...omni, omnirouteUrl: "http://localhost:20128" }, { omnirouteKey: "k" }, env({})) as { code: number }).code, 400)
  assert.equal((upstreamFor({ ...omni, omnirouteUrl: "https://omni.example.com" }, {}, env({})) as { code: number }).code, 401)
  assert.deepEqual(upstreamFor({ ...omni, omnirouteUrl: "https://omni.example.com/v1", reasoning: true }, { omnirouteKey: "k" }, env({})), {
    url: "https://omni.example.com/v1/chat/completions",
    key: "k",
    extra: { reasoning_effort: "high" },
  })
})

test("OmniRoute jobs without an address use the site's gateway and key", () => {
  const omni = { ...input, provider: "omniroute" as const }
  const site = env({ OMNIROUTE_URL: "https://omni.example.com", OMNIROUTE_API_KEY: "sk-omni-site" })
  assert.deepEqual(upstreamFor(omni, {}, site), { url: "https://omni.example.com/v1/chat/completions", key: "sk-omni-site", extra: {} })
  assert.equal((upstreamFor(omni, {}, env({})) as { code: number }).code, 400)
  // An address from the app always goes with the app's key, never the site's.
  assert.equal((upstreamFor({ ...omni, omnirouteUrl: "https://other.example.com" }, {}, site) as { code: number }).code, 401)
})

test("starting a job saves the request without the key and starts the background function", async () => {
  const { store, data } = memoryStore()
  const { res, json, starts } = await api(store, "POST", "/api/jobs", { input, secrets: { openrouterKey: "sk-or-mine" } })
  assert.equal(res.status, 201)
  assert.ok(validJobId(json.id))
  assert.deepEqual(data.get(`input/${json.id}`), { ...input, reasoning: false, omnirouteUrl: undefined })
  assert.equal((data.get(`job/${json.id}`) as JobRecord).status, "queued")
  assert.ok(![...data.values()].some((v) => JSON.stringify(v).includes("sk-or-mine")))
  assert.deepEqual(JSON.parse(starts[0]), { id: json.id, secrets: { openrouterKey: "sk-or-mine" } })
})

test("problems known up front are answered straight away", async () => {
  const { store, data } = memoryStore()
  assert.equal((await api(store, "POST", "/api/jobs", { input, secrets: {} })).res.status, 401)
  assert.equal((await api(store, "POST", "/api/jobs", { input: { ...input, messages: [] }, secrets: {} })).res.status, 400)
  assert.equal((await api(store, "POST", "/api/jobs", "not json")).res.status, 400)
  // The background function couldn't be started: nothing is left behind.
  const failed = await api(store, "POST", "/api/jobs", { input, secrets: { openrouterKey: "sk-or-mine" } }, { start: async () => new Response("no", { status: 404 }) })
  assert.equal(failed.res.status, 503)
  assert.equal(data.size, 0)
})

test("progress is read from an offset, and jobs can be cancelled and removed", async () => {
  const { store, data } = memoryStore()
  const id = newJobId()
  data.set(`job/${id}`, { status: "running", text: "Hello world", thinking: "Hmm", updated: 1 })
  const { json } = await api(store, "GET", `/api/jobs/${id}?text=6&thinking=3`)
  assert.equal(json.text, "world")
  assert.equal(json.thinking, "")
  assert.equal(json.textLength, 11)
  assert.equal(json.thinkingLength, 3)
  assert.equal((await api(store, "POST", `/api/jobs/${id}/cancel`)).res.status, 200)
  assert.equal(data.get(`cancel/${id}`), true)
  assert.equal((await api(store, "DELETE", `/api/jobs/${id}`)).res.status, 200)
  assert.equal(data.size, 0)
  assert.equal((await api(store, "GET", `/api/jobs/${id}`)).res.status, 404)
  assert.equal((await api(store, "GET", "/api/jobs/not-an-id")).res.status, 404)
})

test("a stream split anywhere is read into text, thinking and the serving model", async () => {
  const body = sse({ model: "m:free", choices: [{ delta: { reasoning: "Let me think. " } }] }, chunk("Hel"), chunk("lo"), { choices: [{ delta: {}, finish_reason: "length" }] }, "[DONE]")
  const bytes = new TextEncoder().encode(": comment\n\n" + body)
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7))
      c.close()
    },
  })
  const job: JobRecord = { status: "running", text: "", thinking: "", updated: 0 }
  let calls = 0
  await readStream(stream, job, async () => void calls++)
  assert.equal(job.text, "Hello")
  assert.equal(job.thinking, "Let me think. ")
  assert.equal(job.servedBy, "m:free")
  assert.equal(job.notice, "The response hit the length limit.")
  assert.ok(calls > 3)
})

async function startedJob(store: JobStore) {
  const { json } = await api(store, "POST", "/api/jobs", { input, secrets: { openrouterKey: "sk-or-mine" } })
  return json.id as string
}

test("a job runs to the end, once, and the request is removed", async () => {
  const { store, data } = memoryStore()
  const id = await startedJob(store)
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(sse(chunk("Done "), chunk("here."), "[DONE]"), { headers: { "content-type": "text/event-stream" } })
  }) as typeof fetch
  await runJob(id, { openrouterKey: "sk-or-mine" }, { store, env: env({}), openrouterOrigin: "https://mock/api" })
  const job = data.get(`job/${id}`) as JobRecord
  assert.equal(job.status, "done")
  assert.equal(job.text, "Done here.")
  assert.equal(calls[0].url, "https://mock/api/v1/chat/completions")
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer sk-or-mine")
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { model: input.model, messages: input.messages, stream: true })
  assert.ok(!data.has(`input/${id}`))
  // A retry of the background function finds nothing to do.
  await runJob(id, { openrouterKey: "sk-or-mine" }, { store, env: env({}), openrouterOrigin: "https://mock/api" })
  assert.equal(calls.length, 1)
})

test("upstream errors are recorded with their status", async () => {
  const { store, data } = memoryStore()
  const id = await startedJob(store)
  globalThis.fetch = (async () => new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 })) as unknown as typeof fetch
  await runJob(id, { openrouterKey: "sk-or-mine" }, { store, env: env({}) })
  const job = data.get(`job/${id}`) as JobRecord
  assert.deepEqual([job.status, job.error, job.code], ["error", "Rate limit exceeded", 429])
})

test("cancelling stops the job while it streams", async () => {
  const { store, data } = memoryStore()
  const id = await startedJob(store)
  globalThis.fetch = (async (_: string, init: RequestInit) => {
    const enc = new TextEncoder()
    let n = 0
    return new Response(
      new ReadableStream({
        async pull(c) {
          if (init.signal?.aborted) return c.error(init.signal.reason)
          await new Promise((r) => setTimeout(r, 150))
          if (++n === 3) await store.set(`cancel/${id}`, true)
          c.enqueue(enc.encode(sse(chunk("word "))))
        },
      }),
    )
  }) as typeof fetch
  let saved: JobRecord | undefined
  const set = store.set
  store.set = async (k, v) => {
    if (k === `job/${id}`) saved = v as JobRecord
    return set(k, v)
  }
  await runJob(id, { openrouterKey: "sk-or-mine" }, { store, env: env({}) })
  assert.ok(saved!.text.startsWith("word"))
  // The app stopped asking, so nothing is kept.
  assert.equal(data.size, 0)
})

test("a job cancelled before it starts never calls the model", async () => {
  const { store, data } = memoryStore()
  const id = await startedJob(store)
  await store.set(`cancel/${id}`, true)
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response("")
  }) as unknown as typeof fetch
  await runJob(id, { openrouterKey: "sk-or-mine" }, { store, env: env({}) })
  assert.equal(called, false)
  assert.equal(data.size, 0)
})

test("old jobs are cleaned up, recent ones kept", async () => {
  const { store, data } = memoryStore()
  const now = Date.now()
  const old = `${(now - 2 * 86_400_000).toString(36)}-${crypto.randomUUID()}`
  const fresh = newJobId()
  data.set(`job/${old}`, {})
  data.set(`cancel/${old}`, true)
  data.set(`job/${fresh}`, {})
  await purgeOld(store, now)
  assert.deepEqual([...data.keys()], [`job/${fresh}`])
})

test("slow OmniRoute requests run as jobs and keep their JSON answer", async () => {
  const { store, data } = memoryStore()
  const omni = { provider: "omniroute", model: "runway/gen-3", messages: [], omnirouteUrl: "https://omni.example.com", request: { path: "/v1/videos/generations", body: { model: "runway/gen-3", prompt: "waves" } } }
  // Only the known slow endpoints, and only for OmniRoute.
  assert.equal((await api(store, "POST", "/api/jobs", { input: { ...omni, request: { path: "/api/keys", body: {} } }, secrets: { omnirouteKey: "k" } })).res.status, 400)
  assert.equal((await api(store, "POST", "/api/jobs", { input: { ...omni, provider: "openrouter" }, secrets: { openrouterKey: "sk-or-x" } })).res.status, 400)
  const { json } = await api(store, "POST", "/api/jobs", { input: omni, secrets: { omnirouteKey: "k" } })
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ created: 1, data: [{ url: "https://cdn/v.mp4", format: "mp4" }] }), { headers: { "content-type": "application/json", "x-omniroute-decision": "strategy=single; provider=runway; latency_ms=90000" } })
  }) as typeof fetch
  await runJob(json.id, { omnirouteKey: "k" }, { store, env: env({}) })
  const job = data.get(`job/${json.id}`) as JobRecord
  assert.equal(job.status, "done")
  assert.deepEqual(job.result, { created: 1, data: [{ url: "https://cdn/v.mp4", format: "mp4" }] })
  assert.equal(job.route, "strategy=single; provider=runway; latency_ms=90000")
  assert.equal(calls[0].url, "https://omni.example.com/v1/videos/generations")
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { model: "runway/gen-3", prompt: "waves" })
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer k")
})

test("chat jobs keep OmniRoute's routing decision", async () => {
  const { store, data } = memoryStore()
  const { json } = await api(store, "POST", "/api/jobs", { input: { provider: "omniroute", model: "auto", messages: [{ role: "user", content: "hi" }], omnirouteUrl: "https://omni.example.com" }, secrets: { omnirouteKey: "k" } })
  globalThis.fetch = (async () => new Response(sse(chunk("Hi")), { headers: { "x-omniroute-decision": "strategy=auto; provider=groq; latency_ms=300" } })) as unknown as typeof fetch
  await runJob(json.id, { omnirouteKey: "k" }, { store, env: env({}) })
  const job = data.get(`job/${json.id}`) as JobRecord
  assert.equal(job.text, "Hi")
  assert.equal(job.route, "strategy=auto; provider=groq; latency_ms=300")
})

test("a team job runs each agent in order, passing on the reports, and keeps them all", async () => {
  const { store, data } = memoryStore()
  const team = { task: "Plan a launch", members: [{ name: "Researcher", brief: "You research." }, { name: "Writer", brief: "You write." }] }
  const { res, json } = await api(store, "POST", "/api/jobs", { input: { provider: "openrouter", model: "openrouter/free", messages: [], team }, secrets: { openrouterKey: "sk-or-mine" } })
  assert.equal(res.status, 201)
  const bodies: any[] = []
  globalThis.fetch = (async (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    bodies.push(body)
    return new Response(sse(chunk(bodies.length === 1 ? "## Summary\nFound 3 trends" : "## Summary\nWrote the plan")), { headers: { "content-type": "text/event-stream" } })
  }) as typeof fetch
  await runJob(json.id, { openrouterKey: "sk-or-mine" }, { store, env: env({}) })
  const job = data.get(`job/${json.id}`) as JobRecord
  assert.equal(job.status, "done")
  assert.deepEqual(job.steps!.map((s) => [s.name, s.status, s.text]), [
    ["Researcher", "done", "## Summary\nFound 3 trends"],
    ["Writer", "done", "## Summary\nWrote the plan"],
  ])
  assert.equal(bodies.length, 2)
  assert.ok(bodies[0].messages[0].content.startsWith("You research."))
  assert.equal(bodies[0].messages[1].content, "Plan a launch")
  assert.ok(bodies[1].messages[0].content.startsWith("You write."))
  assert.match(bodies[1].messages[1].content, /<report from="Researcher">\n## Summary\nFound 3 trends\n<\/report>/)
  assert.equal(bodies[1].stream, true)
})

test("when a team member fails, earlier reports are kept and later ones never start", async () => {
  const { store, data } = memoryStore()
  const team = { task: "Review", members: [{ name: "A", brief: "a" }, { name: "B", brief: "b" }, { name: "C", brief: "c" }] }
  const { json } = await api(store, "POST", "/api/jobs", { input: { provider: "openrouter", model: "openrouter/free", messages: [], team }, secrets: { openrouterKey: "sk-or-mine" } })
  let calls = 0
  globalThis.fetch = (async () =>
    ++calls === 1 ? new Response(sse(chunk("A's report"))) : new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 })) as unknown as typeof fetch
  await runJob(json.id, { openrouterKey: "sk-or-mine" }, { store, env: env({}) })
  const job = data.get(`job/${json.id}`) as JobRecord
  assert.equal(job.status, "error")
  assert.equal(job.error, "B: Rate limit exceeded")
  assert.equal(job.code, 429)
  assert.deepEqual(job.steps!.map((s) => s.status), ["done", "error", "waiting"])
  assert.equal(job.steps![0].text, "A's report")
  assert.equal(calls, 2)
})

test("bad teams are refused before a job starts", async () => {
  const { store } = memoryStore()
  const bad = await api(store, "POST", "/api/jobs", { input: { provider: "openrouter", model: "openrouter/free", messages: [], team: { task: "x", members: [] } }, secrets: { openrouterKey: "sk-or-x" } })
  assert.equal(bad.res.status, 400)
  assert.match(bad.json.error.message, /1 to 6 agents/)
})
