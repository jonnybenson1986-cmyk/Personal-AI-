import type { Config } from "@netlify/edge-functions"
import { gatewayProxy } from "../shared/gateway.ts"

export default (req: Request) => gatewayProxy(req, (name) => Netlify.env.get(name))

// Relays requests to a public OmniRoute gateway: limited per visitor so the site can't be used
// as a general relay to other HTTPS addresses.
export const config: Config = {
  path: "/api/omniroute/*",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
