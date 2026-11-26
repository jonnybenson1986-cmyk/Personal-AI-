import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { HOURLY_WRONG, issuePass, paidUnlocked, passcodeSet, tryPasscode } from "../netlify/shared/passcode.ts"
import { openrouter, proxy } from "../netlify/shared/proxy.ts"
import { upstreamFor } from "../netlify/shared/jobs.ts"

// Test values only; the real passcode lives in Netlify, never in the code.
const vars = { OPENROUTER_API_KEY: "sk-or-site", PAID_PASSCODE: "2468" }
const env = (v: Record<string, string> = vars) => (name: string) => v[name]

function memory() {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (k: string) => data.get(k),
    set: async (k: string, v: unknown) => void data.set(k, v),
    list: async (p: string) => [...data.keys()].filter((k) => k.startsWith(p)),
    delete: async (k: string) => void data.delete(k),
  }
}

test("the right passcode gives a pass that unlocks paid models", async () => {
  const result = await tryPasscode(memory(), " 2468 ", env())
  assert.equal(result.status, 200)
  const pass = (result.body as { pass: string }).pass
  assert.ok(paidUnlocked(pass, env()))
})

test("a wrong passcode is refused and counted", async () => {
  const store = memory()
  for (const guess of ["1111", "", undefined, 2468]) assert.equal((await tryPasscode(store, guess, env())).status, 403)
  assert.equal([...store.data.values()][0], 4)
})

test("too many wrong passcodes lock the site out for the hour, even the right one", async () => {
  const store = memory()
  const now = Date.UTC(2026, 10, 26, 12, 5)
  for (let i = 0; i < HOURLY_WRONG; i++) await tryPasscode(store, String(i).padStart(4, "0") === "2468" ? "x" : String(i), env(), now)
  assert.equal((await tryPasscode(store, "2468", env(), now)).status, 429)
  // The next hour starts afresh.
  assert.equal((await tryPasscode(store, "2468", env(), now + 3_600_000)).status, 200)
})

test("with no passcode set on Netlify nothing can be unlocked", async () => {
  const none = env({ OPENROUTER_API_KEY: "sk-or-site" })
  assert.equal(passcodeSet(none), false)
  assert.equal((await tryPasscode(memory(), "", none)).status, 404)
  assert.equal(paidUnlocked(issuePass(env()), none), false)
})

test("passes can't be forged, and end when they expire or the passcode or key changes", () => {
  const now = Date.now()
  const pass = issuePass(env(), now)!
  const [expires, sig] = pass.split(".")
  assert.equal(paidUnlocked(`${Number(expires) + 1}.${sig}`, env(), now), false)
  assert.equal(paidUnlocked(`${expires}.${"0".repeat(64)}`, env(), now), false)
  assert.equal(paidUnlocked("garbage", env(), now), false)
  assert.equal(paidUnlocked(undefined, env(), now), false)
  assert.equal(paidUnlocked(pass, env(), Number(expires) + 1), false)
  assert.equal(paidUnlocked(pass, env({ ...vars, PAID_PASSCODE: "1357" }), now), false)
  assert.equal(paidUnlocked(pass, env({ ...vars, OPENROUTER_API_KEY: "sk-or-new" }), now), false)
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("the site's key pays for any model only for an unlocked device", async () => {
  globalThis.fetch = (async () => new Response("ok")) as typeof fetch
  const chat = () =>
    new Request("https://site.app/api/openrouter/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "anthropic/claude-x" }) })
  assert.equal((await proxy(chat(), openrouter, env())).status, 403)
  assert.equal((await proxy(chat(), openrouter, env(), true)).status, 200)
})

test("background replies on a paid model need a good pass", () => {
  const input = { provider: "openrouter" as const, model: "anthropic/claude-x", messages: [] }
  assert.equal((upstreamFor(input, {}, env()) as { code: number }).code, 403)
  assert.equal((upstreamFor(input, { sitePass: "1.bad" }, env()) as { code: number }).code, 403)
  const ok = upstreamFor(input, { sitePass: issuePass(env()) }, env())
  assert.ok("url" in ok && ok.key === "sk-or-site")
})
