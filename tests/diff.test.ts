import assert from "node:assert/strict"
import { test } from "node:test"
import { diffLines, diffStats, unifiedDiff } from "../src/lib/diff.ts"

test("diffLines finds the smallest edit", () => {
  assert.deepEqual(
    diffLines("a\nb\nc\n", "a\nB\nc\nd\n").map((o) => (o.type === "same" ? " " : o.type === "add" ? "+" : "-") + o.line),
    [" a", "-b", "+B", " c", "+d"],
  )
  assert.deepEqual(diffLines("", "x\n"), [{ type: "add", line: "x" }])
  assert.deepEqual(diffLines("x\n", ""), [{ type: "del", line: "x" }])
  assert.deepEqual(diffStats("a\nb\n", "a\nb\n"), { added: 0, removed: 0 })
})

test("unified diff matches git's shape", () => {
  const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n") + "\n"
  const after = before.replace("5\n", "five\n")
  assert.equal(
    unifiedDiff("n.txt", before, after),
    ["diff --git a/n.txt b/n.txt", "--- a/n.txt", "+++ b/n.txt", "@@ -2,7 +2,7 @@", " 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8"].join("\n"),
  )
  assert.equal(unifiedDiff("same.txt", "a\n", "a\n"), "")
  assert.match(unifiedDiff("new.md", undefined, "hi\n"), /new file\n--- \/dev\/null\n\+\+\+ b\/new\.md\n@@ -0,0 \+1,1 @@\n\+hi$/)
  assert.match(unifiedDiff("gone.md", "bye\n", undefined), /deleted file\n--- a\/gone\.md\n\+\+\+ \/dev\/null\n@@ -1,1 \+0,0 @@\n-bye$/)
})

test("diffs of larger files stay correct", () => {
  const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\n"
  const after = before.replace("line 10\n", "").replace("line 300\n", "line 300\ninserted\n")
  assert.deepEqual(diffStats(before, after), { added: 1, removed: 1 })
})
