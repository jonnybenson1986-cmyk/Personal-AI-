import type { Config } from "@netlify/edge-functions"
import { openrouter, proxy } from "../shared/proxy.ts"

export default (req: Request) => proxy(req, openrouter, (name) => Netlify.env.get(name))

export const config: Config = {
  path: "/api/openrouter/*",
  // Keeps the site's free key from being drained by one visitor (free models allow about 20 a minute anyway).
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
