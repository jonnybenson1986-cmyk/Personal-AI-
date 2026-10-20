import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { catalog } from "../lib/catalog"
import { isImage } from "../lib/history"
import { renderMarkdown } from "../lib/markdown"
import { modelLabel } from "../lib/models"
import { editAndResend, isStreaming, regenerate } from "../lib/store"
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

function ReplyView(props: { reply: Reply; last: boolean; convId: string; compare: boolean }) {
  const r = () => props.reply
  const [showThinking, setShowThinking] = createSignal(false)
  const thinkingActive = () => r().status === "streaming" && r().thinking !== "" && r().text === ""
  return (
    <div class={`reply ${r().model.provider}`}>
      <div class="reply-model">
        <span class={`dot ${r().model.provider}`} />
        {modelLabel(r().model, catalog())}
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
      <Show when={r().activity}>
        <div class="activity shimmer">{r().activity}…</div>
      </Show>
      <Show when={r().status === "streaming" && !r().text && !r().thinking && !r().activity}>
        <div class="typing" aria-label="Waiting for response">
          <span />
          <span />
          <span />
        </div>
      </Show>
      <Show when={r().text}>
        <Markdown text={r().text} />
      </Show>
      <Show when={r().sources.length}>
        <details class="sources">
          <summary>{r().sources.length} sources</summary>
          <ol>
            <For each={r().sources}>
              {(s) => (
                <li>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title || new URL(s.url).hostname}
                  </a>
                  <span class="muted"> {new URL(s.url).hostname.replace(/^www\./, "")}</span>
                </li>
              )}
            </For>
          </ol>
        </details>
      </Show>
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
        <For each={props.turn.replies}>{(reply) => <ReplyView reply={reply} last={props.last} convId={props.conv.id} compare={compare()} />}</For>
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
        const button = (e.target as HTMLElement).closest(".copy-code") as HTMLButtonElement | null
        if (!button) return
        const code = button.closest(".code")?.querySelector("code")?.textContent ?? ""
        await navigator.clipboard.writeText(code)
        button.textContent = "Copied"
        setTimeout(() => (button.textContent = "Copy"), 1500)
      }}
    >
      <div class="thread-inner" ref={inner}>
        <For each={props.conv.turns}>{(turn, i) => <TurnView turn={turn} conv={props.conv} last={i() === props.conv.turns.length - 1} />}</For>
      </div>
    </div>
  )
}
