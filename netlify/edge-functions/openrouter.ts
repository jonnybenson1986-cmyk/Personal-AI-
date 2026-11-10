import type { Config, Context } from "@netlify/edge-functions"
import { blobLimitStore } from "../shared/blobstore.ts"
import { limitResponse, visitorIp } from "../shared/limit.ts"
import { openrouter, proxy } from "../shared/proxy.ts"

// The site's own free key pays for these requests, so each visitor gets a fixed number a minute.
export default async (req: Request, context: Context) =>
  (await limitResponse(blobLimitStore(), "openrouter", visitorIp(req, context.ip), 60)) ??
  proxy(req, openrouter, (name) => Netlify.env.get(name))

export const config: Config = { path: "/api/openrouter/*" }
