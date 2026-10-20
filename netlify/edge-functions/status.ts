import type { Config } from "@netlify/edge-functions"
import { hasPasscode, json } from "../shared/proxy.ts"

// Tells the app which server-side keys exist and whether its server passcode is right.
// Only booleans, so it needs no passcode itself.
export default async (req: Request) => {
  const env = (name: string) => Netlify.env.get(name)
  return json(200, {
    anthropic: Boolean(env("ANTHROPIC_API_KEY")),
    openai: Boolean(env("OPENAI_API_KEY")),
    passcodeSet: Boolean(env("APP_PASSCODE")),
    unlocked: await hasPasscode(req, env),
  })
}

export const config: Config = { path: "/api/status" }
