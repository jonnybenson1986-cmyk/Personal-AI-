import type { Config } from "@netlify/edge-functions"
import { openrouter, proxy } from "../shared/proxy.ts"

export default (req: Request) => proxy(req, openrouter, (name) => Netlify.env.get(name))

export const config: Config = { path: "/api/openrouter/*" }
