import { createSignal } from "solid-js"
import { DEFAULT_MODELS, GATEWAY_AUTO } from "./models"
import { ROUTING_MODES } from "./omni"
import { type Credentials, errorMessage, hasServerKey, lastGatewayModels, listModels } from "./providers"
import type { ModelInfo } from "./types"

/** Whether the app has a key it can chat with; undefined until checked. */
export const [canChat, setCanChat] = createSignal<boolean | undefined>()
export const [catalog, setCatalog] = createSignal<ModelInfo[]>(DEFAULT_MODELS)
/** The last problem loading the model list from OmniRoute, shown in Settings. */
export const [gatewayError, setGatewayError] = createSignal<string>()

const GATEWAY_FALLBACK: ModelInfo[] = [{ id: GATEWAY_AUTO, label: "Auto (OmniRoute picks)", hint: "Routes each message across your connected providers" }]

/** Works out whether the app can chat, and loads the models it can use. */
export async function refreshStatus(credentials: Credentials) {
  if (credentials.provider === "omniroute") {
    setCanChat(!!credentials.omnirouteUrl?.trim() && !!credentials.omnirouteKey?.trim())
    await refreshCatalog(credentials)
    return
  }
  const [server] = await Promise.all([hasServerKey(), refreshCatalog(credentials)])
  setCanChat(!!credentials.openrouterKey.trim() || server)
}

export async function refreshCatalog(credentials?: Credentials) {
  if (credentials?.provider === "omniroute") {
    if (!credentials.omnirouteUrl?.trim() || !credentials.omnirouteKey?.trim()) {
      setGatewayError(undefined)
      setCatalog(GATEWAY_FALLBACK)
      return 0
    }
    try {
      const live = await listModels(credentials)
      setGatewayError(undefined)
      setCatalog(live.length ? live : GATEWAY_FALLBACK)
      // The count is what the gateway offers, not the routing modes the picker always adds.
      return live.filter((m) => !ROUTING_MODES.some((r) => r.id === m.id) || lastGatewayModels.some((g) => g.id === m.id)).length
    } catch (e) {
      setGatewayError(errorMessage(e))
      setCatalog(GATEWAY_FALLBACK)
      return 0
    }
  }
  const live = await listModels().catch(() => [] as ModelInfo[])
  setCatalog(live.length ? live : DEFAULT_MODELS)
  return live.length
}
