import { createEffect, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { useRegisterSW } from "virtual:pwa-register/solid"
import { InstallHelp, SettingsDialog, Unlock } from "./components/Dialogs"
import { IconCompose, IconMenu } from "./components/icons"
import { Canvas } from "./components/Canvas"
import { Composer, type Draft } from "./components/Composer"
import { ModelPicker } from "./components/ModelPicker"
import { Sidebar } from "./components/Sidebar"
import { Thread } from "./components/Thread"
import { refreshStatus, status } from "./lib/catalog"
import { checkPin } from "./lib/lock"
import { activeConversation, loadConversations, loaded, newChat, settings, updateSettings } from "./lib/store"

const SUGGESTIONS: Draft[] = [
  { text: "Explain a tricky concept simply" },
  { text: "Build a single-page HTML to-do app" },
  { text: "A cozy cabin in snowy woods at dusk, warm light in the windows", mode: "image" },
  { text: "Waves rolling onto a beach at sunrise, slow aerial shot", mode: "video" },
]

export function App() {
  const [locked, setLocked] = createSignal(true)
  const [unlockError, setUnlockError] = createSignal<string>()
  const [sidebar, setSidebar] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [showInstall, setShowInstall] = createSignal(false)
  const [draft, setDraft] = createSignal<Draft>()

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  createEffect(() => {
    const root = document.documentElement
    if (settings.theme === "system") root.removeAttribute("data-theme")
    else root.dataset.theme = settings.theme
  })

  async function unlock(pin: string) {
    setUnlockError(undefined)
    if (!(await checkPin(pin))) return setUnlockError("Wrong passcode.")
    setLocked(false)
    void refreshStatus(settings)
  }

  onMount(() => void loadConversations())

  const noKeys = () => !!status() && !status()!.anthropic && !status()!.openai

  return (
    <Switch>
      <Match when={locked()}>
        <Unlock error={unlockError()} onSubmit={unlock} />
      </Match>
      <Match when={!locked()}>
        <div class="app">
          <Sidebar open={sidebar()} onClose={() => setSidebar(false)} onSettings={() => setShowSettings(true)} onInstallHelp={() => setShowInstall(true)} />
          <main class="main">
            <header class="topbar">
              <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={() => setSidebar(true)}>
                <IconMenu />
              </button>
              <ModelPicker />
              <span class="spacer" />
              <Show when={activeConversation()}>
                <button class="icon-button" title="New chat" aria-label="New chat" onClick={newChat}>
                  <IconCompose />
                </button>
              </Show>
            </header>
            <Show
              when={activeConversation()}
              fallback={
                <Show
                  when={!noKeys()}
                  fallback={
                    <div class="welcome">
                      <div class="setup">
                        <h1>Add an API key to start</h1>
                        <p class="muted">
                          Paste an Anthropic key to chat with Claude, an OpenAI key for ChatGPT, or both. Keys are saved only on this device.
                        </p>
                        <button class="button primary wide" onClick={() => setShowSettings(true)}>
                          Add API keys
                        </button>
                      </div>
                    </div>
                  }
                >
                <div class="welcome">
                  <h1>What's on your mind?</h1>
                  <Composer autofocus draft={draft} onDraftUsed={() => setDraft(undefined)} />
                  <div class="suggestions">
                    <For each={SUGGESTIONS}>
                      {(s) => (
                        <button onClick={() => setDraft({ ...s })}>
                          {s.mode === "image" ? "🖼️ " : s.mode === "video" ? "🎬 " : ""}
                          {s.mode ? `Create ${s.mode}: ` : ""}
                          {s.text}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                </Show>
              }
            >
              {(conv) => (
                <>
                  <Thread conv={conv()} />
                  <div class="composer-dock">
                    <Composer />
                    <p class="disclaimer">AI can make mistakes. Check important info.</p>
                  </div>
                </>
              )}
            </Show>
            <Show when={!loaded()}>
              <div class="loading-bar" />
            </Show>
          </main>
          <Canvas />
          <Show when={showSettings()}>
            <SettingsDialog
              onClose={() => setShowSettings(false)}
              onLock={() => {
                setShowSettings(false)
                setLocked(true)
              }}
            />
          </Show>
          <Show when={showInstall()}>
            <InstallHelp onClose={() => setShowInstall(false)} />
          </Show>
          <Show when={needRefresh()}>
            <div class="toast">
              A new version is ready.
              <button class="button primary" onClick={() => void updateServiceWorker(true)}>
                Reload
              </button>
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
