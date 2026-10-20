import type { Config } from "@netlify/edge-functions"
import { anthropic, proxy } from "../shared/proxy.ts"

export default (req: Request) => proxy(req, anthropic, (name) => Netlify.env.get(name))

export const config: Config = { path: "/api/anthropic/*" }
