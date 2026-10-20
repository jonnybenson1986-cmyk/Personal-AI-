import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { catalog, status } from "../lib/catalog"
import { modelLabel, PROVIDER_NAME, sameModel } from "../lib/models"
import { settings, updateSettings } from "../lib/store"
import type { ModelInfo, ProviderId } from "../lib/types"
import { IconCheck, IconChevron, IconColumns } from "./icons"

export function ModelPicker() {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement
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

  const groups = () =>
    (["anthropic", "openai"] as ProviderId[]).map((provider) => ({
      provider,
      models: catalog().filter((m) => m.provider === provider),
      enabled: status()?.[provider] ?? true,
    }))

  function choose(model: ModelInfo, slot: number) {
    const next = settings.models.map((m) => ({ ...m }))
    next[slot] = { provider: model.provider, id: model.id }
    updateSettings({ models: next })
    if (!compare()) setOpen(false)
  }

  function toggleCompare() {
    if (compare()) return updateSettings({ models: [settings.models[0]] })
    const first = settings.models[0]
    // Pair with the other provider's first model, so compare defaults to Claude vs ChatGPT.
    const other = catalog().find((m) => m.provider !== first.provider && status()?.[m.provider] !== false) ?? catalog().find((m) => !sameModel(m, first))
    if (other) updateSettings({ models: [first, { provider: other.provider, id: other.id }] })
  }

  return (
    <div class="picker" ref={root}>
      <button class="picker-button" onClick={() => setOpen(!open())} aria-expanded={open()}>
        <For each={settings.models}>
          {(m, i) => (
            <>
              <Show when={i() > 0}>
                <span class="vs">vs</span>
              </Show>
              <span class={`dot ${m.provider}`} />
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
          <div class={compare() ? "picker-columns" : ""}>
            <For each={compare() ? [0, 1] : [0]}>
              {(slot) => (
                <div class="picker-column">
                  <Show when={compare()}>
                    <div class="picker-slot">{slot === 0 ? "Left" : "Right"}</div>
                  </Show>
                  <For each={groups()}>
                    {(group) => (
                      <div class="picker-group">
                        <div class="picker-heading">
                          <span class={`dot ${group.provider}`} />
                          {PROVIDER_NAME[group.provider]}
                          <Show when={!group.enabled}>
                            <span class="muted"> · no API key</span>
                          </Show>
                        </div>
                        <For each={group.models}>
                          {(m) => (
                            <button class="picker-item" role="menuitem" disabled={!group.enabled} onClick={() => choose(m, slot)}>
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
