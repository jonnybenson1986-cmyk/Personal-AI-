import type { Config } from "@netlify/edge-functions"
import { blobJobStore } from "../shared/blobstore.ts"
import { jobsApi } from "../shared/jobs.ts"

// Starts a background job. On its own path so starts can be rate-limited per visitor: each
// one runs a background function (which uses the site's Netlify credits) and an AI request.
export default (req: Request) =>
  jobsApi(new Request(new URL("/api/jobs", req.url), req), {
    store: blobJobStore(),
    env: (name) => Netlify.env.get(name),
    // The background function (on this same deploy) answers 202 straight away and keeps running on its own.
    start: (body) => fetch(new URL("/.netlify/functions/run-job", req.url), { method: "POST", headers: { "content-type": "application/json" }, body }),
  })

export const config: Config = {
  path: "/api/job-start",
  // A person sends a few messages a minute; this stops a script from running up the site's credits.
  // Netlify's own rule: the free plan allows two per site, so this and /api/openrouter are the two.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
}
