// Checks a deployed site end to end, through the same endpoints the app uses: status, the
// free model list, a background reply, an agent's report, the page reader and the agents.
// Uses the site's own free key, about two AI requests per run.
//
//   npm run smoke -- https://personalaitools.netlify.app
const site = (process.argv[2] ?? "").replace(/\/+$/, "")
if (!/^https?:\/\//.test(site)) throw new Error("Usage: npm run smoke -- https://your-site.netlify.app")

type Check = { name: string; ok: boolean; detail: string; ms: number }
const results: Check[] = []

async function check(name: string, fn: () => Promise<string>) {
  const t = Date.now()
  try {
    results.push({ name, ok: true, detail: await fn(), ms: Date.now() - t })
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t })
  }
}

async function getJson(path: string, init?: RequestInit) {
  const res = await fetch(site + path, { ...init, signal: AbortSignal.timeout(60_000) })
  const text = await res.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${path}: ${res.status}, not JSON: ${text.slice(0, 120)}`)
  }
  if (!res.ok) throw new Error(`${path}: ${res.status} ${body?.error?.message ?? ""}`.trim())
  return body
}

/** Starts a job and follows it to the end; returns the final record. */
async function runJob(input: unknown) {
  const { id } = await getJson("/api/job-start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, secrets: {}, idempotencyKey: crypto.randomUUID() }) })
  const deadline = Date.now() + 180_000
  try {
    for (;;) {
      const job = await getJson(`/api/jobs/${id}`)
      if (job.status === "done") return job
      if (job.status === "error" || job.status === "stopped") throw new Error(`job ${job.status}: ${job.error ?? ""}`)
      if (Date.now() > deadline) throw new Error(`job still ${job.status} after 3 minutes`)
      await new Promise((r) => setTimeout(r, 1500))
    }
  } finally {
    await fetch(`${site}/api/jobs/${id}`, { method: "DELETE" }).catch(() => {})
  }
}

await check("Status", async () => {
  const s = await getJson("/api/status")
  if (!s.serverKey && !s.omniroute) throw new Error("the site has no OPENROUTER_API_KEY (or OmniRoute) set")
  return `OpenRouter key: ${s.serverKey ? "yes" : "no"}, site OmniRoute: ${s.omniroute ? "yes" : "no"}`
})

await check("Free models", async () => {
  const { data } = await getJson("/api/openrouter/v1/models")
  const free = data.filter((m: { id: string }) => m.id.endsWith(":free")).length
  if (!free) throw new Error("no free models listed")
  return `${free} free models`
})

await check("Background reply", async () => {
  const job = await runJob({ provider: "openrouter", model: "openrouter/free", messages: [{ role: "user", content: "Reply with exactly these two words: smoke OK" }] })
  if (!job.text.trim()) throw new Error("empty reply")
  return `${job.servedBy ?? "?"}: "${job.text.trim().slice(0, 40)}"`
})

await check("Agent report", async () => {
  const job = await runJob({
    provider: "openrouter",
    model: "openrouter/free",
    messages: [],
    team: { task: "Check that the word 'ready' is spelled correctly. Keep the report very short.", members: [{ name: "Proofreader", brief: "You are Proofreader, who checks spelling." }] },
  })
  const report = job.steps?.[0]?.text ?? ""
  if (!report.trim()) throw new Error("no report")
  return /##\s*Summary/i.test(report) ? "reported in the agreed shape" : `reported, but without the Summary heading: "${report.slice(0, 60)}"`
})

await check("Page reader", async () => {
  const page = await getJson("/api/read?url=" + encodeURIComponent("https://example.com"))
  if (!page.text) throw new Error("no text")
  return `"${page.title}"`
})

await check("Agents", async () => {
  const index = await getJson("/agents/index.json")
  const res = await fetch(`${site}/agents/${index.agents[0].slug}.md`)
  if (!res.ok) throw new Error(`brief: ${res.status}`)
  return `${index.agents.length} agents, briefs served`
})

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`)
process.exit(failed ? 1 : 0)
