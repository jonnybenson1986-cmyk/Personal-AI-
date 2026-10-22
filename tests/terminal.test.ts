import assert from "node:assert/strict"
import { before, test } from "node:test"
import { resolve, run, tokenize } from "../src/lib/terminal.ts"
import { useToken, ws } from "../src/lib/workspace.ts"

// A tiny in-memory GitHub: commits, trees and branches, enough for the git commands.
const trees: Record<string, Record<string, string>> = { t0: { "README.md": "# Demo\n", "src/app.js": "console.log('app')\n", "run.sh": "echo hi\n" } }
const commits: Record<string, { tree: string; parents: string[]; message: string }> = { c0: { tree: "t0", parents: [], message: "Initial commit" } }
const refs: Record<string, string> = { main: "c0" }
let n = 0
const calls: string[] = []

function ancestors(sha: string): string[] {
  const out = [sha]
  for (const p of commits[sha]?.parents ?? []) out.push(...ancestors(p))
  return out
}

before(() => {
  useToken(() => "github_pat_test")
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname.replace("/repos/jonny/demo", ""))
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push(`${method} ${path}`)
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 })
    const missing = () => new Response('{"message":"Not Found"}', { status: 404 })
    if (path === "") return ok({ default_branch: "main", private: false })
    let m
    if ((m = path.match(/^\/git\/ref\/heads\/(.+)$/))) return refs[m[1]] ? ok({ object: { sha: refs[m[1]] } }) : missing()
    if ((m = path.match(/^\/git\/commits\/(\w+)$/))) return ok({ tree: { sha: commits[m[1]].tree } })
    if ((m = path.match(/^\/git\/trees\/(\w+)$/)) && method === "GET")
      return ok({ truncated: false, tree: Object.entries(trees[m[1]]).map(([p, c]) => ({ path: p, type: "blob", size: c.length, mode: p.endsWith(".sh") ? "100755" : "100644" })) })
    if ((m = path.match(/^\/contents\/(.+)$/))) {
      const text = trees[commits[u.searchParams.get("ref")!]?.tree]?.[m[1]]
      return text === undefined ? missing() : new Response(text)
    }
    if (path === "/git/trees" && method === "POST") {
      const tree = { ...trees[body.base_tree] }
      for (const e of body.tree) e.sha === null ? delete tree[e.path] : (tree[e.path] = e.content)
      const sha = `t${++n}`
      trees[sha] = tree
      return ok({ sha })
    }
    if (path === "/git/commits" && method === "POST") {
      const sha = `c${++n}`
      commits[sha] = { tree: body.tree, parents: body.parents, message: body.message }
      return ok({ sha, html_url: `https://github.com/jonny/demo/commit/${sha}` })
    }
    if ((m = path.match(/^\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") {
      if (!ancestors(body.sha).includes(refs[m[1]])) return new Response('{"message":"Update is not a fast forward"}', { status: 422 })
      refs[m[1]] = body.sha
      return ok({})
    }
    if (path === "/git/refs" && method === "POST") {
      refs[body.ref.replace("refs/heads/", "")] = body.sha
      return ok({})
    }
    if (path === "/branches") return ok(Object.keys(refs).map((name) => ({ name })))
    if (path === "/commits")
      return ok(ancestors(refs[u.searchParams.get("sha")!] ?? u.searchParams.get("sha")!).map((sha) => ({ sha, html_url: "", commit: { message: commits[sha].message, author: { name: "Jonny", date: "2026-10-22T10:00:00Z" } } })))
    if (path === "/pulls" && method === "POST") return ok({ number: 5, html_url: "https://github.com/jonny/demo/pull/5" })
    return new Response(`{"message":"unexpected ${method} ${path}"}`, { status: 500 })
  }) as typeof fetch
})

const text = async (line: string) => (await run(line)).lines.map((l) => l.text).join("\n")

test("tokenize and resolve behave like a shell", () => {
  assert.deepEqual(tokenize(`git commit -m "Add dark mode" --x 'a b' c\\ d`), ["git", "commit", "-m", "Add dark mode", "--x", "a b", "c d"])
  assert.deepEqual(tokenize(`echo ""`), ["echo", ""])
  assert.throws(() => tokenize(`echo "oops`), /unclosed quote/)
  assert.equal(resolve("src/lib", "../app.js"), "src/app.js")
  assert.equal(resolve("src", "/README.md"), "README.md")
  assert.equal(resolve("src", "~"), "")
})

test("without a repo, commands explain how to open one", async () => {
  assert.match(await text("ls"), /git clone/)
})

test("clone, browse, edit, commit and push to main", async () => {
  assert.match(await text("git clone https://github.com/jonny/demo"), /Opened jonny\/demo on main \(3 files\)/)
  assert.equal(await text("ls"), "src/\nREADME.md\nrun.sh")
  await run("cd src")
  assert.equal(await text("pwd"), "/src")
  assert.equal(await text("cat app.js"), "console.log('app')")
  assert.match(await text("cd nowhere"), /no such folder/)
  await run(`echo "document.body.classList.add('dark')" >> app.js`)
  await run("cd ..")
  await run("touch docs/notes.md")
  await run("rm run.sh")
  assert.equal(
    await text("git status"),
    ["On branch main, up to date with GitHub", 'Changes (git commit -m "message" to commit them all):', "  added     docs/notes.md", "  deleted   run.sh", "  modified  src/app.js"].join("\n"),
  )
  assert.match(await text("git diff src/app.js"), /--- a\/src\/app\.js\n\+\+\+ b\/src\/app\.js\n@@ -1,1 \+1,2 @@\n console\.log\('app'\)\n\+document\.body\.classList\.add\('dark'\)$/)
  assert.match(await text('git commit -m "Add dark mode"'), /^\[main c\d+\] Add dark mode\n 3 files changed/)
  assert.match(await text("git status"), /ahead of origin\/main by 1 commit[\s\S]*working tree clean/)
  assert.equal(refs.main, "c0", "commit doesn't move the branch")
  assert.match(await text("git push"), /Pushed 1 commit to jonny\/demo → main/)
  const head = refs.main
  assert.deepEqual(trees[commits[head].tree], { "README.md": "# Demo\n", "src/app.js": "console.log('app')\ndocument.body.classList.add('dark')\n", "docs/notes.md": "" })
  assert.equal(await text("git push"), "Everything up-to-date")
  assert.match(await text("git log -n2"), /^c\d+ Add dark mode  — Jonny[\s\S]*c0 Initial commit/)
})

test("a feature branch is created on push, then a pull request", async () => {
  assert.match(await text("git checkout -b dark-toggle"), /new branch 'dark-toggle'/)
  await run('echo "# Demo with dark mode" > README.md')
  await run('git commit -m "Update README"')
  assert.equal(refs["dark-toggle"], undefined)
  assert.match(await text("git push"), /→ dark-toggle/)
  assert.equal(commits[refs["dark-toggle"]].parents[0], refs.main)
  assert.match(await text('gh pr create --title "Dark mode toggle"'), /Opened pull request #5\nhttps:\/\/github\.com\/jonny\/demo\/pull\/5/)
  assert.match(await text("git branch"), /\* dark-toggle\n  main/)
})

test("restore undoes edits; switching branch needs a clean tree", async () => {
  await run("rm README.md")
  assert.match(await text("git checkout main"), /uncommitted changes/)
  assert.match(await text("git restore ."), /Undid all uncommitted changes \(1 file\)/)
  assert.match(await text("git checkout main"), /Switched to branch 'main'/)
  assert.equal(ws.branch, "main")
  assert.equal(await text("cat README.md"), "# Demo")
})

test("a push is refused, not forced, when GitHub has moved on", async () => {
  await run('echo "x" > a.txt')
  await run('git commit -m "Local change"')
  // Someone else pushes to main meanwhile.
  commits.cX = { tree: commits[refs.main].tree, parents: [refs.main], message: "Remote change" }
  refs.main = "cX"
  assert.match(await text("git push"), /has new commits on GitHub/)
  assert.equal(refs.main, "cX")
})

test("programs can't run, and say why", async () => {
  assert.match(await text("npm run build"), /can't run programs here[\s\S]*Netlify builds/)
  assert.match(await text("frobnicate"), /command not found/)
  const ai = await run("ai add a footer")
  assert.equal(ai.ai, "add a footer")
  assert.equal((await run("clear")).clear, true)
})
