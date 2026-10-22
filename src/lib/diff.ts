// Line diff (Myers' algorithm) and unified-diff formatting for `git diff` and the change view.

export type DiffOp = { type: "same" | "add" | "del"; line: string }

function split(text: string) {
  if (text === "") return []
  const lines = text.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = split(before)
  const b = split(after)
  const n = a.length
  const m = b.length
  const max = n + m
  const v: Record<number, number> = { 1: 0 }
  const trace: Record<number, number>[] = []
  outer: for (let d = 0; d <= max; d++) {
    trace.push({ ...v })
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1] < v[k + 1]) ? v[k + 1] : v[k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k] = x
      if (x >= n && y >= m) break outer
    }
  }
  // Walk back through the trace to recover the edit script.
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd[k - 1] < vd[k + 1]) ? k + 1 : k - 1
    const prevX = vd[prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ type: "same", line: a[x - 1] })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: "add", line: b[y - 1] })
      else ops.push({ type: "del", line: a[x - 1] })
    }
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

export function diffStats(before: string | undefined, after: string | undefined) {
  const ops = diffLines(before ?? "", after ?? "")
  return { added: ops.filter((o) => o.type === "add").length, removed: ops.filter((o) => o.type === "del").length }
}

/** A unified diff with 3 lines of context, like `git diff`. */
export function unifiedDiff(path: string, before: string | undefined, after: string | undefined, context = 3) {
  const ops = diffLines(before ?? "", after ?? "")
  if (!ops.some((o) => o.type !== "same")) return ""
  const header = [
    `diff --git a/${path} b/${path}`,
    before === undefined ? "new file" : after === undefined ? "deleted file" : "",
    `--- ${before === undefined ? "/dev/null" : `a/${path}`}`,
    `+++ ${after === undefined ? "/dev/null" : `b/${path}`}`,
  ].filter(Boolean)
  const out: string[] = [...header]
  let i = 0
  let oldLine = 1
  let newLine = 1
  while (i < ops.length) {
    if (ops[i].type === "same") {
      i++
      oldLine++
      newLine++
      continue
    }
    // Start a hunk with up to `context` lines before the change.
    const start = Math.max(0, i - context)
    let oldStart = oldLine - (i - start)
    let newStart = newLine - (i - start)
    let end = i
    let lastChange = i
    while (end < ops.length && end - lastChange <= context * 2) {
      if (ops[end].type !== "same") lastChange = end
      end++
    }
    end = Math.min(ops.length, lastChange + context + 1)
    const hunk = ops.slice(start, end)
    const oldCount = hunk.filter((o) => o.type !== "add").length
    const newCount = hunk.filter((o) => o.type !== "del").length
    out.push(`@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`)
    for (const o of hunk) out.push((o.type === "add" ? "+" : o.type === "del" ? "-" : " ") + o.line)
    for (let j = i; j < end; j++) {
      if (ops[j].type !== "add") oldLine++
      if (ops[j].type !== "del") newLine++
    }
    i = end
  }
  return out.join("\n")
}
