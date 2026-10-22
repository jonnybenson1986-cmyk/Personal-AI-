import { createMemo, createSignal, For, Show } from "solid-js"
import { canInstall, install, standalone } from "../lib/install"
import { setView, view } from "../lib/view"
import { activeId, conversations, deleteConversation, isStreaming, newChat, renameConversation, setActiveId } from "../lib/store"
import type { Conversation } from "../lib/types"
import { IconCompose, IconDownload, IconEdit, IconSettings, IconTrash, IconChat, IconCode } from "./icons"

const DAY = 86_400_000

function bucket(time: number) {
  const start = new Date().setHours(0, 0, 0, 0)
  if (time >= start) return "Today"
  if (time >= start - DAY) return "Yesterday"
  if (time >= start - 7 * DAY) return "Previous 7 days"
  if (time >= start - 30 * DAY) return "Previous 30 days"
  return "Older"
}

export function Sidebar(props: { open: boolean; onClose: () => void; onSettings: () => void; onInstallHelp: () => void }) {
  const [query, setQuery] = createSignal("")
  const [renaming, setRenaming] = createSignal<string>()

  const groups = createMemo(() => {
    const q = query().trim().toLowerCase()
    const list = conversations.filter(
      (c) => !q || c.title.toLowerCase().includes(q) || c.turns.some((t) => t.text.toLowerCase().includes(q)),
    )
    const out: { label: string; items: Conversation[] }[] = []
    for (const c of list) {
      const label = bucket(c.updatedAt)
      const group = out.find((g) => g.label === label)
      if (group) group.items.push(c)
      else out.push({ label, items: [c] })
    }
    return out
  })

  const open = (id: string) => {
    setActiveId(id)
    setView("chat")
    props.onClose()
  }

  return (
    <>
      <div class={`scrim ${props.open ? "show" : ""}`} onClick={props.onClose} />
      <aside class={`sidebar ${props.open ? "open" : ""}`}>
        <div class="sidebar-top">
          <div class="brand">
            <img src="/favicon.svg" alt="" width="22" height="22" />
            Jonny's AI project
          </div>
          <button
            class="icon-button"
            title="New chat"
            aria-label="New chat"
            onClick={() => {
              newChat()
              setView("chat")
              props.onClose()
            }}
          >
            <IconCompose />
          </button>
        </div>
        <div class="nav-switch">
          <button
            class={view() === "chat" ? "on" : ""}
            onClick={() => {
              setView("chat")
              props.onClose()
            }}
          >
            <IconChat /> Chat
          </button>
          <button
            class={view() === "code" ? "on" : ""}
            onClick={() => {
              setView("code")
              props.onClose()
            }}
          >
            <IconCode /> Code
          </button>
        </div>
        <input class="search" type="search" placeholder="Search chats" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        <nav class="history">
          <Show when={conversations.length === 0}>
            <p class="muted empty-history">Your chats will appear here. They're stored only on this device.</p>
          </Show>
          <For each={groups()}>
            {(group) => (
              <div class="history-group">
                <div class="history-label">{group.label}</div>
                <For each={group.items}>
                  {(c) => (
                    <div class={`history-item ${activeId() === c.id ? "active" : ""}`}>
                      <Show
                        when={renaming() === c.id}
                        fallback={
                          <button class="history-title" onClick={() => open(c.id)} title={c.title}>
                            <Show when={isStreaming(c.id)}>
                              <span class="live" />
                            </Show>
                            {c.title}
                          </button>
                        }
                      >
                        <input
                          class="rename"
                          value={c.title}
                          ref={(el) => setTimeout(() => el.select())}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur()
                            if (e.key === "Escape") setRenaming(undefined)
                          }}
                          onBlur={(e) => {
                            if (renaming() === c.id) renameConversation(c.id, e.currentTarget.value)
                            setRenaming(undefined)
                          }}
                        />
                      </Show>
                      <div class="history-actions">
                        <button class="icon-button small" title="Rename" aria-label="Rename chat" onClick={() => setRenaming(c.id)}>
                          <IconEdit />
                        </button>
                        <button
                          class="icon-button small"
                          title="Delete"
                          aria-label="Delete chat"
                          onClick={() => confirm(`Delete "${c.title}"?`) && void deleteConversation(c.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </nav>
        <div class="sidebar-bottom">
          <Show when={!standalone()}>
            <button class="side-button" onClick={() => (canInstall() ? void install() : props.onInstallHelp())}>
              <IconDownload />
              Install app
            </button>
          </Show>
          <button class="side-button" onClick={props.onSettings}>
            <IconSettings />
            Settings
          </button>
        </div>
      </aside>
    </>
  )
}
