import { createSignal } from "solid-js"
import { DEFAULT_MODELS, rememberWindows } from "./models"
import { type Credentials, listModels, serverStatus } from "./providers"
import { setSiteOpenRouter, setSitePasscode } from "./route"
import { settings, updateSettings } from "./store"
import type { ModelInfo } from "./types"

/** Whether the app has a key it can chat with; undefined until checked. */
export const [canChat, setCanChat] = createSignal<boolean | undefined>()
export const [catalog, setCatalog] = createSignal<ModelInfo[]>(DEFAULT_MODELS)

/** Works out whether the app can chat, and loads the models it can use. */
export async function refreshStatus(credentials: Credentials) {
  const [server] = await Promise.all([serverStatus(credentials.sitePass), refreshCatalog(credentials)])
  setSiteOpenRouter(server.serverKey)
  setSitePasscode(server.passcode)
  if (credentials.sitePass && server.known && !server.paidUnlocked) {
    // The passcode or key changed on Netlify (or the pass expired): back to free models.
    updateSettings({ sitePass: undefined })
    await refreshCatalog({ ...credentials, sitePass: undefined })
  }
  setCanChat(!!credentials.openrouterKey.trim() || server.serverKey)
}

/** Loads OpenRouter's models: the free ones, and every other one when paid models are allowed. */
export async function refreshCatalog(credentials?: Credentials) {
  const live = await listModels(credentials).catch(() => [] as ModelInfo[])
  rememberWindows(live)
  setCatalog(live.length ? live : DEFAULT_MODELS)
  // A paid model chosen before paid models were locked again can't be used on the site's key.
  if (live.length && (!credentials || credentials.openrouterKey === settings.openrouterKey)) {
    const kept = settings.models.filter((m) => live.some((x) => x.id === m.id))
    if (kept.length !== settings.models.length) updateSettings({ models: kept.length ? kept : [{ id: live[0].id }] })
  }
  return live.length
}
