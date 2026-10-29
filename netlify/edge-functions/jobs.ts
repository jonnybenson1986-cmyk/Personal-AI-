import type { Config } from "@netlify/edge-functions"
import { blobJobStore } from "../shared/blobstore.ts"
import { jobsApi } from "../shared/jobs.ts"

export default (req: Request) =>
  jobsApi(req, {
    store: blobJobStore(),
    env: (name) => Netlify.env.get(name),
    // The background function (on this same deploy) answers 202 straight away and keeps running on its own.
    start: (body) => fetch(new URL("/.netlify/functions/run-job", req.url), { method: "POST", headers: { "content-type": "application/json" }, body }),
  })

export const config: Config = { path: ["/api/jobs", "/api/jobs/*"] }
