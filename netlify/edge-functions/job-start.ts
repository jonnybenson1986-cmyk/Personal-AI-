import type { Config, Context } from "@netlify/edge-functions"
import { blobJobStore, blobLimitStore } from "../shared/blobstore.ts"
import { jobsApi } from "../shared/jobs.ts"
import { limitResponse, visitorIp } from "../shared/limit.ts"

// Starts a background job. On its own path so starts can be limited per visitor: each one runs a
// background function (which uses the site's Netlify credits) and an AI request with the site's key.
export default async (req: Request, context: Context) =>
  (await limitResponse(blobLimitStore(), "job-start", visitorIp(req, context.ip), 20)) ??
  jobsApi(new Request(new URL("/api/jobs", req.url), req), {
    store: blobJobStore(),
    env: (name) => Netlify.env.get(name),
    // The background function (on this same deploy) answers 202 straight away and keeps running on its own.
    start: (body) => fetch(new URL("/.netlify/functions/run-job", req.url), { method: "POST", headers: { "content-type": "application/json" }, body }),
  })

export const config: Config = { path: "/api/job-start" }
