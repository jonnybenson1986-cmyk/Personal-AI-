import type { Config, Context } from "@netlify/edge-functions"
import { blobLimitStore } from "../shared/blobstore.ts"
import { limitResponse, overLimit, visitorIp } from "../shared/limit.ts"
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
  const ipNow = visitorIp(req, context.ip) ?? "none"
  let check = ""
  try {
    const s = blobLimitStore()
    const keys = await s.list("rl/read/")
    const mine = keys.filter((k) => k.includes(ipNow))
    const counts = await Promise.all(mine.map((k) => s.get(k)))
    const trace: string[] = []
    const probeKey = "rl/diagtest/" + ipNow.replace(/[^0-9a-z]/gi, "-") + "/" + Math.floor(Date.now() / 60000)
    for (let i = 0; i < 3; i++) {
      try {
        const before = await s.get(probeKey)
        await s.set(probeKey, Number(before ?? 0) + 1)
        const after = await s.get(probeKey)
        trace.push(`b${JSON.stringify(before)}a${JSON.stringify(after)}`)
      } catch (e) {
        trace.push("err:" + (e instanceof Error ? e.message : String(e)).slice(0, 60))
      }
    }
    check = `keys=${keys.length} mine=${mine.length} counts=${JSON.stringify(counts).slice(0, 60)} trace=${trace.join("|")}`
  } catch (e) {
    check = "check-err " + (e instanceof Error ? e.message : String(e))
  }
  const res = (await limitResponse(blobLimitStore(), "read", visitorIp(req, context.ip), 30)) ?? (await readPage(req))
  const out = new Response(res.body, res)
  out.headers.set("x-rl-debug", (note + " " + check + " status=" + res.status).replace(/[^\x20-\x7e]/g, "?").slice(0, 400))
  return out
}

export const config: Config = { path: "/api/read" }
