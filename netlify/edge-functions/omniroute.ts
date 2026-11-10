import type { Config, Context } from "@netlify/edge-functions"
import { blobLimitStore } from "../shared/blobstore.ts"
import { gatewayProxy } from "../shared/gateway.ts"
import { limitResponse, visitorIp } from "../shared/limit.ts"

// Relays requests to a public OmniRoute gateway, so each visitor gets a generous minute's worth:
// the site can't be used as a general relay to other HTTPS addresses.
export default async (req: Request, context: Context) =>
  (await limitResponse(blobLimitStore(), "omniroute", visitorIp(req, context.ip), 120)) ?? gatewayProxy(req, (name) => Netlify.env.get(name))

export const config: Config = { path: "/api/omniroute/*" }
