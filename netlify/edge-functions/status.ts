import type { Config } from "@netlify/edge-functions"
import { hasPasscode, json } from "../shared/proxy.ts"

// Tells the app whether the site has its own OpenRouter key and whether the app's server
// passcode (if one is set) is right. Only booleans, so it needs no passcode itself.
export default async (req: Request) => {
  const env = (name: string) => Netlify.env.get(name)
  return json(200, {
    serverKey: Boolean(env("OPENROUTER_API_KEY")),
    passcodeSet: Boolean(env("APP_PASSCODE")),
    unlocked: await hasPasscode(req, env),
  })
}

export const config: Config = { path: "/api/status" }
