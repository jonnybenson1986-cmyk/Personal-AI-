import { createSignal } from "solid-js"
import { DEFAULT_MODELS } from "./models"
import { availability, type Credentials, listModels, serverStatus, type Status } from "./providers"
import type { ModelInfo } from "./types"

export const [status, setStatus] = createSignal<Status | undefined>()
export const [catalog, setCatalog] = createSignal<ModelInfo[]>(DEFAULT_MODELS)

/** Works out which providers are usable, then loads their model lists. */
export async function refreshStatus(credentials: Credentials) {
  const s = availability(credentials, await serverStatus(credentials.passcode))
  setStatus(s)
  if (s.anthropic || s.openai) await refreshCatalog(credentials, s)
  return s
}

/** Merges each API's live model list over the defaults, keeping the defaults' labels and order. */
export async function refreshCatalog(credentials: Credentials, providers: Status) {
  const live = await listModels(credentials, providers).catch(() => [] as ModelInfo[])
  const merged = DEFAULT_MODELS.filter(
    (d) => providers[d.provider] && (!live.some((m) => m.provider === d.provider) || live.some((m) => m.provider === d.provider && m.id === d.id)),
  )
  for (const m of live) if (!merged.some((d) => d.provider === m.provider && d.id === m.id)) merged.push(m)
  setCatalog(merged.length ? merged : DEFAULT_MODELS)
}
