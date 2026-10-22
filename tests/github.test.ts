import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanPath, lineStats, parseFileChanges, pathFromInfo } from "../src/lib/changes.ts"
import { branchName, pushFiles } from "../src/lib/github.ts"
import { chatMessages } from "../src/lib/history.ts"
import type { Turn } from "../src/lib/types.ts"

test("file paths come from the code block's opening line in the usual forms", () => {
  assert.equal(pathFromInfo("ts path=src/app.ts"), "src/app.ts")
  assert.equal(pathFromInfo('tsx file="src/App.tsx"'), "src/App.tsx")
  assert.equal(pathFromInfo("js:src/a.js"), "src/a.js")
  assert.equal(pathFromInfo("src/b.js"), "src/b.js")
  assert.equal(pathFromInfo("css styles.css"), "styles.css")
  assert.equal(pathFromInfo("json"), undefined)
  assert.equal(pathFromInfo("python"), undefined)
  assert.equal(pathFromInfo(""), undefined)
})

test("unsafe or non-file paths are rejected", () => {
  for (const bad of ["../etc/passwd", "/abs/path.ts", "a/../../b.ts", "src/", "hello world", "foo"]) assert.equal(cleanPath(bad), undefined, bad)
  assert.equal(cleanPath("`./src/x.ts`:"), "src/x.ts")
  assert.equal(cleanPath("Dockerfile"), "Dockerfile")
})

test("complete files are found in a reply; plain snippets are ignored", () => {
  const reply = [
    "Here's the change.",
    "",
    "```ts path=src/app.ts",
    "export const a = 1",
    "```",
    "",
    "**README.md**",
    "",
    "```markdown",
    "# Demo",
    "```",
    "",
    "Run it with:",
    "",
    "```bash",
    "npm start",
    "```",
    "",
    "```ts path=src/app.ts",
    "export const a = 2",
    "```",
    "",
    "Add a constant and a README",
  ].join("\n")
  assert.deepEqual(parseFileChanges(reply), [
    { path: "src/app.ts", content: "export const a = 2\n" },
    { path: "README.md", content: "# Demo\n" },
  ])
  assert.deepEqual(parseFileChanges("```js\nconsole.log(1)\n```"), [])
})

test("line stats count added and removed lines", () => {
  assert.deepEqual(lineStats(undefined, "a\nb\n"), { added: 2, removed: 0 })
  assert.deepEqual(lineStats("a\nb\nc\n", "a\nB\nc\nd\n"), { added: 2, removed: 1 })
})

test("a connected repo asks the AI for pushable files", () => {
  const turn: Turn = { id: "t", repo: { owner: "jonny", repo: "demo", ref: "main" }, text: "add dark mode", attachments: [], replies: [], createdAt: 0 }
  const content = chatMessages("", [], turn, { id: "openrouter/free" })[0].content as string
  assert.match(content, /^This is about the GitHub repository jonny\/demo \(branch main\)\. When you create or change files.*path=src\/app\.ts.*\n\nadd dark mode$/s)
  // The "Edit a GitHub repo" tool already includes the format; it isn't repeated.
  const withTool = chatMessages("", [], { ...turn, tool: "repo" }, { id: "openrouter/free" })[0].content as string
  assert.equal(withTool.match(/When you create or change files/g)?.length, 1)
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function github(existing: Record<string, string>) {
  const calls: { method: string; url: string; body?: any; auth?: string }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, url: url.replace("https://api.github.com/repos/jonny/demo", ""), body, auth: new Headers(init.headers).get("authorization") ?? undefined })
    const path = url.replace("https://api.github.com/repos/jonny/demo", "")
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 })
    const ref = path.match(/^\/git\/ref\/heads\/(.+)$/)
    if (ref) return existing[decodeURIComponent(ref[1])] ? ok({ object: { sha: existing[decodeURIComponent(ref[1])] } }) : new Response('{"message":"Not Found"}', { status: 404 })
    if (path.startsWith("/git/commits/")) return ok({ tree: { sha: "tree-base" } })
    if (path.startsWith("/git/trees/tree-base")) return ok({ tree: [{ path: "run.sh", mode: "100755" }, { path: "src/app.ts", mode: "100644" }] })
    if (path === "/git/trees" && method === "POST") return ok({ sha: "tree-new" })
    if (path === "/git/commits" && method === "POST") return ok({ sha: "commit-new", html_url: "https://github.com/jonny/demo/commit/commit-new" })
    if (path.startsWith("/git/refs")) return ok({})
    if (path === "/pulls") return ok({ html_url: "https://github.com/jonny/demo/pull/7" })
    return new Response("{}", { status: 500 })
  }) as typeof fetch
  return calls
}

const files = [
  { path: "src/app.ts", content: "a\n" },
  { path: "run.sh", content: "echo hi\n" },
]

test("pushing to a new branch commits on top of main and opens a pull request", async () => {
  const calls = github({ main: "main-sha" })
  const result = await pushFiles({ target: { owner: "jonny", repo: "demo" }, files, branch: "jonny-ai/dark-mode", base: "main", message: "Add dark mode\n\nDetails", pullRequest: true, token: "ghp_x" })
  assert.deepEqual(result, {
    commitUrl: "https://github.com/jonny/demo/commit/commit-new",
    branchUrl: "https://github.com/jonny/demo/tree/jonny-ai/dark-mode",
    pullRequestUrl: "https://github.com/jonny/demo/pull/7",
  })
  const tree = calls.find((c) => c.url === "/git/trees" && c.method === "POST")!.body
  assert.equal(tree.base_tree, "tree-base")
  assert.deepEqual(tree.tree.map((t: any) => [t.path, t.mode]), [["src/app.ts", "100644"], ["run.sh", "100755"]])
  assert.deepEqual(calls.find((c) => c.url === "/git/commits" && c.method === "POST")!.body, { message: "Add dark mode\n\nDetails", tree: "tree-new", parents: ["main-sha"] })
  assert.deepEqual(calls.find((c) => c.url === "/git/refs")!.body, { ref: "refs/heads/jonny-ai/dark-mode", sha: "commit-new" })
  const pr = calls.find((c) => c.url === "/pulls")!.body
  assert.deepEqual([pr.title, pr.head, pr.base], ["Add dark mode", "jonny-ai/dark-mode", "main"])
  assert.ok(calls.every((c) => c.auth === "Bearer ghp_x"))
})

test("pushing straight to main fast-forwards it without force and opens no pull request", async () => {
  const calls = github({ main: "main-sha" })
  const result = await pushFiles({ target: { owner: "jonny", repo: "demo" }, files, branch: "main", base: "main", message: "Fix", pullRequest: true, token: "ghp_x" })
  assert.equal(result.pullRequestUrl, undefined)
  const update = calls.find((c) => c.url === "/git/refs/heads/main")!
  assert.equal(update.method, "PATCH")
  assert.deepEqual(update.body, { sha: "commit-new", force: false })
  assert.ok(!calls.some((c) => c.url === "/pulls"))
})

test("pushing needs a token", async () => {
  await assert.rejects(pushFiles({ target: { owner: "jonny", repo: "demo" }, files, branch: "main", base: "main", message: "x", pullRequest: false, token: "" }), /GitHub token/)
})

test("branch names are short and safe", () => {
  assert.match(branchName("Add a dark mode toggle to the settings page!"), /^jonny-ai\/add-a-dark-mode-toggle-to-the-se-[a-z0-9]{1,4}$/)
  assert.match(branchName("***"), /^jonny-ai\/changes-[a-z0-9]{1,4}$/)
})
