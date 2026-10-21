import { createSignal } from "solid-js"
import { DEFAULT_MODELS } from "./models"
import { type Credentials, hasServerKey, listModels } from "./providers"
import type { ModelInfo } from "./types"

/** Whether the app has a key it can chat with; undefined until checked. */
export const [canChat, setCanChat] = createSignal<boolean | undefined>()
export const [catalog, setCatalog] = createSignal<ModelInfo[]>(DEFAULT_MODELS)

/** Works out whether the app can chat, and loads the current free models. */
export async function refreshStatus(credentials: Credentials) {
  const [server] = await Promise.all([hasServerKey(), refreshCatalog()])
  setCanChat(!!credentials.openrouterKey.trim() || server)
}

export async function refreshCatalog() {
  const live = await listModels().catch(() => [] as ModelInfo[])
  if (live.length) setCatalog(live)
}
