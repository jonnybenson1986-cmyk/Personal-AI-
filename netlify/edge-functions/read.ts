import type { Config, Context } from "@netlify/edge-functions"
import { blobLimitStore } from "../shared/blobstore.ts"
import { limitResponse } from "../shared/limit.ts"
import { readPage } from "../shared/read.ts"

// Each call downloads a page from the internet, so each visitor gets a few a minute: the
// reader can't be used as a free fetch service.
export default async (req: Request, context: Context) =>
  (await limitResponse(blobLimitStore(), "read", context.ip, 30)) ?? readPage(req)

export const config: Config = { path: "/api/read" }
