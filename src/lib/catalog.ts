import { createSignal } from "solid-js"
import { DEFAULT_MODELS, GATEWAY_AUTO, rememberWindows } from "./models"
import { ROUTING_MODES } from "./omni"
import { type Credentials, errorMessage, lastGatewayModels, listModels, serverStatus } from "./providers"
import { gatewayPreset } from "./gateways"
import { gatewayReady, setSiteGateway, setSiteOpenRouter } from "./route"
import { settings, updateSettings } from "./store"
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
    // The site's own gateway has to be known before the model list can load from it.
    const server = await serverStatus()
    setSiteGateway(server.omniroute)
    setSiteOpenRouter(server.serverKey)
    setCanChat(gatewayReady(credentials.omnirouteUrl ?? "", credentials.omnirouteKey ?? ""))
    await refreshCatalog(credentials)
    return
  }
  const [server] = await Promise.all([serverStatus(), refreshCatalog(credentials)])
  setSiteGateway(server.omniroute)
  setSiteOpenRouter(server.serverKey)
  if (!credentials.openrouterKey.trim() && !server.serverKey && server.omniroute) {
    // OpenRouter has no key anywhere but the site has OmniRoute set up: use that instead.
    updateSettings({ provider: "omniroute", models: [{ id: GATEWAY_AUTO }] })
    return refreshStatus({ ...credentials, provider: "omniroute" })
  }
  setCanChat(!!credentials.openrouterKey.trim() || server.serverKey)
}

export async function refreshCatalog(credentials?: Credentials) {
  if (credentials?.provider === "omniroute") {
    // Before (or without) a live list: the gateway's auto model if it has one, else nothing.
    const fallback = gatewayPreset(credentials.omnirouteUrl ?? "", credentials.gateway).auto ? GATEWAY_FALLBACK : []
    if (!gatewayReady(credentials.omnirouteUrl ?? "", credentials.omnirouteKey ?? "")) {
      setGatewayError(undefined)
      setCatalog(fallback)
      return 0
    }
    try {
      const live = await listModels(credentials)
      setGatewayError(undefined)
      rememberWindows(live)
      setCatalog(live.length ? live : fallback)
      // A gateway with no auto model needs one of its own models picked.
      if (!fallback.length && live.length && credentials.omnirouteUrl === settings.omnirouteUrl) {
        const selected = settings.models.filter((m) => live.some((g) => g.id === m.id))
        updateSettings({ models: selected.length ? selected : [{ id: live[0].id }] })
      }
      // The count is what the gateway offers, not the routing modes the picker always adds.
      return live.filter((m) => !ROUTING_MODES.some((r) => r.id === m.id) || lastGatewayModels.some((g) => g.id === m.id)).length
    } catch (e) {
      setGatewayError(errorMessage(e))
      setCatalog(fallback)
      return 0
    }
  }
  const live = await listModels(credentials).catch(() => [] as ModelInfo[])
  rememberWindows(live)
  setCatalog(live.length ? live : DEFAULT_MODELS)
  // A paid model chosen with a key that's since been removed can't be used on the site's key.
  if (live.length && settings.provider !== "omniroute" && (!credentials || credentials.openrouterKey === settings.openrouterKey)) {
    const kept = settings.models.filter((m) => live.some((x) => x.id === m.id))
    if (kept.length !== settings.models.length) updateSettings({ models: kept.length ? kept : [{ id: live[0].id }] })
  }
  return live.length
}
