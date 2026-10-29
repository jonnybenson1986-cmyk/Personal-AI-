import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { download } from "../../lib/canvas"
import { parseFileChanges } from "../../lib/changes"
import { formatSize, isTextKind, parseCsv, QUICK_ASKS } from "../../lib/cowork"
import {
  addFiles,
  aiBusy,
  applyReply,
  askAI,
  canOpenFolder,
  clearAll,
  clearChat,
  cw,
  type CoworkFile,
  fileBlob,
  findFile,
  openFolder,
  removeFile,
  renameFile,
  restoreCowork,
  revert,
  saveToFolder,
  stopAI,
  togglePicked,
  update,
  writeText,
  zipAll,
} from "../../lib/coworkspace"
import { renderMarkdown } from "../../lib/markdown"
import { IconDownload, IconFile, IconFolder, IconMenu, IconPeople, IconPlus, IconSend, IconStop, IconTrash } from "../icons"

type Pane = "files" | "file" | "ai"

export default function CoworkView(props: { onMenu: () => void }) {
  const [pane, setPane] = createSignal<Pane>("files")
  const [notice, setNotice] = createSignal<{ text: string; error?: boolean }>()
  const [dragging, setDragging] = createSignal(false)
  const [busy, setBusy] = createSignal("")
  let picker!: HTMLInputElement

  onMount(() => void restoreCowork())

  const changedCount = () => cw.files.filter((f) => f.changed).length
  const report = (errors: string[], ok?: string) => setNotice(errors.length ? { text: errors.join(" "), error: true } : ok ? { text: ok } : undefined)

  const add = async (files: FileList | File[] | null | undefined) => {
    if (!files?.length) return
    setBusy("Reading files…")
    const before = cw.files.length
    const errors = await addFiles([...files])
    setBusy("")
    const added = cw.files.length - before
    report(errors, added ? `Added ${added} file${added === 1 ? "" : "s"}.` : undefined)
  }

  const open = (path: string) => {
    update((s) => {
      s.open = path
    })
    setPane("file")
  }

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    setNotice()
    try {
      const ok = await fn()
      if (ok) setNotice({ text: ok })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setNotice({ text: e instanceof Error ? e.message : String(e), error: true })
    } finally {
      setBusy("")
    }
  }

  return (
    <div
      class="tool-view cowork-view"
      classList={{ dragging: dragging() }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void add(e.dataTransfer?.files)
      }}
    >
      <header class="topbar tool-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <strong class="tool-title">Cowork</strong>
        <Show when={cw.folder}>
          <span class="folder-chip" title="Connected folder">
            <IconFolder /> {cw.folder}
          </span>
        </Show>
        <span class="spacer" />
        <input ref={picker} type="file" multiple hidden onChange={(e) => void add(e.currentTarget.files).then(() => (picker.value = ""))} />
        <button class="button small-button" onClick={() => picker.click()}>
          <IconPlus /> <span class="btn-label">Add files</span>
        </button>
        <Show when={canOpenFolder()}>
          <button class="button small-button" title="Work on a folder on this computer" onClick={() => run("Opening folder…", async () => void report(await openFolder(), `Opened ${cw.folder} (${cw.files.length} files).`))}>
            <IconFolder /> <span class="btn-label">Open folder</span>
          </button>
        </Show>
        <Show when={cw.folder && changedCount()}>
          <button class="button primary small-button" onClick={() => run("Saving…", async () => `Saved ${await saveToFolder()} file(s) to ${cw.folder}.`)}>
            Save {changedCount()} to folder
          </button>
        </Show>
        <Show when={cw.files.length}>
          <button
            class="icon-button"
            title="Download all as a zip"
            aria-label="Download all as a zip"
            onClick={() => run("Zipping…", async () => download(`${cw.folder || "cowork"}.zip`, await zipAll()))}
          >
            <IconDownload />
          </button>
          <button
            class="icon-button"
            title="Remove all files and the AI chat"
            aria-label="Remove all files"
            onClick={() => confirm("Remove all files and the AI chat from Cowork? Files in a connected folder stay on your computer.") && void clearAll()}
          >
            <IconTrash />
          </button>
        </Show>
      </header>

      <div class="pane-tabs" role="tablist">
        <For each={[["files", `Files (${cw.files.length})`], ["file", "Open file"], ["ai", aiBusy() ? "AI…" : "AI"]] as [Pane, string][]}>
          {([id, label]) => (
            <button role="tab" classList={{ on: pane() === id }} aria-selected={pane() === id} onClick={() => setPane(id)}>
              {label}
            </button>
          )}
        </For>
      </div>

      <Show when={busy() || notice()}>
        <div class={`cw-notice notice ${notice()?.error && !busy() ? "error" : ""}`}>
          <span>{busy() || notice()?.text}</span>
          <Show when={!busy()}>
            <button class="link-button" onClick={() => setNotice()}>
              Dismiss
            </button>
          </Show>
        </div>
      </Show>

      <div class="cowork" data-pane={pane()}>
        <aside class="cw-files">
          <Show
            when={cw.files.length}
            fallback={
              <div class="cw-empty">
                <IconPeople />
                <h3>Work on files with the AI</h3>
                <p class="muted">Add documents, spreadsheets, PDFs, Word files, images or code. The AI reads them, answers questions and writes new or improved files.</p>
                <button class="button primary" onClick={() => picker.click()}>
                  <IconPlus /> Add files
                </button>
                <p class="muted small-text">Or drop files here{canOpenFolder() ? ", or open a whole folder on this computer" : ""}. Files stay in this browser.</p>
              </div>
            }
          >
            <div class="cw-list-head small-text muted">
              <span>{cw.picked.length ? `${cw.picked.length} picked for the AI` : "Tick files to focus the AI on them"}</span>
              <button
                class="link-button"
                onClick={() => {
                  const name = prompt("Name for the new file", "notes.md")?.trim()
                  if (!name) return
                  const path = name.includes(".") ? name : `${name}.md`
                  if (findFile(path)) return setNotice({ text: `${path} already exists.`, error: true })
                  writeText(path, "")
                  open(path)
                }}
              >
                New file
              </button>
            </div>
            <ul class="cw-list">
              <For each={cw.files}>
                {(f) => (
                  <li classList={{ on: cw.open === f.path }}>
                    <input type="checkbox" aria-label={`Pick ${f.path} for the AI`} checked={cw.picked.includes(f.path)} onChange={() => togglePicked(f.path)} />
                    <button class="cw-name" onClick={() => open(f.path)} title={f.path}>
                      <IconFile />
                      <span class="cw-path">{f.path}</span>
                      <Show when={f.changed}>
                        <span class="cw-dot" title={f.created ? "New" : "Changed"} />
                      </Show>
                    </button>
                    <span class="cw-size small-text muted">{formatSize(f.size)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        <section class="cw-preview">
          <Show when={findFile(cw.open ?? "")} fallback={<div class="cw-empty muted">Pick a file to see it here.</div>} keyed>
            {(f) => <FileView file={f} onError={(text) => setNotice({ text, error: true })} />}
          </Show>
        </section>

        <AIPanel onOpen={open} />
      </div>
    </div>
  )
}

function FileView(props: { file: CoworkFile; onError: (text: string) => void }) {
  const f = () => props.file
  const [editing, setEditing] = createSignal(false)
  const [asText, setAsText] = createSignal(false)
  const url = createMemo(() => {
    const blob = f().blob
    if (!blob) return undefined
    const u = URL.createObjectURL(blob)
    onCleanup(() => URL.revokeObjectURL(u))
    return u
  })
  const rows = createMemo(() => (f().kind === "csv" && !asText() ? parseCsv(f().text ?? "") : []))
  const editable = () => isTextKind(f().kind) || (!f().blob && f().text !== undefined)

  return (
    <div class="cw-file">
      <div class="cw-file-head">
        <input
          class="name-input"
          value={f().path}
          aria-label="File name"
          onChange={(e) => {
            if (!renameFile(f().path, e.currentTarget.value)) {
              e.currentTarget.value = f().path
              props.onError("That name is taken or not allowed.")
            }
          }}
        />
        <span class="spacer" />
        <Show when={f().kind === "csv"}>
          <button class="small-button button" onClick={() => setAsText(!asText())}>
            {asText() ? "Table" : "Text"}
          </button>
        </Show>
        <Show when={editable()}>
          <button class="small-button button" classList={{ primary: editing() }} onClick={() => setEditing(!editing())}>
            {editing() ? "Done" : "Edit"}
          </button>
        </Show>
        <Show when={f().original !== undefined}>
          <button class="small-button button" title="Back to the version you added" onClick={() => revert(f().path)}>
            Revert
          </button>
        </Show>
        <button class="icon-button" title="Download" aria-label="Download" onClick={() => download(f().path.split("/").pop()!, fileBlob(f()))}>
          <IconDownload />
        </button>
        <button class="icon-button" title="Remove from Cowork" aria-label="Remove from Cowork" onClick={() => removeFile(f().path)}>
          <IconTrash />
        </button>
      </div>
      <div class="cw-file-body">
        <Switch fallback={<pre class="cw-text">{f().text}</pre>}>
          <Match when={editing() && editable()}>
            <textarea class="cw-editor" spellcheck={f().kind === "markdown" || f().kind === "text"} value={f().text ?? ""} onInput={(e) => writeText(f().path, e.currentTarget.value)} />
          </Match>
          <Match when={f().kind === "markdown"}>
            <div class="markdown cw-markdown" innerHTML={renderMarkdown(f().text || "*Empty file. Tap Edit to write.*")} />
          </Match>
          <Match when={f().kind === "csv" && !asText()}>
            <div class="cw-table-wrap">
              <table class="cw-table">
                <thead>
                  <tr>
                    <For each={rows()[0] ?? []}>{(c) => <th>{c}</th>}</For>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows().slice(1, 500)}>
                    {(r) => (
                      <tr>
                        <For each={r}>{(c) => <td>{c}</td>}</For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              <Show when={rows().length > 500}>
                <p class="small-text muted">Showing 499 of {rows().length - 1} rows.</p>
              </Show>
            </div>
          </Match>
          <Match when={f().kind === "image" && url()}>
            <img class="cw-image" src={url()} alt={f().path} />
          </Match>
          <Match when={f().kind === "pdf" || f().kind === "docx"}>
            <div class="cw-doc">
              <Show when={url() && f().kind === "pdf"}>
                <a class="button small-button" href={url()} target="_blank" rel="noopener">
                  Open PDF
                </a>
              </Show>
              <Show when={f().text} fallback={<p class="muted">No text could be read from this file, so the AI can't see inside it.</p>}>
                <p class="small-text muted">Text the AI reads from this file:</p>
                <pre class="cw-text">{f().text}</pre>
              </Show>
            </div>
          </Match>
          <Match when={f().kind === "binary" && f().blob}>
            <p class="muted">No preview for this kind of file. You can still download it; the AI only sees its name.</p>
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function AIPanel(props: { onOpen: (path: string) => void }) {
  const [input, setInput] = createSignal("")
  let list!: HTMLDivElement
  createEffect(() => {
    cw.chat.map((t) => t.reply.length)
    queueMicrotask(() => list && (list.scrollTop = list.scrollHeight))
  })
  const send = (text = input().trim()) => {
    if (!text || aiBusy()) return
    setInput("")
    void askAI(text)
  }
  return (
    <section class="cw-ai code-ai">
      <div class="code-ai-list" ref={list}>
        <Show when={cw.chat.length && !aiBusy()}>
          <button class="code-action clear-chat" onClick={clearChat}>
            Clear AI chat
          </button>
        </Show>
        <Show when={!cw.chat.length}>
          <div class="cw-asks">
            <p class="muted small-text">
              Ask about your files or have the AI make something from them. It sees {cw.picked.length ? "the files you ticked" : "all your files"}; tick images to let it look at them.
            </p>
            <For each={QUICK_ASKS}>
              {(q) => (
                <button class="tool-btn" disabled={!cw.files.length} onClick={() => send(q)}>
                  {q}
                </button>
              )}
            </For>
          </div>
        </Show>
        <For each={cw.chat}>
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
                      when={t.applied}
                      fallback={
                        <>
                          <button
                            class="button primary small-button"
                            onClick={() => {
                              const written = applyReply(t.id)
                              if (written[0]) props.onOpen(written[0])
                            }}
                          >
                            Save {files().length} file{files().length === 1 ? "" : "s"}
                          </button>
                          <span class="small-text muted">{files().map((f) => f.path).join(", ")}</span>
                        </>
                      }
                    >
                      {(applied) => (
                        <span class="small-text muted">
                          Saved:{" "}
                          <For each={applied()}>
                            {(p, i) => (
                              <>
                                {i() ? ", " : ""}
                                <button class="link-button" onClick={() => props.onOpen(p)}>
                                  {p}
                                </button>
                              </>
                            )}
                          </For>
                        </span>
                      )}
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
          placeholder={cw.files.length ? "Ask about your files, or what to make…" : "Add files first, or ask anything…"}
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
    </section>
  )
}
