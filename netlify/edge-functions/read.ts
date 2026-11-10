import type { Config } from "@netlify/edge-functions"
import { readPage } from "../shared/read.ts"

export default (req: Request) => readPage(req)

// Each call downloads a page from the internet: limited per visitor so the reader can't be
// used as a free fetch service.
export const config: Config = {
  path: "/api/read",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
