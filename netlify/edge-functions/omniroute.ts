import type { Config } from "@netlify/edge-functions"
import { gatewayProxy } from "../shared/gateway.ts"

export default (req: Request) => gatewayProxy(req)

export const config: Config = { path: "/api/omniroute/*" }
