import type { Config } from "@netlify/edge-functions"
import { siteGateway } from "../shared/gateway.ts"
import { json } from "../shared/proxy.ts"

// Tells the app whether the site has its own OpenRouter key and OmniRoute gateway. Only booleans.
export default () =>
  json(200, { serverKey: Boolean(Netlify.env.get("OPENROUTER_API_KEY")), omniroute: Boolean(siteGateway((name) => Netlify.env.get(name))) })

export const config: Config = { path: "/api/status" }
