import type { Config } from "@netlify/edge-functions"
import { checkPasscode, json } from "../shared/proxy.ts"

// Lets the app verify the passcode and see which providers have keys configured.
export default async (req: Request) => {
  const env = (name: string) => Netlify.env.get(name)
  const denied = await checkPasscode(req, env)
  if (denied) return denied
  return json(200, { anthropic: Boolean(env("ANTHROPIC_API_KEY")), openai: Boolean(env("OPENAI_API_KEY")) })
}

export const config: Config = { path: "/api/status" }
