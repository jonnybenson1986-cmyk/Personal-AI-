import type { Config } from "@netlify/edge-functions"
import { blobJobStore } from "../shared/blobstore.ts"
import { jobsApi } from "../shared/jobs.ts"

// Following, stopping and removing jobs. Starting one is /api/job-start (rate-limited).
export default (req: Request) =>
  jobsApi(req, {
    store: blobJobStore(),
    env: (name) => Netlify.env.get(name),
    start: () => Promise.reject(new Error("Jobs start at /api/job-start")),
    allowStart: false,
  })

export const config: Config = { path: ["/api/jobs", "/api/jobs/*"] }
