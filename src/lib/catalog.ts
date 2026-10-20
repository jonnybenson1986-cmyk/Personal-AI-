import { createSignal } from "solid-js"
import { DEFAULT_MODELS } from "./models"
import { listModels, type Status } from "./providers"
import type { ModelInfo } from "./types"

export const [status, setStatus] = createSignal<Status | undefined>()
export const [catalog, setCatalog] = createSignal<ModelInfo[]>(DEFAULT_MODELS)

/** Merges each API's live model list over the defaults, keeping the defaults' labels and order. */
export async function refreshCatalog(passcode: string, providers: Status) {
  const live = await listModels(passcode, providers).catch(() => [] as ModelInfo[])
  const merged = DEFAULT_MODELS.filter(
    (d) => providers[d.provider] && (!live.some((m) => m.provider === d.provider) || live.some((m) => m.provider === d.provider && m.id === d.id)),
  )
  for (const m of live) if (!merged.some((d) => d.provider === m.provider && d.id === m.id)) merged.push(m)
  setCatalog(merged.length ? merged : DEFAULT_MODELS)
}
