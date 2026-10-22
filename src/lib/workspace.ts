// The Code workspace: one GitHub repo and branch, with a working copy that lives in the
// browser. It behaves like a small git client over GitHub's API: edits stay local until
// `commit` (which creates a real commit object on GitHub without moving any branch) and
// `push` (which moves the branch, never forced).
import { createStore, produce, reconcile } from "solid-js/store"
import { get, set } from "idb-keyval"
import { branchHead, commitTree, createCommit, currentFile, defaultBranch, type FileEdit, moveBranch, openPullRequest, treeFiles } from "./github.ts"
import type { RepoTarget } from "./types.ts"

export interface LocalCommit {
  sha: string
  message: string
  paths: string[]
  url: string
}

export interface CodeTurn {
  id: string
  text: string
  reply: string
  status: "streaming" | "done" | "error" | "stopped"
  error?: string
  /** Files from the reply already applied to the working copy. */
  applied?: boolean
}

export interface WorkspaceState {
  target?: RepoTarget
  defaultBranch: string
  branch: string
  /** Whether `branch` exists on GitHub yet (false after `git checkout -b` until pushed). */
  remoteExists: boolean
  /** Commit the working copy was loaded from (the remote head at the last load, pull or push). */
  base: string
  /** Local head: `base` plus any unpushed commits. */
  head: string
  headTree: string
  commits: LocalCommit[]
  /** Paths in the head commit, with sizes. */
  files: Record<string, number>
  modes: Record<string, string>
  truncated: boolean
  /** Contents at head for files changed by unpushed commits (null = deleted). */
  committed: Record<string, string | null>
  /** Uncommitted edits (null = deleted). */
  changes: Record<string, string | null>
  open?: string
  cwd: string
  chat: CodeTurn[]
}

const empty = (): WorkspaceState => ({
  defaultBranch: "",
  branch: "",
  remoteExists: false,
  base: "",
  head: "",
  headTree: "",
  commits: [],
  files: {},
  modes: {},
  truncated: false,
  committed: {},
  changes: {},
  cwd: "",
  chat: [],
})

export const [ws, setWs] = createStore<WorkspaceState>(empty())

const KEY = "code:workspace"
let token = () => ""
/** Where the GitHub token comes from (Settings); set by the app. */
export function useToken(fn: () => string) {
  token = fn
}

export const githubToken = () => token()

let timer: ReturnType<typeof setTimeout> | undefined
function save() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (typeof indexedDB !== "undefined") void set(KEY, JSON.parse(JSON.stringify(ws))).catch(() => {})
  }, 300)
}

export function update(fn: (s: WorkspaceState) => void) {
  setWs(produce(fn))
  save()
}

export async function restoreWorkspace() {
  if (typeof indexedDB === "undefined") return
  const saved = await get<WorkspaceState>(KEY).catch(() => undefined)
  if (saved?.target) setWs(reconcile({ ...empty(), ...saved }))
}

// File contents are cached per commit; they never change for a given commit.
const cache = new Map<string, string | undefined>()

/** The file at the local head commit (undefined if it doesn't exist there). */
export async function headContent(path: string): Promise<string | undefined> {
  if (path in ws.committed) return ws.committed[path] ?? undefined
  if (!(path in ws.files)) return undefined
  const key = `${ws.base}:${path}`
  if (!cache.has(key)) cache.set(key, await currentFile(ws.target!, path, ws.base, token()))
  return cache.get(key)
}

/** The file as it is now, including uncommitted edits. */
export async function readFile(path: string) {
  if (path in ws.changes) return ws.changes[path] ?? undefined
  return headContent(path)
}

/** Every path in the working copy, sorted. */
export function workingFiles() {
  const paths = new Set(Object.keys(ws.files))
  for (const [p, c] of Object.entries(ws.changes)) c === null ? paths.delete(p) : paths.add(p)
  return [...paths].sort()
}

export function exists(path: string) {
  return path in ws.changes ? ws.changes[path] !== null : path in ws.files
}

export async function writeFile(path: string, content: string) {
  // Recorded straight away, so the editor never sees an older version come back while typing.
  update((s) => {
    s.changes[path] = content
  })
  // An edit that ends up identical to the committed file isn't a change.
  const original = await headContent(path)
  if (original === content && ws.changes[path] === content)
    update((s) => {
      delete s.changes[path]
    })
}

export async function removeFile(path: string) {
  const inHead = path in ws.files
  update((s) => {
    if (inHead) s.changes[path] = null
    else delete s.changes[path]
    if (s.open === path) s.open = undefined
  })
}

export function discard(path?: string) {
  update((s) => {
    if (path) delete s.changes[path]
    else s.changes = {}
  })
}

export type ChangeKind = "added" | "modified" | "deleted"

export function changeList(): { path: string; kind: ChangeKind }[] {
  return Object.entries(ws.changes)
    .map(([path, c]) => ({ path, kind: (c === null ? "deleted" : path in ws.files ? "modified" : "added") as ChangeKind }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Loads a repo at a branch (the default branch if none), replacing the workspace. */
export async function openRepo(target: RepoTarget, branch?: string) {
  const def = await defaultBranch(target, token())
  const name = branch ?? target.ref ?? def
  const sha = await branchHead(target, name, token())
  if (!sha) throw new Error(`Branch ${name} wasn't found.`)
  const tree = await commitTree(target, sha, token())
  const { files, truncated } = await treeFiles(target, tree, token())
  setWs(
    reconcile({
      ...empty(),
      target: { owner: target.owner, repo: target.repo },
      defaultBranch: def,
      branch: name,
      remoteExists: true,
      base: sha,
      head: sha,
      headTree: tree,
      files: Object.fromEntries(files.map((f) => [f.path, f.size])),
      modes: Object.fromEntries(files.filter((f) => f.mode !== "100644").map((f) => [f.path, f.mode])),
      truncated,
      chat: ws.target?.owner === target.owner && ws.target?.repo === target.repo ? ws.chat : [],
    }),
  )
  save()
}

/** Like `git commit -a`: records every uncommitted edit as one commit (not pushed yet). */
export async function commit(message: string) {
  const edits: FileEdit[] = Object.entries(ws.changes).map(([path, content]) => ({ path, content }))
  if (!edits.length) throw new Error("nothing to commit, working tree clean")
  const result = await createCommit({
    target: ws.target!,
    parent: ws.head,
    parentTree: ws.headTree,
    edits,
    message,
    token: token(),
    modes: new Map(Object.entries(ws.modes)),
  })
  update((s) => {
    for (const e of edits) {
      s.committed[e.path] = e.content
      if (e.content === null) delete s.files[e.path]
      else s.files[e.path] = new TextEncoder().encode(e.content).length
    }
    s.changes = {}
    s.head = result.sha
    s.headTree = result.tree
    s.commits.push({ sha: result.sha, message, paths: edits.map((e) => e.path), url: result.url })
  })
  return result
}

/** Moves the branch on GitHub to the local head. */
export async function push() {
  if (!ws.commits.length && ws.remoteExists) return { upToDate: true as const }
  await moveBranch(ws.target!, ws.branch, ws.head, ws.remoteExists, token())
  const pushed = ws.commits.length
  update((s) => {
    s.remoteExists = true
    s.base = s.head
    s.commits = []
    s.committed = {}
  })
  return { upToDate: false as const, pushed, branchUrl: `https://github.com/${ws.target!.owner}/${ws.target!.repo}/tree/${ws.branch}` }
}

/** `git checkout -b`: keeps everything, but pushes will go to a new branch. */
export function newBranch(name: string) {
  update((s) => {
    s.branch = name
    s.remoteExists = false
  })
}

export function hasUnsavedWork() {
  return Object.keys(ws.changes).length > 0 || ws.commits.length > 0
}

/** Switches branch, or reloads the current one (`git pull`). Refuses if work would be lost. */
export async function checkout(branch: string) {
  if (hasUnsavedWork()) throw new Error("You have uncommitted changes or unpushed commits. Push them or discard them first (git restore .).")
  const chat = ws.chat
  await openRepo(ws.target!, branch)
  update((s) => {
    s.chat = chat
  })
}

export async function pullRequest(title: string, body?: string) {
  if (ws.branch === ws.defaultBranch) throw new Error(`You're on ${ws.defaultBranch}. Create a branch first: git checkout -b my-change`)
  if (!ws.remoteExists || ws.commits.length) throw new Error("Push your commits first: git push")
  return openPullRequest(ws.target!, { head: ws.branch, base: ws.defaultBranch, title, body }, token())
}
