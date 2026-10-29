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
