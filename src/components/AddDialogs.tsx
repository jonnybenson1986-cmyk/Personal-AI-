import { createMemo, createSignal, For, Show } from "solid-js"
import { type Repo, loadRepo, parseRepo, readable, repoAttachments, suggested } from "../lib/github"
import { settings, updateSettings } from "../lib/store"
import type { Attachment, RepoTarget } from "../lib/types"
import { readPage } from "../lib/web"
import { Modal } from "./Dialogs"

const MAX_TOTAL = 400_000

function kb(bytes: number) {
  return bytes < 1000 ? `${bytes} B` : `${Math.round(bytes / 1000)} KB`
}

/** Connect a GitHub repo, pick files, and add them to the next message. */
export function GitHubDialog(props: { onClose: () => void; onAdd: (files: Attachment[], repo: RepoTarget) => void }) {
  const [input, setInput] = createSignal(settings.recentRepos[0] ?? "")
  const [repo, setRepo] = createSignal<Repo>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [filter, setFilter] = createSignal("")
  const [picked, setPicked] = createSignal<Set<string>>(new Set())
  const [includeMap, setIncludeMap] = createSignal(true)

  const files = createMemo(() => repo()?.files.filter(readable) ?? [])
  const shown = createMemo(() => {
    const q = filter().trim().toLowerCase()
    return files()
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .slice(0, 400)
  })
  const total = createMemo(() => files().reduce((sum, f) => (picked().has(f.path) ? sum + f.size : sum), 0))

  async function connect(value = input()) {
    const ref = parseRepo(value)
    if (!ref) return setError("Enter a repo like owner/name or a github.com link.")
    setBusy(true)
    setError(undefined)
    try {
      const loaded = await loadRepo(ref, settings.githubToken)
      setRepo(loaded)
      setPicked(new Set(suggested(loaded.files.filter(readable))))
      const name = `${ref.owner}/${ref.repo}`
      updateSettings({ recentRepos: [name, ...settings.recentRepos.filter((r) => r !== name)].slice(0, 6) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function toggle(path: string) {
    const next = new Set(picked())
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setPicked(next)
  }

  async function add() {
    setBusy(true)
    setError(undefined)
    try {
      const r = repo()!
      props.onAdd(await repoAttachments(r, [...picked()], includeMap(), settings.githubToken), { owner: r.owner, repo: r.repo, ref: r.ref })
      props.onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add from GitHub" onClose={props.onClose}>
      <form
        class="inline"
        onSubmit={(e) => {
          e.preventDefault()
          void connect()
        }}
      >
        <input class="text-input" placeholder="owner/repo or github.com link" value={input()} onInput={(e) => setInput(e.currentTarget.value)} autofocus />
        <button class="button primary" type="submit" disabled={busy() || !input().trim()}>
          {busy() && !repo() ? "Connecting…" : "Connect"}
        </button>
      </form>
      <Show when={!repo() && settings.recentRepos.length}>
        <div class="recent">
          <span class="muted small-text">Recent:</span>
          <For each={settings.recentRepos}>
            {(r) => (
              <button
                class="chip"
                onClick={() => {
                  setInput(r)
                  void connect(r)
                }}
              >
                {r}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={error()}>
        <div class="notice error">{error()}</div>
      </Show>
      <Show when={repo()}>
        {(r) => (
          <>
            <p class="small-text muted repo-meta">
              <strong>
                {r().owner}/{r().repo}
              </strong>{" "}
              · {r().ref} · {files().length} readable files{r().private ? " · private" : ""}
              {r().truncated ? " · very large repo, not every file is listed" : ""}
            </p>
            <input class="text-input" type="search" placeholder="Filter files" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
            <div class="file-list">
              <For each={shown()}>
                {(f) => (
                  <label class="file-row">
                    <input type="checkbox" checked={picked().has(f.path)} onChange={() => toggle(f.path)} />
                    <span class="file-path">{f.path}</span>
                    <span class="muted">{kb(f.size)}</span>
                  </label>
                )}
              </For>
              <Show when={!shown().length}>
                <p class="muted small-text">No matching files.</p>
              </Show>
            </div>
            <label class="file-row map-row">
              <input type="checkbox" checked={includeMap()} onChange={(e) => setIncludeMap(e.currentTarget.checked)} />
              <span>Include the list of all files, so the AI knows the whole project</span>
            </label>
            <Show when={total() > MAX_TOTAL}>
              <div class="notice">That's a lot of code ({kb(total())}). Free models may run out of room; pick fewer files if answers fail.</div>
            </Show>
            <div class="edit-actions">
              <span class="muted small-text spacer">
                {picked().size} files · {kb(total())}
              </span>
              <button class="button primary" disabled={busy() || (!picked().size && !includeMap())} onClick={() => void add()}>
                {busy() ? "Adding…" : "Add to message"}
              </button>
            </div>
          </>
        )}
      </Show>
    </Modal>
  )
}

/** Read a web page and add its text to the next message. */
export function WebPageDialog(props: { onClose: () => void; onAdd: (files: Attachment[]) => void }) {
  const [url, setUrl] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  return (
    <Modal title="Add a web page" onClose={props.onClose}>
      <p class="muted small-text">The page's text is added to your message so the AI can read, summarize or answer questions about it.</p>
      <form
        class="inline"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(undefined)
          try {
            props.onAdd([await readPage(url())])
            props.onClose()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <input class="text-input" type="url" inputmode="url" placeholder="https://…" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} autofocus />
        <button class="button primary" type="submit" disabled={busy() || !url().trim()}>
          {busy() ? "Reading…" : "Add"}
        </button>
      </form>
      <Show when={error()}>
        <div class="notice error">{error()}</div>
      </Show>
    </Modal>
  )
}
