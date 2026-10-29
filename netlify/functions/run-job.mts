// Background function (up to 15 minutes): generates one AI reply and saves it as it goes.
import { blobJobStore } from "../shared/blobstore.ts"
import { runJob, type JobSecrets } from "../shared/jobs.ts"

export default async (req: Request) => {
  let body: { id?: string; secrets?: JobSecrets }
  try {
    body = await req.json()
  } catch {
    return
  }
  if (typeof body.id !== "string") return
  await runJob(body.id, body.secrets ?? {}, { store: blobJobStore(), env: (name) => Netlify.env.get(name), siteUrl: new URL(req.url).origin })
}

// No custom path: the built-in /.netlify/functions/run-job address is never caught by redirects.
export const config = { background: true }
