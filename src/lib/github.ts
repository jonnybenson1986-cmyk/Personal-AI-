// Reads files from a GitHub repo straight from the browser (GitHub's API allows it). Public
// repos need nothing; a token from Settings unlocks private repos and higher rate limits.
import type { Attachment } from "./types"

export interface RepoRef {
  owner: string
  repo: string
  /** Branch, tag or commit; the default branch when missing. */
  ref?: string
  /** Folder to start in. */
  path?: string
}

/** Accepts "owner/repo", a github.com URL (including /tree/<branch>/<path>), or a clone URL. */
export function parseRepo(input: string): RepoRef | undefined {
  const text = input.trim().replace(/\.git$/, "").replace(/\/+$/, "")
  const url = text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?/i)
  if (url) return { owner: url[1], repo: url[2], ref: url[3], path: url[4] }
  const ssh = text.match(/^git@github\.com:([\w.-]+)\/([\w.-]+)$/i)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }
  const short = text.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (short) return { owner: short[1], repo: short[2] }
  return undefined
}

export interface RepoFile {
  path: string
  size: number
}

export interface Repo extends RepoRef {
  ref: string
  description?: string
  private: boolean
  files: RepoFile[]
  /** GitHub cut the file list short (very large repos). */
  truncated: boolean
}

const SKIP = /(^|\/)(node_modules|dist|build|out|vendor|\.git|\.next|coverage|__pycache__|\.venv|venv)\//
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|svgz|pdf|zip|gz|tgz|rar|7z|mp3|mp4|mov|wav|ogg|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|class|jar|wasm|psd|ai|sketch|fig)$/i
/** Files bigger than this are skipped: they'd crowd out the conversation. */
export const MAX_FILE_BYTES = 150_000

/** Whether a file is worth offering to the AI. */
export function readable(file: RepoFile) {
  return !SKIP.test(file.path) && !LOCKFILES.test(file.path) && !BINARY.test(file.path) && file.size <= MAX_FILE_BYTES
}

/** The files to tick by default: READMEs and top-level manifests. */
export function suggested(files: RepoFile[]) {
  return files.filter((f) => /^(readme(\.\w+)?|package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|netlify\.toml)$/i.test(f.path)).map((f) => f.path)
}

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  if (res.status === 404) throw new Error(token ? "Repo not found, or your token can't see it." : "Repo not found. If it's private, add a GitHub token in Settings.")
  if (res.status === 403 || res.status === 429) throw new Error("GitHub's rate limit was reached. Wait a few minutes, or add a GitHub token in Settings.")
  if (res.status === 401) throw new Error("GitHub didn't accept the token in Settings.")
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`)
  return res.json() as Promise<T>
}

export async function loadRepo(ref: RepoRef, token: string): Promise<Repo> {
  const info = await api<{ default_branch: string; description: string | null; private: boolean }>(`/repos/${ref.owner}/${ref.repo}`, token)
  const branch = ref.ref ?? info.default_branch
  const tree = await api<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  )
  const prefix = ref.path ? ref.path.replace(/\/+$/, "") + "/" : ""
  const files = tree.tree
    .filter((t) => t.type === "blob" && t.path.startsWith(prefix))
    .map((t) => ({ path: t.path, size: t.size ?? 0 }))
  return { ...ref, ref: branch, description: info.description ?? undefined, private: info.private, files, truncated: tree.truncated }
}

async function fileText(repo: Repo, path: string, token: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  // Public files come from the raw host (no API rate limit); private ones need the API.
  const res = token
    ? await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encoded}?ref=${encodeURIComponent(repo.ref)}`, {
        headers: { accept: "application/vnd.github.raw", authorization: `Bearer ${token}` },
      })
    : await fetch(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(repo.ref)}/${encoded}`)
  if (!res.ok) throw new Error(`Couldn't read ${path} (${res.status}).`)
  return res.text()
}

function textAttachment(name: string, text: string): Attachment {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { id: crypto.randomUUID(), name, mediaType: "text/plain", data: btoa(binary) }
}

/** A short outline of the repo so the AI knows what exists beyond the files it was given. */
export function repoMap(repo: Repo) {
  const lines = repo.files.filter((f) => !SKIP.test(f.path)).map((f) => f.path)
  const shown = lines.slice(0, 800)
  return [
    `Repository: github.com/${repo.owner}/${repo.repo} (branch ${repo.ref})`,
    repo.description ? `Description: ${repo.description}` : "",
    `Files (${lines.length}${lines.length > shown.length ? `, first ${shown.length} shown` : ""}):`,
    ...shown,
  ]
    .filter(Boolean)
    .join("\n")
}

/** The chosen files, plus the repo outline, as attachments for the next message. */
export async function repoAttachments(repo: Repo, paths: string[], includeMap: boolean, token: string) {
  const name = `${repo.owner}/${repo.repo}`
  const out: Attachment[] = includeMap ? [textAttachment(`${name} (file list)`, repoMap(repo))] : []
  const texts = await Promise.all(paths.map((p) => fileText(repo, p, token)))
  paths.forEach((p, i) => out.push(textAttachment(`${name}/${p}`, texts[i])))
  return out
}

export { textAttachment }
