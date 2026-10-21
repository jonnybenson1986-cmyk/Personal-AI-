import type { Config } from "@netlify/edge-functions"
import { json } from "../shared/proxy.ts"

// Tells the app whether the site has its own OpenRouter key. Only a boolean.
export default () => json(200, { serverKey: Boolean(Netlify.env.get("OPENROUTER_API_KEY")) })

export const config: Config = { path: "/api/status" }
