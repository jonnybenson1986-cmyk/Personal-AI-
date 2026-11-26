// The owner's passcode for paid models on the site's own OpenRouter key. The passcode lives
// only in Netlify (PAID_PASSCODE). A device that enters it gets a pass: an expiry signed with
// the passcode and the key, which only this server can make. Changing either one cancels
// every pass. Wrong guesses are limited per visitor and across the whole site.
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import type { CounterStore } from "./limit.ts"

type Env = (name: string) => string | undefined

/** A pass lasts this long, then the device asks for the passcode again. */
export const PASS_DAYS = 365
/** Wrong passcodes allowed per hour across the whole site, so it can't be guessed by many visitors. */
export const HOURLY_WRONG = 30

function secret(env: Env) {
  const code = env("PAID_PASSCODE")?.trim()
  const key = env("OPENROUTER_API_KEY")?.trim()
  return code && key ? `${code}\u0000${key}` : undefined
}

/** Whether the site has a passcode set (and a key for it to unlock). */
export const passcodeSet = (env: Env) => secret(env) !== undefined

const sign = (s: string, expires: number) => createHmac("sha256", s).update(`paid-models:${expires}`).digest("hex")

// Compares as fixed-length hashes, so the time taken says nothing about the right answer.
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest())

export function issuePass(env: Env, now = Date.now()) {
  const s = secret(env)
  if (!s) return undefined
  const expires = now + PASS_DAYS * 86_400_000
  return `${expires}.${sign(s, expires)}`
}

/** Whether a pass from a device is genuine and current. */
export function paidUnlocked(pass: unknown, env: Env, now = Date.now()) {
  const s = secret(env)
  if (!s || typeof pass !== "string") return false
  const match = pass.match(/^(\d{10,16})\.([0-9a-f]{64})$/)
  if (!match) return false
  const expires = Number(match[1])
  return expires > now && same(match[2], sign(s, expires))
}

/**
 * Checks a passcode attempt. A storage fault refuses rather than letting guesses through
 * uncounted. The hourly counter key fits purgeLimits' layout, so it's cleared like the others.
 */
export async function tryPasscode(store: CounterStore, given: unknown, env: Env, now = Date.now()): Promise<{ status: number; body: unknown }> {
  const code = env("PAID_PASSCODE")?.trim()
  if (!code || !passcodeSet(env)) return { status: 404, body: { error: { message: "No passcode is set up for this site." } } }
  const hourKey = `rl/unlock-wrong/site/${Math.floor(now / 3_600_000) * 60}`
  const wrong = Number((await store.get(hourKey)) ?? 0)
  if (wrong >= HOURLY_WRONG) return { status: 429, body: { error: { message: "Too many wrong passcodes on this site. Try again in an hour." } } }
  if (typeof given !== "string" || !same(given.trim(), code)) {
    await store.set(hourKey, wrong + 1)
    return { status: 403, body: { error: { message: "That passcode isn't right." } } }
  }
  return { status: 200, body: { pass: issuePass(env, now) } }
}
