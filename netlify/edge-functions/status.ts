import type { Config } from "@netlify/edge-functions"
import { paidUnlocked, passcodeSet } from "../shared/passcode.ts"
import { json } from "../shared/proxy.ts"

// Tells the app whether the site has its own OpenRouter key, whether a passcode for paid
// models is set, and whether this device's pass is still good. Only booleans.
export default (req: Request) => {
  const env = (name: string) => Netlify.env.get(name)
  return json(200, {
    serverKey: Boolean(env("OPENROUTER_API_KEY")),
    passcode: passcodeSet(env),
    paidUnlocked: paidUnlocked(req.headers.get("x-site-pass"), env),
  })
}

export const config: Config = { path: "/api/status" }
