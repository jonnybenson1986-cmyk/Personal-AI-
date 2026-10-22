// The Code workspace terminal: a small shell with git-style commands over the workspace.
// It runs in the browser, so it can read and change files and talk to GitHub, but it can't
// run programs (npm, node, python): there's no computer behind a Netlify site to run them on.
import { unifiedDiff } from "./diff.ts"
import { listBranches, listCommits, parseRepo } from "./github.ts"
import {
  changeList,
  checkout,
  commit,
  discard,
  exists,
  githubToken,
  headContent,
  newBranch,
  openRepo,
  pullRequest,
  push,
  readFile,
  removeFile,
  update,
  workingFiles,
  writeFile,
  ws,
} from "./workspace.ts"

export type Tone = "out" | "ok" | "err" | "dim" | "add" | "del" | "head" | "link"

export interface Line {
  text: string
  tone?: Tone
  href?: string
}

export interface Result {
  lines: Line[]
  /** Things the UI does after a command. */
  clear?: boolean
  open?: string
  ai?: string
  preview?: string
}

/** Splits a command line into words, honouring quotes and backslash escapes. */
export function tokenize(line: string) {
  const words: string[] = []
  let word = ""
  let quote: string | undefined
  let started = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = undefined
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i]
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (c === "\\" && i + 1 < line.length) {
      word += line[++i]
      started = true
    } else if (/\s/.test(c)) {
      if (started) words.push(word)
      word = ""
      started = false
    } else {
      word += c
      started = true
    }
  }
  if (quote) throw new Error("unclosed quote")
  if (started) words.push(word)
  return words
}

/** Resolves a path against the current folder; "" is the repo root. */
export function resolve(cwd: string, input = "."): string {
  const parts = input.startsWith("/") || input.startsWith("~") ? [] : cwd.split("/").filter(Boolean)
  for (const part of input.replace(/^~\/?/, "").split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return parts.join("/")
}

function isDir(path: string) {
  if (path === "") return true
  return workingFiles().some((f) => f.startsWith(path + "/"))
}

/** Entries directly inside a folder: subfolders (with a trailing slash) then files. */
export function listDir(dir: string) {
  const prefix = dir ? dir + "/" : ""
  const dirs = new Set<string>()
  const files: string[] = []
  for (const f of workingFiles()) {
    if (!f.startsWith(prefix)) continue
    const rest = f.slice(prefix.length)
    const slash = rest.indexOf("/")
    if (slash >= 0) dirs.add(rest.slice(0, slash) + "/")
    else files.push(rest)
  }
  return [...[...dirs].sort(), ...files.sort()]
}

const out = (text: string, tone: Tone = "out"): Line => ({ text, tone })
const err = (text: string): Line => ({ text, tone: "err" })

const HELP = `Files
  ls [dir]            list a folder         cd <dir>       change folder
  cat <file>          print a file          open <file>    open in the editor
  touch <file>        create an empty file  rm <file>      delete a file
  mv <from> <to>      rename or move        tree [dir]     show all files
  grep <text> [dir]   search file contents  pwd            current folder
  echo "text" > file  write (>> appends)    preview <file> run HTML in the canvas
Git
  git status          what changed          git diff [file]  line-by-line changes
  git commit -m "msg" commit all changes    git push         send commits to GitHub
  git checkout -b <name>  start a branch    git checkout <branch>  switch branch
  git restore <file|.>    undo edits        git pull         get the latest from GitHub
  git log             recent commits        git branch       list branches
  gh pr create --title "..."  open a pull request
Other
  ai <request>        ask the AI to change the code     clear   clear the screen
  git clone <owner/repo or URL>  open another repo`

/** Runs one command line against the workspace. */
export async function run(line: string): Promise<Result> {
  let words: string[]
  try {
    words = tokenize(line.trim())
  } catch (e) {
    return { lines: [err((e as Error).message)] }
  }
  if (!words.length) return { lines: [] }
  const [cmd, ...args] = words
  if (cmd === "help" || cmd === "?") return { lines: HELP.split("\n").map((l) => out(l)) }
  if (cmd === "clear" || cmd === "cls") return { lines: [], clear: true }
  if (cmd === "ai") return args.length ? { lines: [out("Asking the AI…", "dim")], ai: args.join(" ") } : { lines: [err("usage: ai <what to change>")] }
  if (cmd === "git" && args[0] === "clone") return clone(args[1])
  if (!ws.target) return { lines: [err("No repo open. Run: git clone <owner/repo>")] }
  try {
    return await dispatch(cmd, args)
  } catch (e) {
    return { lines: [err((e as Error).message)] }
  }
}

async function clone(input?: string): Promise<Result> {
  const ref = input && parseRepo(input)
  if (!ref) return { lines: [err("usage: git clone <owner/repo or github.com URL>")] }
  try {
    await openRepo(ref, ref.ref)
    return { lines: [out(`Opened ${ref.owner}/${ref.repo} on ${ws.branch} (${Object.keys(ws.files).length} files)`, "ok")] }
  } catch (e) {
    return { lines: [err((e as Error).message)] }
  }
}

async function dispatch(cmd: string, args: string[]): Promise<Result> {
  const cwd = ws.cwd
  switch (cmd) {
    case "pwd":
      return { lines: [out("/" + cwd)] }
    case "cd": {
      const dir = resolve(cwd, args[0] ?? "/")
      if (!isDir(dir)) return { lines: [err(`cd: no such folder: ${args[0]}`)] }
      update((s) => {
        s.cwd = dir
      })
      return { lines: [] }
    }
    case "ls":
    case "dir": {
      const target = resolve(cwd, args.find((a) => !a.startsWith("-")) ?? ".")
      if (exists(target)) return { lines: [out(target.split("/").pop()!)] }
      if (!isDir(target)) return { lines: [err(`ls: no such file or folder: ${args[0]}`)] }
      const entries = listDir(target)
      return { lines: entries.length ? entries.map((e) => out(e, e.endsWith("/") ? "head" : "out")) : [out("(empty)", "dim")] }
    }
    case "tree": {
      const dir = resolve(cwd, args[0] ?? ".")
      const files = workingFiles().filter((f) => !dir || f.startsWith(dir + "/"))
      const shown = files.slice(0, 300)
      return { lines: [...shown.map((f) => out(dir ? f.slice(dir.length + 1) : f)), ...(files.length > shown.length ? [out(`… and ${files.length - shown.length} more`, "dim")] : [])] }
    }
    case "cat":
    case "less":
    case "more":
    case "head":
    case "tail": {
      const file = args.find((a) => !a.startsWith("-"))
      if (!file) return { lines: [err(`usage: ${cmd} <file>`)] }
      const path = resolve(cwd, file)
      const text = await readFile(path)
      if (text === undefined) return { lines: [err(`${cmd}: ${file}: no such file`)] }
      let lines = text.replace(/\n$/, "").split("\n")
      if (cmd === "head") lines = lines.slice(0, 10)
      if (cmd === "tail") lines = lines.slice(-10)
      return { lines: lines.map((l) => out(l)) }
    }
    case "open":
    case "edit":
    case "code":
    case "vim":
    case "nano": {
      if (!args[0]) return { lines: [err(`usage: ${cmd} <file>`)] }
      const path = resolve(cwd, args[0])
      if (!exists(path)) await writeFile(path, "")
      return { lines: [out(`Opened ${path} in the editor`, "dim")], open: path }
    }
    case "preview": {
      if (!args[0]) return { lines: [err("usage: preview <file.html>")] }
      const path = resolve(cwd, args[0])
      if (!exists(path)) return { lines: [err(`preview: ${args[0]}: no such file`)] }
      return { lines: [out(`Previewing ${path}`, "dim")], preview: path }
    }
    case "touch": {
      if (!args.length) return { lines: [err("usage: touch <file>")] }
      for (const a of args) {
        const path = resolve(cwd, a)
        if (!exists(path)) await writeFile(path, "")
      }
      return { lines: [] }
    }
    case "mkdir":
      return { lines: [out("Folders appear when a file is added to them, e.g. touch docs/notes.md", "dim")] }
    case "rm":
    case "del": {
      const targets = args.filter((a) => !a.startsWith("-"))
      if (!targets.length) return { lines: [err("usage: rm <file>")] }
      const lines: Line[] = []
      for (const a of targets) {
        const path = resolve(cwd, a)
        const inside = workingFiles().filter((f) => f.startsWith(path + "/"))
        if (exists(path)) await removeFile(path)
        else if (inside.length && args.includes("-r")) for (const f of inside) await removeFile(f)
        else if (inside.length) lines.push(err(`rm: ${a} is a folder (use rm -r)`))
        else lines.push(err(`rm: ${a}: no such file`))
      }
      return { lines }
    }
    case "mv":
    case "cp": {
      if (args.length !== 2) return { lines: [err(`usage: ${cmd} <from> <to>`)] }
      const from = resolve(cwd, args[0])
      let to = resolve(cwd, args[1])
      const text = await readFile(from)
      if (text === undefined) return { lines: [err(`${cmd}: ${args[0]}: no such file`)] }
      if (isDir(to) && !exists(to)) to = resolve(to, from.split("/").pop())
      await writeFile(to, text)
      if (cmd === "mv") await removeFile(from)
      return { lines: [] }
    }
    case "echo": {
      const redirect = args.findIndex((a) => a === ">" || a === ">>")
      if (redirect < 0) return { lines: [out(args.join(" "))] }
      const target = args[redirect + 1]
      if (!target) return { lines: [err("echo: missing file after >")] }
      const path = resolve(cwd, target)
      const text = args.slice(0, redirect).join(" ") + "\n"
      await writeFile(path, args[redirect] === ">>" ? ((await readFile(path)) ?? "") + text : text)
      return { lines: [] }
    }
    case "grep":
    case "rg":
    case "find":
      return grep(args, cwd)
    case "git":
      return git(args)
    case "gh":
      return gh(args)
    case "npm":
    case "npx":
    case "yarn":
    case "pnpm":
    case "node":
    case "bun":
    case "deno":
    case "python":
    case "python3":
    case "pip":
    case "make":
    case "cargo":
    case "go":
    case "bash":
    case "sh":
      return {
        lines: [
          err(`${cmd}: can't run programs here.`),
          out("This terminal runs inside your browser, and a Netlify site has no computer to run programs on.", "dim"),
          out("Push your changes: Netlify builds and deploys them, and GitHub Actions can run tests.", "dim"),
          out("To try an HTML page, use: preview <file.html>", "dim"),
        ],
      }
    default:
      return { lines: [err(`${cmd}: command not found. Type help to see what's available.`)] }
  }
}

const TEXT = /\.(md|txt|js|jsx|ts|tsx|mjs|cjs|json|css|scss|html|htm|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|yml|yaml|toml|ini|sql|xml|svg|env|example|gitignore)$/i

async function grep(args: string[], cwd: string): Promise<Result> {
  const flags = args.filter((a) => a.startsWith("-"))
  const [pattern, dirArg] = args.filter((a) => !a.startsWith("-"))
  if (!pattern) return { lines: [err("usage: grep <text> [folder]")] }
  const dir = resolve(cwd, dirArg ?? ".")
  const ignoreCase = flags.some((f) => f.includes("i"))
  const needle = ignoreCase ? pattern.toLowerCase() : pattern
  const files = workingFiles()
    .filter((f) => (!dir || f.startsWith(dir + "/") || f === dir) && TEXT.test(f) && (ws.files[f] ?? 0) < 200_000)
    .slice(0, 150)
  const lines: Line[] = []
  const texts = await Promise.all(files.map((f) => readFile(f).catch(() => undefined)))
  files.forEach((f, i) => {
    texts[i]?.split("\n").forEach((l, n) => {
      if ((ignoreCase ? l.toLowerCase() : l).includes(needle) && lines.length < 200) lines.push(out(`${f}:${n + 1}: ${l.trim().slice(0, 200)}`))
    })
  })
  return { lines: lines.length ? lines : [out("No matches.", "dim")] }
}

async function git(args: string[]): Promise<Result> {
  const [sub, ...rest] = args
  const branchLine = (): Line => {
    const ahead = ws.commits.length
    if (!ws.remoteExists) return out(`On branch ${ws.branch} (not on GitHub yet: git push creates it)`, "head")
    return out(`On branch ${ws.branch}${ahead ? ` — ahead of origin/${ws.branch} by ${ahead} commit${ahead === 1 ? "" : "s"} (git push)` : ", up to date with GitHub"}`, "head")
  }
  switch (sub) {
    case undefined:
    case "help":
      return { lines: HELP.split("\n").filter((l) => /git|gh /.test(l)).map((l) => out(l)) }
    case "status": {
      const changes = changeList()
      const lines: Line[] = [branchLine()]
      if (!changes.length) lines.push(out("nothing to commit, working tree clean", "dim"))
      else {
        lines.push(out("Changes (git commit -m \"message\" to commit them all):"))
        for (const c of changes) lines.push(out(`  ${c.kind.padEnd(9)} ${c.path}`, c.kind === "deleted" ? "del" : "add"))
      }
      return { lines }
    }
    case "diff": {
      const only = rest.filter((a) => !a.startsWith("-")).map((p) => resolve(ws.cwd, p))
      const changes = changeList().filter((c) => !only.length || only.includes(c.path))
      const lines: Line[] = []
      for (const c of changes) {
        const diff = unifiedDiff(c.path, await headContent(c.path), ws.changes[c.path] ?? undefined)
        for (const l of diff.split("\n")) {
          lines.push(out(l, l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff") ? "head" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "dim" : "out"))
        }
      }
      return { lines: lines.length ? lines : [out("No changes.", "dim")] }
    }
    case "add":
    case "stage":
      return { lines: [out("All changes are staged automatically. Next: git commit -m \"message\"", "dim")] }
    case "commit": {
      const m = rest.findIndex((a) => a === "-m" || a === "-am" || a === "--message")
      const message = m >= 0 ? rest[m + 1] : undefined
      if (!message) return { lines: [err('usage: git commit -m "what you changed"')] }
      const count = changeList().length
      const result = await commit(message)
      return { lines: [out(`[${ws.branch} ${result.sha.slice(0, 7)}] ${message}`, "ok"), out(` ${count} file${count === 1 ? "" : "s"} changed. Next: git push`, "dim")] }
    }
    case "push": {
      const result = await push()
      if (result.upToDate) return { lines: [out("Everything up-to-date", "dim")] }
      return {
        lines: [
          out(`Pushed ${result.pushed} commit${result.pushed === 1 ? "" : "s"} to ${ws.target!.owner}/${ws.target!.repo} → ${ws.branch}`, "ok"),
          { text: result.branchUrl, tone: "link", href: result.branchUrl },
          ...(ws.branch !== ws.defaultBranch ? [out(`Open a pull request: gh pr create --title "..."`, "dim")] : []),
        ],
      }
    }
    case "pull":
    case "fetch": {
      const branch = ws.branch
      if (!ws.remoteExists) return { lines: [err(`${branch} isn't on GitHub yet; nothing to pull.`)] }
      const before = ws.base
      await checkout(branch)
      return { lines: [out(before === ws.base ? "Already up to date." : `Updated ${branch} to ${ws.base.slice(0, 7)}`, "ok")] }
    }
    case "checkout":
    case "switch": {
      if (rest[0] === "--" || rest[0] === ".") return restore(rest[0] === "--" ? rest.slice(1) : rest)
      const create = rest[0] === "-b" || rest[0] === "-c"
      const name = create ? rest[1] : rest[0]
      if (!name) return { lines: [err(`usage: git ${sub} ${create ? "-b " : ""}<branch>`)] }
      if (create) {
        if (!/^[\w./-]+$/.test(name) || name.includes("..")) return { lines: [err(`'${name}' isn't a valid branch name`)] }
        newBranch(name)
        return { lines: [out(`Switched to a new branch '${name}' (it's created on GitHub when you push)`, "ok")] }
      }
      if (exists(resolve(ws.cwd, name)) && !(await listBranches(ws.target!, githubToken()).catch(() => [] as string[])).includes(name)) return restore([name])
      await checkout(name)
      return { lines: [out(`Switched to branch '${name}'`, "ok")] }
    }
    case "restore":
    case "reset":
      return restore(rest.filter((a) => !a.startsWith("-")))
    case "branch": {
      const branches = await listBranches(ws.target!, githubToken())
      if (!ws.remoteExists) branches.push(ws.branch)
      return { lines: [...new Set(branches)].sort().map((b) => out(`${b === ws.branch ? "* " : "  "}${b}`, b === ws.branch ? "ok" : "out")) }
    }
    case "log": {
      const n = Number(rest.find((a) => /^-n?\d+$/.test(a))?.replace(/^-n?/, "")) || 10
      const lines: Line[] = []
      for (const c of [...ws.commits].reverse()) lines.push(out(`${c.sha.slice(0, 7)} ${c.message.split("\n")[0]}  (not pushed)`, "add"))
      if (ws.remoteExists || ws.base) {
        const remote = await listCommits(ws.target!, ws.base, githubToken(), n)
        for (const c of remote) lines.push({ text: `${c.sha.slice(0, 7)} ${c.message.split("\n")[0]}  — ${c.author}, ${new Date(c.date).toLocaleDateString()}`, tone: "out", href: c.url })
      }
      return { lines: lines.slice(0, n + ws.commits.length) }
    }
    case "remote":
      return { lines: [out(`origin  https://github.com/${ws.target!.owner}/${ws.target!.repo}.git`)] }
    default:
      return { lines: [err(`git ${sub}: not supported here. Type git help.`)] }
  }
}

function restore(paths: string[]): Result {
  if (!paths.length) return { lines: [err("usage: git restore <file> (or . for everything)")] }
  if (paths.includes(".")) {
    const count = changeList().length
    discard()
    return { lines: [out(`Undid all uncommitted changes (${count} file${count === 1 ? "" : "s"})`, "ok")] }
  }
  for (const p of paths) discard(resolve(ws.cwd, p))
  return { lines: [out(`Restored ${paths.join(", ")}`, "ok")] }
}

async function gh(args: string[]): Promise<Result> {
  if (args[0] !== "pr" || args[1] !== "create") return { lines: [err('Only "gh pr create" is supported.')] }
  const flag = (name: string) => {
    const i = args.findIndex((a) => a === `--${name}` || a === `-${name[0]}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const title = flag("title") ?? ws.commits.at(-1)?.message ?? `Changes from ${ws.branch}`
  const pr = await pullRequest(title, flag("body"))
  return { lines: [out(`Opened pull request #${pr.number}`, "ok"), { text: pr.html_url, tone: "link", href: pr.html_url }] }
}
