// Netlify Blobs as a JobStore. Strong consistency, so progress written by the background
// function is visible to the very next read.
import { getStore } from "@netlify/blobs"
import type { JobStore } from "./jobs.ts"

export function blobJobStore(): JobStore {
  const store = getStore({ name: "ai-jobs", consistency: "strong" })
  return {
    get: (key) => store.get(key, { type: "json" }),
    set: async (key, value) => void (await store.setJSON(key, value)),
    delete: (key) => store.delete(key),
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
  }
}

/** Per-visitor request counters (see limit.ts). */
export function blobLimitStore() {
  // Strong consistency: an eventually consistent read can return an old count, so the limit would never bite.
  const store = getStore({ name: "rate-limits", consistency: "strong" })
  return {
    get: (key: string) => store.get(key, { type: "json" }),
    set: async (key: string, value: unknown) => void (await store.setJSON(key, value)),
    list: async (prefix: string) => (await store.list({ prefix })).blobs.map((b) => b.key),
    delete: (key: string) => store.delete(key),
  }
}
