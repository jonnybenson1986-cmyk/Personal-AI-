import type { Config } from "@netlify/edge-functions"
import { readPage } from "../shared/read.ts"

export default (req: Request) => readPage(req)

export const config: Config = { path: "/api/read" }
