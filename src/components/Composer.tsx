import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ACCEPT, readFile } from "../lib/files"
import { isImage } from "../lib/history"
import { activeId, isStreaming, send, stop } from "../lib/store"
import { AI_TOOLS, findTool } from "../lib/tools"
import type { Attachment } from "../lib/types"
import { GitHubDialog, WebPageDialog } from "./AddDialogs"
import { IconCamera, IconFile, IconGitHub, IconImage, IconLink, IconPlus, IconSend, IconSparkle, IconStop, IconX } from "./icons"

export function Composer(props: { autofocus?: boolean; draft?: () => string | undefined; onDraftUsed?: () => void }) {
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<Attachment[]>([])
  const [error, setError] = createSignal<string>()
  const [dragging, setDragging] = createSignal(false)
  const [menu, setMenu] = createSignal(false)
  const [menuPlace, setMenuPlace] = createSignal({ down: false, max: 520 })
  const [tool, setTool] = createSignal<string>()
  const [dialog, setDialog] = createSignal<"github" | "web">()
  let input!: HTMLTextAreaElement
  let picker!: HTMLInputElement
  let camera!: HTMLInputElement
  let menuRoot!: HTMLDivElement

  const streaming = () => isStreaming(activeId())
  const canSend = () => (text().trim() !== "" || files().length > 0) && !streaming()

  const resize = () => {
    input.style.height = "auto"
    input.style.height = Math.min(input.scrollHeight, 280) + "px"
  }

  const closeMenu = (e: MouseEvent) => !menuRoot.contains(e.target as Node) && setMenu(false)
  const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false)
  onMount(() => {
    document.addEventListener("mousedown", closeMenu)
    document.addEventListener("keydown", escape)
    if (props.autofocus && matchMedia("(pointer: fine)").matches) input.focus()
  })
  onCleanup(() => {
    document.removeEventListener("mousedown", closeMenu)
    document.removeEventListener("keydown", escape)
  })

  const pick = (fn: () => void) => () => {
    setMenu(false)
    fn()
  }

  // Suggestions on the empty screen fill the box.
  createEffect(() => {
    const d = props.draft?.()
    if (d) {
      setText(d)
      queueMicrotask(() => {
        resize()
        input.focus()
      })
      props.onDraftUsed?.()
    }
  })

  async function add(list: FileList | File[]) {
    setError(undefined)
    for (const file of Array.from(list)) {
      try {
        const a = await readFile(file)
        setFiles((f) => [...f, a])
      } catch (e) {
        setError((e as Error).message)
      }
    }
  }

  function submit() {
    if (!canSend()) return
    send(text().trim(), files(), tool())
    setText("")
    setFiles([])
    setTool(undefined)
    setError(undefined)
    queueMicrotask(resize)
  }

  return (
    <form
      class={`composer ${dragging() ? "dragging" : ""}`}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer?.files.length) void add(e.dataTransfer.files)
      }}
    >
      <Show when={files().length}>
        <div class="attachments">
          <For each={files()}>
            {(f) => (
              <div class="attachment">
                <Show when={isImage(f)} fallback={<span class="file-chip"><IconFile />{f.name}</span>}>
                  <img src={`data:${f.mediaType};base64,${f.data}`} alt={f.name} />
                </Show>
                <button type="button" class="remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}>
                  <IconX />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={input}
        rows={1}
        placeholder={tool() ? `${findTool(tool())!.label}: type or paste here` : "Message Jonny's AI"}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value)
          resize()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
            e.preventDefault()
            submit()
          }
        }}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData?.files ?? [])
          if (pasted.length) {
            e.preventDefault()
            void add(pasted)
          }
        }}
      />
      <Show when={error()}>
        <div class="composer-error">{error()}</div>
      </Show>
      <div class="composer-bar">
        <div class="tools-menu" ref={menuRoot}>
          <button
            type="button"
            class="icon-button"
            title="Add photos, files, GitHub and AI tools"
            aria-label="Add photos, files and tools"
            aria-expanded={menu()}
            onClick={() => {
              // Open towards whichever side of the screen has more room, and fit within it.
              const rect = menuRoot.getBoundingClientRect()
              const above = rect.top - 16
              const below = innerHeight - rect.bottom - 16
              setMenuPlace({ down: below > above, max: Math.min(560, Math.max(above, below)) })
              setMenu(!menu())
            }}
          >
            <IconPlus />
          </button>
          <Show when={menu()}>
            <div class={`menu ${menuPlace().down ? "down" : "up"}`} style={{ "max-height": `${menuPlace().max}px` }} role="menu">
              <div class="menu-label">Add</div>
              <button type="button" role="menuitem" onClick={pick(() => picker.click())}>
                <IconImage /> Photos & files
              </button>
              <button type="button" role="menuitem" onClick={pick(() => camera.click())}>
                <IconCamera /> Take a photo
              </button>
              <button type="button" role="menuitem" onClick={pick(() => setDialog("github"))}>
                <IconGitHub /> GitHub repo
              </button>
              <button type="button" role="menuitem" onClick={pick(() => setDialog("web"))}>
                <IconLink /> Web page
              </button>
              <div class="menu-label">AI tools</div>
              <For each={AI_TOOLS}>
                {(t) => (
                  <button
                    type="button"
                    role="menuitem"
                    class={tool() === t.id ? "on" : ""}
                    onClick={pick(() => {
                      setTool(tool() === t.id ? undefined : t.id)
                      input.focus()
                    })}
                  >
                    <IconSparkle />
                    <span>
                      {t.label}
                      <small>{t.hint}</small>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.currentTarget.files && void add(e.currentTarget.files).then(() => (picker.value = ""))} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.currentTarget.files && void add(e.currentTarget.files).then(() => (camera.value = ""))} />
        <Show when={tool()}>
          <button type="button" class="chip on" title="Remove tool" onClick={() => setTool(undefined)}>
            <IconSparkle />
            {findTool(tool())!.label}
            <IconX />
          </button>
        </Show>
        <span class="spacer" />
        <Show
          when={streaming()}
          fallback={
            <button type="submit" class="send" disabled={!canSend()} aria-label="Send message">
              <IconSend />
            </button>
          }
        >
          <button type="button" class="send" aria-label="Stop generating" onClick={() => stop(activeId()!)}>
            <IconStop />
          </button>
        </Show>
      </div>
      {/* Portaled out of this form: the dialogs have forms of their own. */}
      <Show when={dialog()}>
        <Portal>
          <Show when={dialog() === "github"} fallback={<WebPageDialog onClose={() => setDialog(undefined)} onAdd={(list) => setFiles((f) => [...f, ...list])} />}>
            <GitHubDialog onClose={() => setDialog(undefined)} onAdd={(list) => setFiles((f) => [...f, ...list])} />
          </Show>
        </Portal>
      </Show>
    </form>
  )
}
