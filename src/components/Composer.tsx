import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import { ACCEPT, readFile } from "../lib/files"
import { isImage } from "../lib/history"
import { activeId, isStreaming, send, stop } from "../lib/store"
import type { Attachment } from "../lib/types"
import { IconFile, IconPlus, IconSend, IconStop, IconX } from "./icons"

export function Composer(props: { autofocus?: boolean; draft?: () => string | undefined; onDraftUsed?: () => void }) {
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<Attachment[]>([])
  const [error, setError] = createSignal<string>()
  const [dragging, setDragging] = createSignal(false)
  let input!: HTMLTextAreaElement
  let picker!: HTMLInputElement

  const streaming = () => isStreaming(activeId())
  const canSend = () => (text().trim() !== "" || files().length > 0) && !streaming()

  const resize = () => {
    input.style.height = "auto"
    input.style.height = Math.min(input.scrollHeight, 280) + "px"
  }

  onMount(() => {
    if (props.autofocus && matchMedia("(pointer: fine)").matches) input.focus()
  })

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
    send(text().trim(), files())
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
        placeholder="Message Personal AI"
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
        <button type="button" class="icon-button" title="Attach images or text files" aria-label="Attach files" onClick={() => picker.click()}>
          <IconPlus />
        </button>
        <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.currentTarget.files && void add(e.currentTarget.files).then(() => (picker.value = ""))} />
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
