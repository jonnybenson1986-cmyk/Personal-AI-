import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { status } from "../lib/catalog"
import { ACCEPT, readFile } from "../lib/files"
import { isImage } from "../lib/history"
import { activeConversation, activeId, isStreaming, send, settings, stop, updateSettings } from "../lib/store"
import type { Attachment, Settings, TurnMode } from "../lib/types"
import { IconFile, IconGlobe, IconImage, IconPaperclip, IconPlus, IconSend, IconStop, IconVideo, IconX } from "./icons"

const PLACEHOLDER: Record<TurnMode, string> = {
  chat: "Message Personal AI",
  image: "Describe an image to create, or attach one to edit",
  video: "Describe a video to create",
}

export interface Draft {
  text: string
  mode?: TurnMode
}

export function Composer(props: { autofocus?: boolean; draft?: () => Draft | undefined; onDraftUsed?: () => void }) {
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<Attachment[]>([])
  const [mode, setMode] = createSignal<TurnMode>("chat")
  const [menu, setMenu] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [dragging, setDragging] = createSignal(false)
  let input!: HTMLTextAreaElement
  let picker!: HTMLInputElement
  let menuRoot!: HTMLDivElement

  const streaming = () => isStreaming(activeId())
  // Web search is fixed per chat (Claude must see the same tools on every turn).
  const webSearch = () => activeConversation()?.webSearch ?? settings.webSearch
  const canSend = () => (text().trim() !== "" || (mode() === "chat" && files().length > 0)) && !streaming()
  const noOpenAI = () => status()?.openai === false

  const resize = () => {
    input.style.height = "auto"
    input.style.height = Math.min(input.scrollHeight, 280) + "px"
  }

  const closeMenu = (e: MouseEvent) => !menuRoot.contains(e.target as Node) && setMenu(false)
  onMount(() => {
    document.addEventListener("mousedown", closeMenu)
    if (props.autofocus && matchMedia("(pointer: fine)").matches) input.focus()
  })
  onCleanup(() => document.removeEventListener("mousedown", closeMenu))

  // Suggestions on the empty screen fill the box.
  createEffect(() => {
    const d = props.draft?.()
    if (d) {
      setText(d.text)
      if (d.mode) setMode(d.mode)
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

  function pickMode(next: TurnMode) {
    setMenu(false)
    setMode(next)
    if (next !== "chat" && noOpenAI()) setError("Creating images and videos needs OPENAI_API_KEY on the server.")
    input.focus()
  }

  function submit() {
    if (!canSend()) return
    if (mode() !== "chat" && files().some((f) => !isImage(f))) return setError("Only images can be attached when creating images or videos.")
    send(text().trim(), files(), mode())
    setText("")
    setFiles([])
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
        placeholder={PLACEHOLDER[mode()]}
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
          <button type="button" class="icon-button" title="Add files and tools" aria-label="Add files and tools" aria-expanded={menu()} onClick={() => setMenu(!menu())}>
            <IconPlus />
          </button>
          <Show when={menu()}>
            <div class="menu up" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  picker.click()
                }}
              >
                <IconPaperclip /> Add photos & files
              </button>
              <button type="button" role="menuitem" onClick={() => pickMode("image")}>
                <IconImage /> Create image
              </button>
              <button type="button" role="menuitem" onClick={() => pickMode("video")}>
                <IconVideo /> Create video
              </button>
            </div>
          </Show>
        </div>
        <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.currentTarget.files && void add(e.currentTarget.files).then(() => (picker.value = ""))} />
        <Show
          when={mode() === "chat"}
          fallback={
            <>
              <button type="button" class="chip on" onClick={() => setMode("chat")} title="Back to chat">
                {mode() === "image" ? <IconImage /> : <IconVideo />}
                {mode() === "image" ? "Image" : "Video"}
                <IconX />
              </button>
              <select
                class="mini-select"
                aria-label="Shape"
                value={mode() === "video" && settings.shape === "square" ? "landscape" : settings.shape} onChange={(e) => updateSettings({ shape: e.currentTarget.value as Settings["shape"] })}>
                <Show when={mode() === "image"}>
                  <option value="square">Square</option>
                </Show>
                <option value="portrait">Portrait</option>
                <option value="landscape">{mode() === "image" ? "Landscape" : "Landscape / widescreen"}</option>
              </select>
              <Show when={mode() === "video"}>
                <select
                  class="mini-select"
                  aria-label="Length"
                  value={settings.videoSeconds}
                  onChange={(e) => updateSettings({ videoSeconds: e.currentTarget.value as Settings["videoSeconds"] })}
                >
                  <option value="4">4 sec</option>
                  <option value="8">8 sec</option>
                  <option value="12">12 sec</option>
                </select>
              </Show>
            </>
          }
        >
          <button
            type="button"
            class={`chip ${webSearch() ? "on" : ""}`}
            disabled={!!activeConversation()}
            title={activeConversation() ? "Web search is set when a chat starts" : "Let the model search the web"}
            onClick={() => updateSettings({ webSearch: !settings.webSearch })}
          >
            <IconGlobe />
            Search
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
    </form>
  )
}
