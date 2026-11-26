import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { catalog } from "../lib/catalog"
import { modelLabel, sameModel } from "../lib/models"
import { settings, updateSettings } from "../lib/store"
import type { ModelInfo } from "../lib/types"
import { IconCheck, IconChevron, IconColumns } from "./icons"

export function ModelPicker() {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  let root!: HTMLDivElement
  // Every word somewhere in the name or id ("claude sonnet", "gpt 5", "vision").
  const matches = (m: ModelInfo) => {
    const text = `${m.label} ${m.id} ${m.hint ?? ""}`.toLowerCase()
    return query().toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w))
  }
  const groups = () => {
    const shown = catalog().filter(matches)
    const paid = shown.filter((m) => m.paid)
    return [
      { heading: "Free models", models: shown.filter((m) => !m.paid) },
      { heading: "All other models · billed to your OpenRouter account", models: paid },
    ].filter((g) => g.models.length)
  }
  const compare = () => settings.models.length > 1

  const close = (e: MouseEvent) => !root.contains(e.target as Node) && setOpen(false)
  const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
  onMount(() => {
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
  })
  onCleanup(() => {
    document.removeEventListener("mousedown", close)
    document.removeEventListener("keydown", esc)
  })

  function choose(model: ModelInfo, slot: number) {
    const next = settings.models.map((m) => ({ ...m }))
    next[slot] = { id: model.id }
    updateSettings({ models: next })
    if (!compare()) setOpen(false)
  }

  function toggleCompare() {
    if (compare()) return updateSettings({ models: [settings.models[0]] })
    const first = settings.models[0]
    const other = catalog().find((m) => !sameModel(m, first))
    if (other) updateSettings({ models: [first, { id: other.id }] })
  }

  return (
    <div class="picker" ref={root}>
      <button
        class="picker-button"
        onClick={() => {
          setOpen(!open())
          setQuery("")
        }}
        aria-expanded={open()}
      >
        <For each={settings.models}>
          {(m, i) => (
            <>
              <Show when={i() > 0}>
                <span class="vs">vs</span>
              </Show>
              <span class="dot" />
              <span>{modelLabel(m, catalog())}</span>
            </>
          )}
        </For>
        <IconChevron />
      </button>
      <Show when={open()}>
        <div class="picker-menu" role="menu">
          <button class={`compare-toggle ${compare() ? "on" : ""}`} onClick={toggleCompare}>
            <IconColumns />
            <span>
              <strong>Compare side by side</strong>
              <small>Send each message to two models at once</small>
            </span>
            <span class="switch" />
          </button>
          <Show when={catalog().length > 15}>
            <input
              class="text-input picker-search"
              type="search"
              placeholder={`Search ${catalog().length} models`}
              aria-label="Search models"
              autocapitalize="off"
              spellcheck={false}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </Show>
          <div class={compare() ? "picker-columns" : ""}>
            <For each={compare() ? [0, 1] : [0]}>
              {(slot) => (
                <div class="picker-column">
                  <Show when={compare()}>
                    <div class="picker-slot">{slot === 0 ? "Left" : "Right"}</div>
                  </Show>
                  <For each={groups()} fallback={<p class="picker-heading">No models match “{query()}”.</p>}>
                    {(group) => (
                      <div class="picker-group">
                        <div class="picker-heading">{group.heading}</div>
                        <For each={group.models}>
                          {(m) => (
                            <button class="picker-item" role="menuitem" onClick={() => choose(m, slot)}>
                              <span>
                                {m.label}
                                <Show when={m.hint}>
                                  <small>{m.hint}</small>
                                </Show>
                              </span>
                              <Show when={settings.models[slot] && sameModel(settings.models[slot], m)}>
                                <IconCheck />
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
