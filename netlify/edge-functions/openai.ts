import type { Config } from "@netlify/edge-functions"
import { openai, proxy } from "../shared/proxy.ts"

export default (req: Request) => proxy(req, openai, (name) => Netlify.env.get(name))

export const config: Config = { path: "/api/openai/*" }
