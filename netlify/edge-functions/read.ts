import type { Config, Context } from "@netlify/edge-functions"
import { blobLimitStore } from "../shared/blobstore.ts"
import { limitResponse, visitorIp } from "../shared/limit.ts"
import { readPage } from "../shared/read.ts"

// TEMPORARY DIAGNOSTIC: reports the counter store and the visitor address in a header.
export default async (req: Request, context: Context) => {
  let note: string
  try {
    const s = blobLimitStore()
    await s.set("probe/diag", Date.now())
    note = "store-ok read=" + String(await s.get("probe/diag"))
  } catch (e) {
    note = "store-err " + (e instanceof Error ? e.message : String(e))
  }
  const res = (await limitResponse(blobLimitStore(), "read", visitorIp(req, context.ip), 30)) ?? (await readPage(req))
  const out = new Response(res.body, res)
  out.headers.set("x-rl-debug", (note + " ip=" + String(visitorIp(req, context.ip)) + " ctxip=" + String(context.ip)).replace(/[^\x20-\x7e]/g, "?").slice(0, 300))
  return out
}

export const config: Config = { path: "/api/read" }
