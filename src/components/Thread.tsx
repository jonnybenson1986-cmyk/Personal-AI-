import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { download, setCanvas } from "../lib/canvas"
import { catalog } from "../lib/catalog"
import { isImage } from "../lib/history"
import { fileExtension, renderMarkdown } from "../lib/markdown"
import { modelLabel } from "../lib/models"
import { decisionLabel } from "../lib/omni"
import { editAndResend, isStreaming, regenerate } from "../lib/store"
import { findTool } from "../lib/tools"
import { PushCard } from "./PushCard"
import type { Conversation, Reply, Turn } from "../lib/types"
import { IconCheck, IconCopy, IconEdit, IconFile, IconRefresh } from "./icons"

function CopyButton(props: { text: () => string; label?: string }) {
  const [done, setDone] = createSignal(false)
  return (
    <button
      class="icon-button small"
      title="Copy"
      aria-label={props.label ?? "Copy"}
      onClick={async () => {
        await navigator.clipboard.writeText(props.text())
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      <Show when={done()} fallback={<IconCopy />}>
        <IconCheck />
      </Show>
    </button>
  )
}

/** Markdown re-rendered at most once per frame while a reply streams in. */
function Markdown(props: { text: string }) {
  const [html, setHtml] = createSignal("")
  let frame = 0
  createEffect(
    on(
      () => props.text,
      (text) => {
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          setHtml(renderMarkdown(props.text))
        })
        if (!text) setHtml("")
      },
    ),
  )
  onCleanup(() => cancelAnimationFrame(frame))
  return <div class="markdown" innerHTML={html()} />
}

function ReplyView(props: { reply: Reply; last: boolean; convId: string; compare: boolean; turn: Turn }) {
  const r = () => props.reply
  const [showThinking, setShowThinking] = createSignal(false)
  const thinkingActive = () => r().status === "streaming" && r().thinking !== "" && r().text === ""
  return (
    <div class="reply">
      <div class="reply-model">
        <span class="dot" />
        {modelLabel(r().model, catalog())}
        {/* "Auto" picks a model per message; say which one answered. */}
        <Show when={r().servedBy && !r().servedBy!.startsWith(r().model.id.replace(/:free$/, ""))}>
          <span class="served-by">· {modelLabel(r().servedBy!, catalog())}</span>
        </Show>
        <Show when={decisionLabel(r().route)}>{(label) => <span class="served-by">· {label()}</span>}</Show>
      </div>
      <Show when={r().thinking}>
        <button class="thinking-toggle" onClick={() => setShowThinking(!showThinking())} aria-expanded={showThinking()}>
          <span class={thinkingActive() ? "shimmer" : ""}>{thinkingActive() ? "Thinking…" : "Thought process"}</span>
          <span class="caret">{showThinking() ? "▾" : "▸"}</span>
        </button>
        <Show when={showThinking()}>
          <div class="thinking">
            <Markdown text={r().thinking} />
          </div>
        </Show>
      </Show>
      <Show when={r().status === "streaming" && !r().text && !r().thinking}>
        <div class="typing" aria-label="Waiting for response">
          <span />
          <span />
          <span />
        </div>
      </Show>
      <Show when={r().text}>
        <Markdown text={r().text} />
      </Show>
      <PushCard reply={r()} repo={props.turn.repo} convId={props.convId} />
      <Show when={r().error}>
        <div class={r().status === "error" ? "notice error" : "notice"}>{r().error}</div>
      </Show>
      <Show when={r().status === "stopped"}>
        <div class="muted small-text">Stopped</div>
      </Show>
      <Show when={r().status !== "streaming"}>
        <div class="reply-actions">
          <CopyButton text={() => r().text} label="Copy response" />
          <Show when={props.last && !props.compare}>
            <button class="icon-button small" title="Regenerate" aria-label="Regenerate response" onClick={() => regenerate(props.convId)}>
              <IconRefresh />
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function TurnView(props: { turn: Turn; last: boolean; conv: Conversation }) {
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const compare = () => props.turn.replies.length > 1
  return (
    <div class="turn">
      <div class="user-row">
        <Show
          when={editing()}
          fallback={
            <div class="user-message">
              <Show when={props.turn.attachments.length}>
                <div class="user-attachments">
                  <For each={props.turn.attachments}>
                    {(a) => (
                      <Show when={isImage(a)} fallback={<span class="file-chip"><IconFile />{a.name}</span>}>
                        <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={findTool(props.turn.tool)}>
                {(t) => <span class="tool-tag">{t().label}</span>}
              </Show>
              <Show when={props.turn.text}>
                <div class="bubble">{props.turn.text}</div>
              </Show>
              <div class="user-actions">
                <CopyButton text={() => props.turn.text} label="Copy message" />
                <Show when={!isStreaming(props.conv.id)}>
                  <button
                    class="icon-button small"
                    title="Edit"
                    aria-label="Edit message"
                    onClick={() => {
                      setDraft(props.turn.text)
                      setEditing(true)
                    }}
                  >
                    <IconEdit />
                  </button>
                </Show>
              </div>
            </div>
          }
        >
          <div class="edit-box">
            <textarea value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} rows={3} ref={(el) => setTimeout(() => el.focus())} />
            <div class="edit-actions">
              <button class="button ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                class="button primary"
                disabled={!draft().trim()}
                onClick={() => {
                  setEditing(false)
                  editAndResend(props.conv.id, props.turn.id, draft().trim())
                }}
              >
                Send
              </button>
            </div>
          </div>
        </Show>
      </div>
      <div class={compare() ? "replies compare" : "replies"}>
        <For each={props.turn.replies}>{(reply) => <ReplyView reply={reply} last={props.last} convId={props.conv.id} compare={compare()} turn={props.turn} />}</For>
      </div>
      <Show when={props.last && compare() && !isStreaming(props.conv.id)}>
        <div class="compare-actions">
          <button class="button ghost" onClick={() => regenerate(props.conv.id)}>
            <IconRefresh /> Regenerate both
          </button>
        </div>
      </Show>
    </div>
  )
}

export function Thread(props: { conv: Conversation }) {
  let scroller!: HTMLDivElement
  let inner!: HTMLDivElement
  let pinned = true
  const toBottom = () => scroller.scrollTo({ top: scroller.scrollHeight })

  // Follow new content while the reader is at the bottom; stop if they scroll up.
  onMount(() => {
    const observer = new ResizeObserver(() => pinned && toBottom())
    observer.observe(inner)
    onCleanup(() => observer.disconnect())
  })
  createEffect(
    on(
      () => props.conv.id,
      () => {
        pinned = true
        queueMicrotask(toBottom)
      },
    ),
  )
  createEffect(on(() => props.conv.turns.length, () => (pinned = true), { defer: true }))

  return (
    <div
      class="thread"
      ref={scroller}
      onScroll={() => (pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80)}
      onClick={async (e) => {
        const button = (e.target as HTMLElement).closest(".code-action") as HTMLButtonElement | null
        if (!button) return
        const block = button.closest(".code") as HTMLElement
        const code = block.querySelector("code")?.textContent ?? ""
        const lang = block.dataset.lang ?? ""
        const action = button.dataset.action
        if (action === "preview") setCanvas({ title: props.conv.title, lang, code })
        if (action === "download") download(block.dataset.path?.split("/").pop() || `code.${fileExtension(lang)}`, code)
        if (action === "copy") {
          await navigator.clipboard.writeText(code)
          button.textContent = "Copied"
          setTimeout(() => (button.textContent = "Copy"), 1500)
        }
      }}
    >
      <div class="thread-inner" ref={inner}>
        <For each={props.conv.turns}>{(turn, i) => <TurnView turn={turn} conv={props.conv} last={i() === props.conv.turns.length - 1} />}</For>
      </div>
    </div>
  )
}
