import assert from "node:assert/strict"
import { test } from "node:test"
import { allowedUrl, htmlToText } from "../netlify/shared/read.ts"
import { parseRepo, readable, suggested } from "../src/lib/github.ts"

test("GitHub repo links in every common form", () => {
  assert.deepEqual(parseRepo("jonnybenson1986-cmyk/Personal-AI-"), { owner: "jonnybenson1986-cmyk", repo: "Personal-AI-" })
  assert.deepEqual(parseRepo("https://github.com/anomalyco/opencode/tree/v2/packages/app"), { owner: "anomalyco", repo: "opencode", ref: "v2", path: "packages/app" })
  assert.deepEqual(parseRepo("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo", ref: undefined, path: undefined })
  assert.deepEqual(parseRepo("git@github.com:owner/repo.git"), { owner: "owner", repo: "repo" })
  assert.equal(parseRepo("not a repo"), undefined)
})

test("only readable source files are offered, READMEs pre-selected", () => {
  const files = [
    { path: "README.md", size: 2000 },
    { path: "src/app.ts", size: 4000 },
    { path: "node_modules/x/index.js", size: 10 },
    { path: "package-lock.json", size: 90000 },
    { path: "public/logo.png", size: 5000 },
    { path: "data/huge.json", size: 900000 },
    { path: "package.json", size: 800 },
  ]
  assert.deepEqual(files.filter(readable).map((f) => f.path), ["README.md", "src/app.ts", "package.json"])
  assert.deepEqual(suggested(files.filter(readable)), ["README.md", "package.json"])
})

test("the page reader only fetches public web addresses", () => {
  assert.equal(allowedUrl("example.com/a")?.href, "https://example.com/a")
  assert.ok(allowedUrl("http://news.bbc.co.uk"))
  for (const bad of ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5/x", "http://[::1]/", "file:///etc/passwd", "http://router.local", "http://intranet", "https://user:pw@example.com", null])
    assert.equal(allowedUrl(bad), undefined, String(bad))
})

test("HTML is reduced to readable text", () => {
  const page = htmlToText(
    `<html><head><title>My &amp; Page</title><style>p{}</style></head><body><nav>Menu</nav><article><h1>Hello</h1><p>First&nbsp;para.</p><script>evil()</script><p>Second <b>bold</b>.</p></article><footer>©</footer></body></html>`,
  )
  assert.equal(page.title, "My & Page")
  assert.equal(page.text, "Hello\n\nFirst para.\n\nSecond bold.")
})
