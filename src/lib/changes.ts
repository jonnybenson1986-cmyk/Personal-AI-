// Finds the files an AI reply wants to create or change, so they can be pushed to GitHub.
// Models are asked to label each complete file's code block with its path (see EDIT_FORMAT);
// a path on the line just before a block is accepted too.
import { Marked, type Token, type Tokens } from "marked"

export interface FileChange {
  path: string
  content: string
}

/** Repo-relative, no "..", no leading slash, ordinary file-name characters. */
export function cleanPath(raw: string): string | undefined {
  const path = raw.trim().replace(/^[`*"']+|[`*"':]+$/g, "").replace(/^\.\//, "")
  if (!path || path.length > 300 || path.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(path)) return undefined
  if (!/^[\w@+\-.][\w@+\-./ ]*$/.test(path) || path.endsWith("/")) return undefined
  // Needs a folder or an extension (or a known extensionless name) to be a file path.
  if (!path.includes("/") && !/\.\w+$/.test(path) && !/^(Dockerfile|Makefile|Procfile|LICENSE|Gemfile|Rakefile)$/.test(path)) return undefined
  return path
}

/** The path named in a code block's info string: "ts path=src/a.ts", "ts:src/a.ts", "src/a.ts" or "ts src/a.ts". */
export function pathFromInfo(info: string): string | undefined {
  const explicit = info.match(/(?:^|\s)(?:path|file|filename)=["']?([^\s"']+)/i)
  if (explicit) return cleanPath(explicit[1])
  const colon = info.match(/^[\w+#-]+:(\S+)$/)
  if (colon) return cleanPath(colon[1])
  const words = info.trim().split(/\s+/)
  for (const word of words.length > 1 ? words.slice(1) : words) {
    // A lone word like "json" or "python" is a language, not a file.
    if (words.length === 1 && !/[/.]/.test(word)) return undefined
    const path = cleanPath(word)
    if (path) return path
  }
  return undefined
}

/** A paragraph that is nothing but a file path, like "**src/app.ts**" or "`README.md`:". */
function pathFromHeading(token: Token | undefined) {
  if (!token || (token.type !== "paragraph" && token.type !== "heading")) return undefined
  const text = (token as Tokens.Paragraph).text.trim()
  if (text.split(/\s+/).length > 3) return undefined
  return cleanPath(text.replace(/^(?:file|path)\s*:\s*/i, "").replace(/\s*\((?:new|updated|modified)\)$/i, ""))
}

export function parseFileChanges(markdown: string): FileChange[] {
  const tokens = new Marked().lexer(markdown).filter((t) => t.type !== "space")
  const found = new Map<string, string>()
  tokens.forEach((token, i) => {
    if (token.type !== "code") return
    const code = token as Tokens.Code
    const path = pathFromInfo(code.lang ?? "") ?? pathFromHeading(tokens[i - 1])
    // The last version of a file in the reply wins.
    if (path) found.set(path, code.text.endsWith("\n") ? code.text : code.text + "\n")
  })
  return [...found].map(([path, content]) => ({ path, content }))
}

/** Rough size of a change: lines only in the new file, lines only in the old one. */
export function lineStats(before: string | undefined, after: string) {
  if (before === undefined) return { added: after.split("\n").length - 1, removed: 0 }
  const count = (text: string) => {
    const map = new Map<string, number>()
    for (const line of text.split("\n")) map.set(line, (map.get(line) ?? 0) + 1)
    return map
  }
  const a = count(before)
  const b = count(after)
  let added = 0
  let removed = 0
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) ?? 0))
  for (const [line, n] of a) removed += Math.max(0, n - (b.get(line) ?? 0))
  return { added, removed }
}
