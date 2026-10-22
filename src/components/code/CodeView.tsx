import { createEffect, createMemo, createResource, createSignal, For, onMount, Show, untrack } from "solid-js"
import { setCanvas } from "../../lib/canvas"
import { parseFileChanges } from "../../lib/changes"
import { aiBusy, applyReply, askAI, clearChat, stopAI } from "../../lib/codeai"
import { diffStats } from "../../lib/diff"
import { branchName, parseRepo } from "../../lib/github"
import { renderMarkdown } from "../../lib/markdown"
import { settings, updateSettings } from "../../lib/store"
import { type Line, run } from "../../lib/terminal"
import {
  changeList,
  commit,
  headContent,
  newBranch,
  openRepo,
  pullRequest,
  push,
  readFile,
  restoreWorkspace,
  update,
  useToken,
  workingFiles,
  writeFile,
  ws,
} from "../../lib/workspace"
import { IconBot, IconFile, IconFolder, IconGitHub, IconMenu, IconSend, IconStop, IconX } from "../icons"
import { Editor } from "./Editor"

type Tab = "files" | "editor" | "ai" | "terminal"

useToken(() => settings.githubToken)

/** Folders and files as a tree, folders first. */
interface Node {
  name: string
  path: string
  children?: Node[]
}

function buildTree(paths: string[]): Node[] {
  const root: Node = { name: "", path: "", children: [] }
  for (const path of paths) {
    let node = root
    const parts = path.split("/")
    parts.forEach((part, i) => {
      const at = parts.slice(0, i + 1).join("/")
      if (i === parts.length - 1) node.children!.push({ name: part, path: at })
      else {
        let next = node.children!.find((c) => c.children && c.name === part)
        if (!next) node.children!.push((next = { name: part, path: at, children: [] }))
        node = next
      }
    })
  }
  const sort = (n: Node) => {
    n.children?.sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name) : b.children ? 1 : -1))
    n.children?.forEach(sort)
  }
  sort(root)
  return root.children!
}

function Connect() {
  const [input, setInput] = createSignal(settings.recentRepos[0] ?? "")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  async function open(value = input()) {
    const ref = parseRepo(value)
    if (!ref) return setError("Enter a repo like owner/name or a github.com link.")
    setBusy(true)
    setError(undefined)
    try {
      await openRepo(ref, ref.ref)
      const name = `${ref.owner}/${ref.repo}`
      updateSettings({ recentRepos: [name, ...settings.recentRepos.filter((r) => r !== name)].slice(0, 6) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="code-connect">
      <IconGitHub />
      <h1>Open a GitHub repo</h1>
      <p class="muted">Browse and edit its code, ask the AI to make changes, then commit and push from the terminal or with one tap.</p>
      <form
        class="inline"
        onSubmit={(e) => {
          e.preventDefault()
          void open()
        }}
      >
        <input class="text-input" placeholder="owner/repo or github.com link" value={input()} onInput={(e) => setInput(e.currentTarget.value)} />
        <button class="button primary" type="submit" disabled={busy() || !input().trim()}>
          {busy() ? "Opening…" : "Open"}
        </button>
      </form>
      <Show when={settings.recentRepos.length}>
        <div class="recent">
          <For each={settings.recentRepos}>
            {(r) => (
              <button class="chip" onClick={() => void open(r)}>
                {r}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={error()}>
        <div class="notice error">{error()}</div>
      </Show>
      <Show when={!settings.githubToken}>
        <p class="muted small-text">Public repos open without a token. To commit and push, add a GitHub token with write access in Settings.</p>
      </Show>
    </div>
  )
}

function FileTree(props: { onOpen: (path: string) => void }) {
  const [filter, setFilter] = createSignal("")
  // Folders start closed; the ones around the open file open themselves.
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  createEffect(() => {
    const parts = ws.open?.split("/") ?? []
    if (parts.length < 2) return
    const next = new Set(untrack(expanded))
    for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"))
    setExpanded(next)
  })
  const kinds = createMemo(() => Object.fromEntries(changeList().map((c) => [c.path, c.kind])))
  const deleted = createMemo(() => changeList().filter((c) => c.kind === "deleted").map((c) => c.path))
  const tree = createMemo(() => {
    const q = filter().trim().toLowerCase()
    const paths = [...workingFiles(), ...deleted()].filter((p) => !q || p.toLowerCase().includes(q))
    return buildTree(paths.sort())
  })
  const toggle = (path: string) => {
    const next = new Set(expanded())
    next.has(path) ? next.delete(path) : next.add(path)
    setExpanded(next)
  }
  const isOpen = (path: string) => expanded().has(path) || !!filter().trim()
  const render = (nodes: Node[], depth: number) => (
    <For each={nodes}>
      {(n) =>
        n.children ? (
          <>
            <button class="tree-row folder" style={{ "padding-left": `${8 + depth * 14}px` }} onClick={() => toggle(n.path)}>
              <span class="caret">{isOpen(n.path) ? "▾" : "▸"}</span>
              <IconFolder />
              {n.name}
            </button>
            <Show when={isOpen(n.path)}>{render(n.children, depth + 1)}</Show>
          </>
        ) : (
          <button
            class={`tree-row file ${ws.open === n.path ? "active" : ""} ${kinds()[n.path] ?? ""}`}
            style={{ "padding-left": `${22 + depth * 14}px` }}
            onClick={() => kinds()[n.path] !== "deleted" && props.onOpen(n.path)}
          >
            <IconFile />
            <span class="tree-name">{n.name}</span>
            <Show when={kinds()[n.path]}>{(k) => <span class={`tree-badge ${k()}`}>{k()[0].toUpperCase()}</span>}</Show>
          </button>
        )
      }
    </For>
  )
  return (
    <div class="code-files">
      <input class="text-input tree-filter" type="search" placeholder="Find a file" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      <div class="tree">{render(tree(), 0)}</div>
      <Show when={ws.truncated}>
        <p class="muted small-text">Very large repo: not every file is listed.</p>
      </Show>
    </div>
  )
}

function EditorPane() {
  // The committed version loads once per commit; edits come straight from the working copy.
  const [original] = createResource(
    () => (ws.open ? `${ws.head}|${ws.open}` : undefined),
    async (key) => (await headContent(key.slice(key.indexOf("|") + 1))) ?? null,
  )
  const text = () => {
    if (!ws.open) return undefined
    if (ws.open in ws.changes) return ws.changes[ws.open] ?? ""
    const o = original()
    return original.loading || o === undefined ? undefined : (o ?? "")
  }
  const stats = createMemo(() => (ws.open && ws.open in ws.changes && !original.loading ? diffStats(original() ?? undefined, ws.changes[ws.open] ?? undefined) : undefined))
  return (
    <div class="code-editor">
      <Show when={ws.open} fallback={<div class="code-empty muted">Open a file from Files, or ask the AI to write one.</div>}>
        {(path) => (
          <>
            <div class="editor-bar">
              <span class="file-path">{path()}</span>
              <Show when={stats()}>
                {(s) => (
                  <span class="small-text">
                    <span class="plus">+{s().added}</span> <span class="minus">−{s().removed}</span>
                  </span>
                )}
              </Show>
              <Show when={/\.(html?|svg)$/i.test(path())}>
                <button class="code-action" data-action="preview" onClick={() => setCanvas({ title: path(), lang: path().split(".").pop()!, code: text() ?? "" })}>
                  Preview
                </button>
              </Show>
              <Show when={path() in ws.changes}>
                <button class="code-action" onClick={() => update((s) => void delete s.changes[path()])}>
                  Undo changes
                </button>
              </Show>
            </div>
            <Show when={text() !== undefined} fallback={<div class="code-empty muted">Loading…</div>}>
              <Editor path={path()} text={text()!} onChange={(t) => void writeFile(path(), t)} />
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function AiPane(props: { onShowFile: () => void }) {
  const [input, setInput] = createSignal("")
  let list!: HTMLDivElement
  createEffect(() => {
    ws.chat.map((t) => t.reply.length)
    queueMicrotask(() => list && (list.scrollTop = list.scrollHeight))
  })
  const send = () => {
    const text = input().trim()
    if (!text || aiBusy()) return
    setInput("")
    void askAI(text)
  }
  return (
    <div class="code-ai">
      <div class="code-ai-list" ref={list}>
        <Show when={ws.chat.length && !aiBusy()}>
          <button class="code-action clear-chat" onClick={clearChat}>
            Clear AI chat
          </button>
        </Show>
        <Show when={!ws.chat.length}>
          <div class="code-empty muted">
            Ask for a change, like "add a dark mode toggle" or "fix the bug in src/app.js". The AI sees the file list, the open file, your edits and any file you name.
          </div>
        </Show>
        <For each={ws.chat}>
          {(t) => {
            const files = createMemo(() => (t.status === "done" ? parseFileChanges(t.reply) : []))
            return (
              <div class="code-turn">
                <div class="bubble">{t.text}</div>
                <div class="markdown" innerHTML={renderMarkdown(t.reply || (t.status === "streaming" ? "…" : ""))} />
                <Show when={t.error}>
                  <div class={t.status === "error" ? "notice error" : "notice"}>{t.error}</div>
                </Show>
                <Show when={files().length}>
                  <div class="apply-row">
                    <Show
                      when={!t.applied}
                      fallback={
                        <span class="small-text muted">
                          Applied {files().length} file{files().length === 1 ? "" : "s"}. Review, then commit & push.
                        </span>
                      }
                    >
                      <button
                        class="button primary small-button"
                        onClick={async () => {
                          await applyReply(t.id)
                          props.onShowFile()
                        }}
                      >
                        Apply {files().length} file{files().length === 1 ? "" : "s"}
                      </button>
                      <span class="small-text muted">{files().map((f) => f.path).join(", ")}</span>
                    </Show>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
      <form
        class="code-ai-input"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          rows={2}
          placeholder="Ask the AI to change the code…"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) {
              e.preventDefault()
              send()
            }
          }}
        />
        <Show
          when={aiBusy()}
          fallback={
            <button class="send" type="submit" aria-label="Ask the AI" disabled={!input().trim()}>
              <IconSend />
            </button>
          }
        >
          <button class="send" type="button" aria-label="Stop" onClick={stopAI}>
            <IconStop />
          </button>
        </Show>
      </form>
    </div>
  )
}

const WELCOME: Line[] = [
  { text: "Jonny's AI terminal. Type help for commands.", tone: "dim" },
  { text: 'Try: git status · ls · cat README.md · ai "add a footer" · git commit -m "..." · git push', tone: "dim" },
]

function TerminalPane(props: { onOpen: (path: string) => void; onAi: (prompt: string) => void }) {
  const [lines, setLines] = createSignal<(Line & { cmd?: boolean })[]>(WELCOME)
  const [input, setInput] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const history: string[] = []
  let cursor = 0
  let screen!: HTMLDivElement
  let field!: HTMLInputElement
  const prompt = () => `${ws.target?.repo ?? "~"}${ws.cwd ? "/" + ws.cwd : ""} (${ws.branch || "-"})$`
  createEffect(() => {
    lines()
    queueMicrotask(() => (screen.scrollTop = screen.scrollHeight))
  })
  async function exec(line: string) {
    history.push(line)
    cursor = history.length
    setLines((l) => [...l, { text: `${prompt()} ${line}`, cmd: true }])
    setBusy(true)
    const result = await run(line)
    setBusy(false)
    if (result.clear) return setLines([])
    setLines((l) => [...l, ...result.lines])
    if (result.open) props.onOpen(result.open)
    if (result.ai) props.onAi(result.ai)
    if (result.preview) setCanvas({ title: result.preview, lang: result.preview.split(".").pop()!, code: (await readFile(result.preview)) ?? "" })
  }
  return (
    <div class="code-terminal" onClick={() => !getSelection()?.toString() && field.focus()}>
      <div class="term-screen" ref={screen}>
        <For each={lines()}>
          {(l) => (
            <div class={`term-line ${l.cmd ? "cmd" : l.tone ?? "out"}`}>
              <Show when={l.href} fallback={l.text}>
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.text}
                </a>
              </Show>
            </div>
          )}
        </For>
      </div>
      <form
        class="term-input"
        onSubmit={(e) => {
          e.preventDefault()
          const line = input()
          setInput("")
          if (line.trim()) void exec(line)
        }}
      >
        <span class="term-prompt">{busy() ? "…" : prompt()}</span>
        <input
          ref={field}
          value={input()}
          disabled={busy()}
          autocapitalize="off"
          autocomplete="off"
          spellcheck={false}
          enterkeyhint="send"
          aria-label="Terminal command"
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && cursor > 0) {
              e.preventDefault()
              setInput(history[--cursor])
            }
            if (e.key === "ArrowDown") {
              e.preventDefault()
              cursor = Math.min(history.length, cursor + 1)
              setInput(history[cursor] ?? "")
            }
          }}
        />
      </form>
    </div>
  )
}

/** One-tap commit and push, for when typing git commands on a phone is a chore. */
function CommitSheet(props: { onClose: () => void }) {
  const changes = createMemo(changeList)
  const onDefault = () => ws.branch === ws.defaultBranch
  const [message, setMessage] = createSignal(ws.chat.at(-1)?.applied ? ws.chat.at(-1)!.text.slice(0, 72) : "")
  const [mode, setMode] = createSignal<"branch" | "current">(onDefault() ? "branch" : "current")
  const [branch, setBranch] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [done, setDone] = createSignal<{ url: string; pr?: string }>()
  const [stats] = createResource(changes, async (list) =>
    Object.fromEntries(await Promise.all(list.map(async (c) => [c.path, diffStats(await headContent(c.path), ws.changes[c.path] ?? undefined)] as const))),
  )
  createEffect(() => setBranch(branchName(message() || "changes")))

  async function go() {
    setBusy(true)
    setError(undefined)
    try {
      if (mode() === "branch") newBranch(branch().trim())
      if (changes().length) await commit(message().trim())
      const result = await push()
      let pr: string | undefined
      if (mode() === "branch") pr = (await pullRequest(message().trim())).html_url
      setDone({ url: result.upToDate ? `https://github.com/${ws.target!.owner}/${ws.target!.repo}/tree/${ws.branch}` : result.branchUrl, pr })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="modal-scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Commit and push">
        <div class="modal-head">
          <h2>Commit & push</h2>
          <button class="icon-button" aria-label="Close" onClick={props.onClose}>
            <IconX />
          </button>
        </div>
        <Show
          when={!done()}
          fallback={
            <div class="push-done-sheet">
              <p>
                Pushed to <strong>{ws.branch}</strong>.
              </p>
              <Show when={done()!.pr}>
                <a class="button primary" href={done()!.pr} target="_blank" rel="noopener noreferrer">
                  Open pull request
                </a>
              </Show>
              <a class="button ghost" href={done()!.url} target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </div>
          }
        >
          <Show when={!settings.githubToken}>
            <div class="notice">Add a GitHub token with write access in Settings first (Contents and Pull requests: Read and write).</div>
          </Show>
          <Show when={changes().length} fallback={<p class="muted">{ws.commits.length ? `${ws.commits.length} commit(s) ready to push.` : "No changes yet."}</p>}>
            <div class="push-files">
              <For each={changes()}>
                {(c) => (
                  <div class="file-row">
                    <span class={`tree-badge ${c.kind}`}>{c.kind[0].toUpperCase()}</span>
                    <span class="file-path">{c.path}</span>
                    <Show when={stats()?.[c.path]}>
                      {(s) => (
                        <span class="small-text">
                          <span class="plus">+{s().added}</span> <span class="minus">−{s().removed}</span>
                        </span>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <label class="push-field">
              <span>Commit message</span>
              <input class="text-input" placeholder="What did you change?" value={message()} onInput={(e) => setMessage(e.currentTarget.value)} />
            </label>
          </Show>
          <div class="push-mode">
            <label>
              <input type="radio" name="commit-mode" checked={mode() === "branch"} onChange={() => setMode("branch")} />
              <span>
                New branch + pull request <small class="muted">(safest)</small>
              </span>
            </label>
            <Show when={mode() === "branch"}>
              <input class="text-input branch-input" value={branch()} onInput={(e) => setBranch(e.currentTarget.value)} />
            </Show>
            <label>
              <input type="radio" name="commit-mode" checked={mode() === "current"} onChange={() => setMode("current")} />
              <span>
                Push to <strong>{ws.branch}</strong>
                <Show when={onDefault()}>
                  {" "}
                  <small class="muted">(goes live on Netlify if this is your site's repo)</small>
                </Show>
              </span>
            </label>
          </div>
          <Show when={error()}>
            <div class="notice error">{error()}</div>
          </Show>
          <div class="edit-actions">
            <button class="button ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button
              class="button primary"
              disabled={busy() || !settings.githubToken || (!changes().length && !ws.commits.length && ws.remoteExists) || (!!changes().length && !message().trim())}
              onClick={() => void go()}
            >
              {busy() ? "Pushing…" : "Commit & push"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default function CodeView(props: { onMenu: () => void }) {
  const [tab, setTab] = createSignal<Tab>("files")
  const [terminal, setTerminal] = createSignal(true)
  const [sheet, setSheet] = createSignal(false)
  const [restored, setRestored] = createSignal(false)
  onMount(() => void restoreWorkspace().finally(() => setRestored(true)))
  const pending = () => changeList().length + ws.commits.length

  const open = (path: string) => {
    update((s) => {
      s.open = path
    })
    setTab("editor")
  }

  return (
    <div class="code-view">
      <header class="topbar code-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <Show when={ws.target} fallback={<strong class="code-title">Code</strong>}>
          {(t) => (
            <div class="code-repo">
              <IconGitHub />
              <span class="code-repo-name">
                <span class="owner">{t().owner}/</span>
                <strong>{t().repo}</strong>
              </span>
              <span class="branch-chip" title="Current branch">
                {ws.branch}
              </span>
            </div>
          )}
        </Show>
        <span class="spacer" />
        <Show when={ws.target}>
          <button class="button primary small-button push-button" onClick={() => setSheet(true)}>
            <span class="long">Commit &amp;</span> push{pending() ? ` (${pending()})` : ""}
          </button>
          <button
            class="icon-button"
            title="Open another repo"
            aria-label="Open another repo"
            onClick={() =>
              (!pending() || confirm("You have changes that aren't pushed. Open another repo anyway? They'll be lost.")) &&
              update((s) => {
                s.target = undefined
              })
            }
          >
            <IconX />
          </button>
        </Show>
      </header>
      <Show when={restored()}>
        <Show when={ws.target} fallback={<Connect />}>
          <div class={`code-body tab-${tab()} ${terminal() ? "with-terminal" : ""}`}>
            <FileTree onOpen={open} />
            <EditorPane />
            <AiPane onShowFile={() => setTab("editor")} />
            <Show when={terminal() || tab() === "terminal"}>
              <TerminalPane
                onOpen={open}
                onAi={(prompt) => {
                  setTab("ai")
                  void askAI(prompt)
                }}
              />
            </Show>
          </div>
          <nav class="code-tabs">
            <button class={tab() === "files" ? "on" : ""} onClick={() => setTab("files")}>
              <IconFolder />
              Files
            </button>
            <button class={tab() === "editor" ? "on" : ""} onClick={() => setTab("editor")}>
              <IconFile />
              Editor
            </button>
            <button class={tab() === "ai" ? "on" : ""} onClick={() => setTab("ai")}>
              <IconBot />
              AI{aiBusy() ? "…" : ""}
            </button>
            <button class={tab() === "terminal" ? "on" : ""} onClick={() => setTab("terminal")}>
              <span class="term-glyph">&gt;_</span>
              Terminal
            </button>
          </nav>
          <button class="code-action terminal-toggle" onClick={() => setTerminal(!terminal())}>
            {terminal() ? "Hide terminal" : "Show terminal"}
          </button>
        </Show>
      </Show>
      <Show when={sheet()}>
        <CommitSheet onClose={() => setSheet(false)} />
      </Show>
    </div>
  )
}
