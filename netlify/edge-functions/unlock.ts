import type { Config, Context } from "@netlify/edge-functions"
import { blobLimitStore } from "../shared/blobstore.ts"
import { limitResponse, visitorIp } from "../shared/limit.ts"
import { tryPasscode } from "../shared/passcode.ts"
import { json } from "../shared/proxy.ts"

// Swaps the owner's passcode for a pass that unlocks paid models on this device. Five tries a
// minute per visitor, and a cap on wrong ones across the site (see passcode.ts).
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json(405, { error: { message: "Use POST." } })
  const store = blobLimitStore()
  const limited = await limitResponse(store, "unlock", visitorIp(req, context.ip), 5)
  if (limited) return limited
  let given: unknown
  try {
    given = ((await req.json()) as { passcode?: unknown })?.passcode
  } catch {
    return json(400, { error: { message: "Invalid request." } })
  }
  try {
    const result = await tryPasscode(store, given, (name) => Netlify.env.get(name))
    return json(result.status, result.body)
  } catch (e) {
    console.error(JSON.stringify({ event: "unlock-store-error", message: e instanceof Error ? e.message : String(e) }))
    return json(503, { error: { message: "Couldn't check the passcode right now. Try again in a minute." } })
  }
}

export const config: Config = { path: "/api/unlock" }
