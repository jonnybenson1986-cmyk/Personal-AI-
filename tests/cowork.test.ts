import assert from "node:assert/strict"
import { test } from "node:test"
import { coworkSystem, docxText, fileKind, formatSize, isTextKind, parseCsv, pickContext, safePath, uniquePath } from "../src/lib/cowork.ts"

test("file kinds come from the name, then the type", () => {
  assert.equal(fileKind("notes.md"), "markdown")
  assert.equal(fileKind("data.CSV"), "csv")
  assert.equal(fileKind("sheet.tsv"), "csv")
  assert.equal(fileKind("report.pdf"), "pdf")
  assert.equal(fileKind("scan", "application/pdf"), "pdf")
  assert.equal(fileKind("letter.docx"), "docx")
  assert.equal(fileKind("photo.JPG"), "image")
  assert.equal(fileKind("logo.svg"), "text")
  assert.equal(fileKind("app.tsx"), "text")
  assert.equal(fileKind("Makefile"), "text")
  assert.equal(fileKind("archive.zip", "application/zip"), "binary")
  assert.equal(fileKind("whatever.bin", "text/plain"), "text")
  assert.ok(isTextKind("csv") && !isTextKind("pdf"))
})

test("CSV with quotes, commas and newlines inside fields", () => {
  assert.deepEqual(parseCsv('name,note\r\n"Smith, J","said ""hi""\nthen left"\nLee,\n'), [
    ["name", "note"],
    ["Smith, J", 'said "hi"\nthen left'],
    ["Lee", ""],
  ])
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ])
  assert.deepEqual(parseCsv(""), [])
})

test("safe paths keep folders and drop anything risky", () => {
  assert.equal(safePath("My Report (final).pdf"), "My Report -final-.pdf")
  assert.equal(safePath("../../etc/passwd"), "etc/passwd")
  assert.equal(safePath("docs\\notes.md"), "docs/notes.md")
  assert.equal(safePath("///"), "file.txt")
})

test("unique paths number the copies", () => {
  const taken = new Set(["a.txt", "a (2).txt", "notes"])
  assert.equal(uniquePath(taken, "b.txt"), "b.txt")
  assert.equal(uniquePath(taken, "a.txt"), "a (3).txt")
  assert.equal(uniquePath(taken, "notes"), "notes (2)")
})

test("context puts named and picked files first and cuts long files short", () => {
  const files = [
    { path: "a.md", kind: "markdown" as const, size: 3, text: "aaa" },
    { path: "b.csv", kind: "csv" as const, size: 3, text: "bbb" },
    { path: "pic.png", kind: "image" as const, size: 3 },
    { path: "long.txt", kind: "text" as const, size: 5000, text: "x".repeat(5000) },
  ]
  assert.deepEqual(
    pickContext(files, "what is in b.csv?", []).map((f) => f.path),
    ["b.csv", "a.md", "long.txt"],
  )
  assert.deepEqual(
    pickContext(files, "summarize", ["a.md"]).map((f) => f.path),
    ["a.md"],
  )
  const cut = pickContext(files, "LONG.TXT please", [], 1200)
  assert.equal(cut[0].path, "long.txt")
  assert.equal(cut[0].truncated, true)
  assert.equal(cut[0].text.length, 1200)
  assert.equal(cut.length, 1)
})

test("Word document text keeps paragraphs and decodes entities", () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r></w:p><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>&#8364;5</w:t></w:r></w:p></w:body></w:document>'
  assert.equal(docxText(xml), "Tom & Jerry\nA\tB\n€5")
})

test("the system prompt asks for files in the pushable format, without commit wording", () => {
  const s = coworkSystem("Be brief.")
  assert.match(s, /path=/)
  assert.doesNotMatch(s, /commit message/)
  assert.match(s, /Be brief\.$/)
  assert.equal(formatSize(512), "512 B")
  assert.equal(formatSize(2048), "2.0 KB")
  assert.equal(formatSize(3 * 1024 * 1024), "3.0 MB")
})
