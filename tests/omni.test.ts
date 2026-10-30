import assert from "node:assert/strict"
import { test } from "node:test"
import { connectSteps, decisionLabel, FREE_PROVIDERS, mediaItems, mediaType, ocrText, parseDecision, ROUTING_MODES, searchHits, SETUP_OPTIONS, usageSummary } from "../src/lib/omni.ts"

test("every way to run OmniRoute has steps, and the setup shows this site's origin for CORS", () => {
  assert.deepEqual(SETUP_OPTIONS.map((o) => o.id), ["computer", "android", "docker", "source"])
  for (const o of SETUP_OPTIONS) assert.ok(o.steps.length && o.steps.every((s) => s.title))
  assert.ok(SETUP_OPTIONS[0].steps.some((s) => s.code === "npm install -g omniroute"))
  assert.ok(SETUP_OPTIONS[2].steps[0].code!.includes("-p 20128:20128 diegosouzapw/omniroute"))
  const steps = connectSteps("https://jonny.example")
  assert.ok(steps.some((s) => s.code?.includes("CORS_ALLOWED_ORIGINS=https://jonny.example omniroute") && s.code.includes("REQUIRE_API_KEY=true omniroute")))
  assert.ok(steps.some((s) => s.code?.startsWith("curl http://localhost:20128/v1/models -H \"Authorization: Bearer")))
  assert.ok(FREE_PROVIDERS.length >= 8)
  assert.equal(ROUTING_MODES[0].id, "auto")
  assert.ok(ROUTING_MODES.every((m) => m.id === "auto" || m.id.startsWith("auto/")))
})

test("routing decisions read as the provider and time", () => {
  assert.deepEqual(parseDecision("strategy=auto; provider=groq; latency_ms=812"), { strategy: "auto", provider: "groq", latencyMs: 812 })
  assert.equal(decisionLabel("strategy=single; provider=gemini; latency_ms=812"), "via gemini · 812 ms")
  assert.equal(decisionLabel("strategy=auto;provider=cerebras;latency_ms=2350"), "via cerebras · 2.4 s")
  assert.equal(decisionLabel("provider=ollama"), "via ollama")
  assert.equal(decisionLabel("strategy=auto"), undefined)
  assert.equal(decisionLabel(undefined), undefined)
})

test("generated media come back as files or links", () => {
  assert.deepEqual(mediaItems({ created: 1, data: [{ url: "https://x/v.mp4", format: "mp4" }, { b64_json: "AAA", format: "wav" }, { nothing: 1 }] }), [
    { url: "https://x/v.mp4", format: "mp4" },
    { b64_json: "AAA", format: "wav" },
  ])
  assert.deepEqual(mediaItems({ error: "x" }), [])
  assert.equal(mediaType("MP3", "audio/wav"), "audio/mpeg")
  assert.equal(mediaType(undefined, "video/mp4"), "video/mp4")
})

test("search results, OCR pages and usage are read from OmniRoute's answers", () => {
  const s = searchHits({
    provider: "tavily-search",
    results: [{ title: "Netlify", url: "https://netlify.com", snippet: "Deploy", position: 1, published_at: null }, { url: "https://bare.example", snippet: "x" }, { title: "no url" }],
    answer: { source: "provider", text: "It's a host.", model: null },
  })
  assert.deepEqual(s.hits.map((h) => h.title), ["Netlify", "https://bare.example"])
  assert.equal(s.answer, "It's a host.")
  assert.equal(s.provider, "tavily-search")
  assert.equal(ocrText({ pages: [{ index: 0, markdown: "# Invoice\n" }] }), "# Invoice")
  assert.equal(ocrText({ pages: [{ index: 0, markdown: "A" }, { index: 1, markdown: "B" }] }), "## Page 1\n\nA\n\n## Page 2\n\nB")
  assert.equal(ocrText({}), "")
  assert.deepEqual(usageSummary({ allowed: false, error: { message: "Not allowed" } }), { allowed: false, message: "Not allowed" })
  assert.deepEqual(usageSummary({ allowed: true, personal: { dailySpentUsd: 1.25, dailyLimitUsd: 5 }, providers: [{ provider: "claude", plan: "pro" }, { provider: "groq" }] }), {
    allowed: true,
    lines: ["Today: $1.25 of $5.00"],
    providers: ["claude · pro", "groq"],
  })
})

test("cloud setup gets its own secrets and a dashboard password, never the same twice", async () => {
  const { cloudEnv, cloudSteps, OMNI_IMAGE } = await import("../src/lib/omni.ts")
  const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
  const a = cloudEnv(random)
  const b = cloudEnv(random)
  const vars = Object.fromEntries(a.env.split("\n").map((l) => l.split("=")))
  assert.equal(vars.DATA_DIR, "/data")
  assert.equal(vars.PORT, "20128")
  assert.equal(vars.REQUIRE_API_KEY, "true")
  assert.match(vars.JWT_SECRET, /^[0-9a-f]{64}$/)
  assert.match(vars.API_KEY_SECRET, /^[0-9a-f]{64}$/)
  assert.notEqual(vars.JWT_SECRET, vars.API_KEY_SECRET)
  assert.equal(vars.INITIAL_PASSWORD, a.password)
  assert.match(a.password, /^[a-zA-Z2-9]{12}$/)
  assert.notEqual(a.env, b.env)
  const steps = cloudSteps(a.env)
  assert.ok(steps.some((s) => s.code === OMNI_IMAGE))
  assert.ok(steps.some((s) => s.code === a.env))
})
