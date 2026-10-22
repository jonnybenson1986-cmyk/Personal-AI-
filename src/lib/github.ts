// Reads files from a GitHub repo straight from the browser (GitHub's API allows it). Public
// repos need nothing; a token from Settings unlocks private repos and higher rate limits.
import type { Attachment, RepoTarget } from "./types"

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

async function api<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (res.ok) return res.json() as Promise<T>
  const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? ""
  if (res.status === 404) throw new Error(token ? "Repo or branch not found, or your token can't see it." : "Repo not found. If it's private, add a GitHub token in Settings.")
  if (res.status === 401) throw new Error("GitHub didn't accept the token in Settings.")
  if (res.status === 403 && /rate limit/i.test(detail)) throw new Error("GitHub's rate limit was reached. Wait a few minutes, or add a GitHub token in Settings.")
  if (res.status === 403) throw new Error("Your GitHub token doesn't have permission for this. It needs Contents (and Pull requests) set to Read and write for this repo.")
  if (res.status === 422 && /pull request already exists/i.test(detail)) throw new Error("A pull request for this branch already exists.")
  throw new Error(`GitHub: ${detail || res.status}`)
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
export type { RepoTarget }


/** The current text of a file on a branch, or undefined if it doesn't exist there. */
export async function currentFile(target: RepoTarget, path: string, branch: string, token: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  const res = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`, {
    headers: { accept: "application/vnd.github.raw", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`Couldn't read ${path} from GitHub (${res.status}).`)
  return res.text()
}

export async function defaultBranch(target: RepoTarget, token: string) {
  return (await api<{ default_branch: string }>(`/repos/${target.owner}/${target.repo}`, token)).default_branch
}

export interface PushRequest {
  target: RepoTarget
  files: { path: string; content: string }[]
  /** Branch to push to. Created from `base` if it doesn't exist yet. */
  branch: string
  base: string
  message: string
  pullRequest: boolean
  token: string
}

export interface PushResult {
  commitUrl: string
  branchUrl: string
  pullRequestUrl?: string
}

const repoPath = (t: RepoTarget) => `/repos/${t.owner}/${t.repo}`
const refPath = (branch: string) => `heads/${branch.split("/").map(encodeURIComponent).join("/")}`

/** The commit a branch points at, or undefined if the branch doesn't exist. */
export async function branchHead(target: RepoTarget, branch: string, token: string) {
  const res = await fetch(`https://api.github.com${repoPath(target)}/git/ref/${refPath(branch)}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  if (res.status === 404) return undefined
  if (!res.ok) await api(`${repoPath(target)}/git/ref/${refPath(branch)}`, token)
  return ((await res.json()) as { object: { sha: string } }).object.sha
}

export async function commitTree(target: RepoTarget, sha: string, token: string) {
  return (await api<{ tree: { sha: string } }>(`${repoPath(target)}/git/commits/${sha}`, token)).tree.sha
}

/** Every file in a commit's tree, with sizes and modes. */
export async function treeFiles(target: RepoTarget, treeSha: string, token: string) {
  const tree = await api<{ tree: { path: string; type: string; size?: number; mode: string }[]; truncated: boolean }>(
    `${repoPath(target)}/git/trees/${treeSha}?recursive=1`,
    token,
  )
  return { files: tree.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size ?? 0, mode: t.mode })), truncated: tree.truncated }
}

export interface FileEdit {
  path: string
  /** New content, or null to delete the file. */
  content: string | null
}

/**
 * Creates a commit on GitHub without moving any branch (like a local `git commit`).
 * `modes` keeps executable bits on files that have them.
 */
export async function createCommit(opts: {
  target: RepoTarget
  parent: string
  parentTree: string
  edits: FileEdit[]
  message: string
  token: string
  modes?: Map<string, string>
}) {
  if (!opts.token) throw new Error("Add a GitHub token with write access in Settings to commit.")
  const tree = await api<{ sha: string }>(`${repoPath(opts.target)}/git/trees`, opts.token, {
    method: "POST",
    body: {
      base_tree: opts.parentTree,
      tree: opts.edits.map((e) =>
        e.content === null
          ? { path: e.path, mode: "100644", type: "blob", sha: null }
          : { path: e.path, mode: opts.modes?.get(e.path) === "100755" ? "100755" : "100644", type: "blob", content: e.content },
      ),
    },
  })
  const commit = await api<{ sha: string; html_url: string }>(`${repoPath(opts.target)}/git/commits`, opts.token, {
    method: "POST",
    body: { message: opts.message, tree: tree.sha, parents: [opts.parent] },
  })
  return { sha: commit.sha, tree: tree.sha, url: commit.html_url }
}

/** Points a branch at a commit: creates it, or fast-forwards it (never forced). */
export async function moveBranch(target: RepoTarget, branch: string, sha: string, exists: boolean, token: string) {
  if (exists) {
    try {
      await api(`${repoPath(target)}/git/refs/${refPath(branch)}`, token, { method: "PATCH", body: { sha, force: false } })
    } catch (e) {
      if (/fast forward|422/i.test((e as Error).message)) throw new Error(`The branch ${branch} has new commits on GitHub. Run "git pull" (with no local changes) and redo your edits, or push to a new branch.`)
      throw e
    }
  } else await api(`${repoPath(target)}/git/refs`, token, { method: "POST", body: { ref: `refs/heads/${branch}`, sha } })
}

export async function openPullRequest(target: RepoTarget, opts: { head: string; base: string; title: string; body?: string }, token: string) {
  const pr = await api<{ html_url: string; number: number }>(`${repoPath(target)}/pulls`, token, {
    method: "POST",
    body: { title: opts.title, head: opts.head, base: opts.base, body: [opts.body?.trim(), "Made with Jonny's AI project."].filter(Boolean).join("\n\n") },
  })
  return pr
}

export async function listBranches(target: RepoTarget, token: string) {
  return (await api<{ name: string }[]>(`${repoPath(target)}/branches?per_page=100`, token)).map((b) => b.name)
}

export async function listCommits(target: RepoTarget, branch: string, token: string, count = 10) {
  const commits = await api<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } } }[]>(
    `${repoPath(target)}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`,
    token,
  )
  return commits.map((c) => ({ sha: c.sha, url: c.html_url, message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date }))
}

/**
 * Commits every file in one commit on top of the branch (or of `base` for a new branch),
 * then moves the branch to it. Never force-pushes: if the branch moved meanwhile, it fails.
 */
export async function pushFiles(req: PushRequest): Promise<PushResult> {
  if (!req.token) throw new Error("Add a GitHub token with write access in Settings to push.")
  const existing = await branchHead(req.target, req.branch, req.token)
  const parent = existing ?? (await branchHead(req.target, req.base, req.token))
  if (!parent) throw new Error(`The branch ${req.base} wasn't found.`)
  const parentTree = await commitTree(req.target, parent, req.token)
  const modes = new Map<string, string>()
  try {
    for (const f of (await treeFiles(req.target, parentTree, req.token)).files) modes.set(f.path, f.mode)
  } catch {
    // A huge or odd tree: fall back to ordinary file mode.
  }
  const commit = await createCommit({ target: req.target, parent, parentTree, edits: req.files, message: req.message, token: req.token, modes })
  await moveBranch(req.target, req.branch, commit.sha, !!existing, req.token)
  const result: PushResult = {
    commitUrl: commit.url,
    branchUrl: `https://github.com/${req.target.owner}/${req.target.repo}/tree/${req.branch}`,
  }
  if (req.pullRequest && req.branch !== req.base) {
    const [title, ...rest] = req.message.split("\n")
    result.pullRequestUrl = (await openPullRequest(req.target, { head: req.branch, base: req.base, title, body: rest.join("\n") }, req.token)).html_url
  }
  return result
}

/** A short branch name from a commit message: "jonny-ai/add-dark-mode-k3f9". */
export function branchName(message: string) {
  const slug = message.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "")
  return `jonny-ai/${slug || "changes"}-${Math.random().toString(36).slice(2, 6)}`
}
