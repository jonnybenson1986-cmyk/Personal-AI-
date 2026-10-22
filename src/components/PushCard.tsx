import { createMemo, createSignal, For, Show } from "solid-js"
import { type FileChange, lineStats, parseFileChanges } from "../lib/changes"
import { branchName, currentFile, defaultBranch, parseRepo, pushFiles } from "../lib/github"
import { markPushed, settings, updateSettings } from "../lib/store"
import type { Reply, RepoTarget } from "../lib/types"
import { IconGitHub } from "./icons"

/** The summary line the AI was asked to write after its files, for the commit message. */
function suggestedMessage(text: string, files: FileChange[]) {
  const after = text.slice(text.lastIndexOf("```") + 3)
  const line = after
    .split("\n")
    .map((l) => l.replace(/^[\s>*_#-]*(commit message|summary)?\s*:?\s*/i, "").replace(/[*_`]+/g, "").trim())
    .find((l) => l.length > 3)
  if (line) return line.length > 72 ? line.slice(0, 71).trimEnd() + "…" : line
  return files.length === 1 ? `Update ${files[0].path}` : `Update ${files.length} files`
}

interface Status {
  base: string
  stats: Record<string, { isNew: boolean; added: number; removed: number }>
}

/** Under a reply that contains complete files: review them and push to GitHub in one commit. */
export function PushCard(props: { reply: Reply; repo?: RepoTarget; convId: string }) {
  const files = createMemo(() => parseFileChanges(props.reply.text))
  const [open, setOpen] = createSignal(false)
  const [repoInput, setRepoInput] = createSignal(props.repo ? `${props.repo.owner}/${props.repo.repo}` : (settings.recentRepos[0] ?? ""))
  const [message, setMessage] = createSignal("")
  const [mode, setMode] = createSignal<"pr" | "direct">("pr")
  const [branch, setBranch] = createSignal("")
  const [skip, setSkip] = createSignal<Set<string>>(new Set())
  const [viewing, setViewing] = createSignal<string>()
  const [status, setStatus] = createSignal<Status>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const target = (): RepoTarget | undefined => {
    const ref = parseRepo(repoInput())
    if (!ref) return undefined
    const same = props.repo && ref.owner === props.repo.owner && ref.repo === props.repo.repo
    return { owner: ref.owner, repo: ref.repo, ref: ref.ref ?? (same ? props.repo!.ref : undefined) }
  }
  const chosen = () => files().filter((f) => !skip().has(f.path))

  async function review() {
    setOpen(true)
    if (!message()) setMessage(suggestedMessage(props.reply.text, files()))
    if (!branch()) setBranch(branchName(message()))
    const t = target()
    if (!t) return setError("Enter the repo to push to, like owner/name.")
    setBusy(true)
    setError(undefined)
    try {
      const base = t.ref ?? (await defaultBranch(t, settings.githubToken))
      const current = await Promise.all(files().map((f) => currentFile(t, f.path, base, settings.githubToken)))
      const stats: Status["stats"] = {}
      files().forEach((f, i) => (stats[f.path] = { isNew: current[i] === undefined, ...lineStats(current[i], f.content) }))
      setStatus({ base, stats })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function push() {
    const t = target()!
    const base = status()!.base
    setBusy(true)
    setError(undefined)
    try {
      const to = mode() === "direct" ? base : branch().trim()
      const result = await pushFiles({
        target: t,
        files: chosen(),
        branch: to,
        base,
        message: message().trim(),
        pullRequest: mode() === "pr",
        token: settings.githubToken,
      })
      await markPushed(props.convId, props.reply.id, { ...result, branch: to })
      const name = `${t.owner}/${t.repo}`
      updateSettings({ recentRepos: [name, ...settings.recentRepos.filter((r) => r !== name)].slice(0, 6) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={files().length && props.reply.status === "done"}>
      <div class="push-card">
        <Show
          when={!props.reply.pushed}
          fallback={
            <div class="push-done">
              <IconGitHub />
              <span>
                Pushed to <strong>{props.reply.pushed!.branch}</strong>.{" "}
                <Show when={props.reply.pushed!.pullRequestUrl}>
                  <a href={props.reply.pushed!.pullRequestUrl} target="_blank" rel="noopener noreferrer">
                    Open pull request
                  </a>
                  {" · "}
                </Show>
                <a href={props.reply.pushed!.commitUrl} target="_blank" rel="noopener noreferrer">
                  View commit
                </a>
              </span>
            </div>
          }
        >
          <div class="push-head">
            <IconGitHub />
            <span class="spacer">
              <strong>
                {files().length} file{files().length === 1 ? "" : "s"}
              </strong>{" "}
              ready to push to GitHub
            </span>
            <Show when={!open()}>
              <button class="button primary small-button" onClick={() => void review()}>
                Review & push
              </button>
            </Show>
          </div>
          <Show when={open()}>
            <Show when={!settings.githubToken}>
              <div class="notice">
                Pushing needs a GitHub token with write access. Add one in Settings → GitHub token (Contents and Pull requests: Read and write).
              </div>
            </Show>
            <label class="push-field">
              <span>Repo</span>
              <input class="text-input" value={repoInput()} placeholder="owner/repo" onChange={(e) => {
                setRepoInput(e.currentTarget.value)
                setStatus(undefined)
              }} />
            </label>
            <div class="push-files">
              <For each={files()}>
                {(f) => {
                  const stat = () => status()?.stats[f.path]
                  return (
                    <div>
                      <label class="file-row">
                        <input
                          type="checkbox"
                          checked={!skip().has(f.path)}
                          onChange={() => {
                            const next = new Set(skip())
                            if (next.has(f.path)) next.delete(f.path)
                            else next.add(f.path)
                            setSkip(next)
                          }}
                        />
                        <span class="file-path">{f.path}</span>
                        <Show when={stat()} fallback={<span class="muted small-text">{busy() ? "…" : ""}</span>}>
                          {(s) => (
                            <span class="small-text">
                              <Show when={s().isNew} fallback={<span class="muted">changed </span>}>
                                <span class="badge-new">new </span>
                              </Show>
                              <span class="plus">+{s().added}</span> <span class="minus">−{s().removed}</span>
                            </span>
                          )}
                        </Show>
                        <button class="code-action" onClick={(e) => {
                          e.preventDefault()
                          setViewing(viewing() === f.path ? undefined : f.path)
                        }}>
                          {viewing() === f.path ? "Hide" : "View"}
                        </button>
                      </label>
                      <Show when={viewing() === f.path}>
                        <pre class="push-preview">{f.content}</pre>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
            <label class="push-field">
              <span>Commit message</span>
              <input class="text-input" value={message()} onInput={(e) => setMessage(e.currentTarget.value)} />
            </label>
            <div class="push-mode">
              <label>
                <input type="radio" name={`mode-${props.reply.id}`} checked={mode() === "pr"} onChange={() => setMode("pr")} />
                <span>
                  New branch + pull request <small class="muted">(safest: review on GitHub, then merge)</small>
                </span>
              </label>
              <Show when={mode() === "pr"}>
                <input class="text-input branch-input" value={branch()} onInput={(e) => setBranch(e.currentTarget.value)} />
              </Show>
              <label>
                <input type="radio" name={`mode-${props.reply.id}`} checked={mode() === "direct"} onChange={() => setMode("direct")} />
                <span>
                  Push straight to <strong>{status()?.base ?? "the main branch"}</strong>{" "}
                  <small class="muted">(goes live on Netlify if this is your site's repo)</small>
                </span>
              </label>
            </div>
            <Show when={error()}>
              <div class="notice error">{error()}</div>
            </Show>
            <div class="edit-actions">
              <button class="button ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <Show
                when={status()}
                fallback={
                  <button class="button primary" disabled={busy()} onClick={() => void review()}>
                    {busy() ? "Checking…" : "Check repo"}
                  </button>
                }
              >
                <button
                  class="button primary"
                  disabled={busy() || !settings.githubToken || !chosen().length || !message().trim() || (mode() === "pr" && !branch().trim())}
                  onClick={() => void push()}
                >
                  {busy() ? "Pushing…" : `Push ${chosen().length} file${chosen().length === 1 ? "" : "s"}`}
                </button>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  )
}
