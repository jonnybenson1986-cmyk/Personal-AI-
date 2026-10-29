import { createEffect, createSignal, For, lazy, Match, onMount, Show, Suspense, Switch } from "solid-js"
import { useRegisterSW } from "virtual:pwa-register/solid"
import { InstallHelp, SettingsDialog } from "./components/Dialogs"
import { IconCompose, IconMenu } from "./components/icons"
import { Canvas } from "./components/Canvas"
import { Composer } from "./components/Composer"
import { ModelPicker } from "./components/ModelPicker"
import { Sidebar } from "./components/Sidebar"
import { Thread } from "./components/Thread"
import { canChat, refreshStatus } from "./lib/catalog"
import { activeConversation, loadConversations, loaded, newChat, settings } from "./lib/store"
import { view } from "./lib/view"

// The workspaces load only when opened, so chat stays fast.
const CodeView = lazy(() => import("./components/code/CodeView"))
const DesignView = lazy(() => import("./components/design/DesignView"))
const CoworkView = lazy(() => import("./components/cowork/CoworkView"))
const ImageEditor = lazy(() => import("./components/media/ImageEditor"))
const AudioEditor = lazy(() => import("./components/media/AudioEditor"))
const OmniView = lazy(() => import("./components/omni/OmniView"))

const SUGGESTIONS = [
  "Explain a tricky concept simply",
  "Build a single-page HTML to-do app",
  "Help me write a polite but firm email",
  "Plan a 3-day trip to Lisbon",
]

export function App() {
  const [sidebar, setSidebar] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [showInstall, setShowInstall] = createSignal(false)
  const [draft, setDraft] = createSignal<string>()

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  createEffect(() => {
    const root = document.documentElement
    if (settings.theme === "system") root.removeAttribute("data-theme")
    else root.dataset.theme = settings.theme
  })

  onMount(() => {
    void loadConversations()
    // Code and Cowork replies that finished on the server while the app was closed come back now,
    // not only when those screens are opened.
    void import("./lib/coworkspace").then((m) => m.restoreCowork()).catch(() => {})
    void Promise.all([import("./lib/workspace"), import("./lib/codeai")])
      .then(([w, ai]) => w.restoreWorkspace().then(ai.resumeCodeAI))
      .catch(() => {})
    void refreshStatus(settings)
  })

  const noKeys = () => canChat() === false

  return (
    <>
    <Show when={needRefresh()}>
      <div class="toast">
        A new version is ready.
        <button class="button primary" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
      </div>
    </Show>
        <div class="app">
          <Sidebar open={sidebar()} onClose={() => setSidebar(false)} onSettings={() => setShowSettings(true)} onInstallHelp={() => setShowInstall(true)} />
          <Show when={view() !== "chat"}>
            <main class="main">
              <Suspense fallback={<div class="loading-bar" />}>
                <Switch>
                  <Match when={view() === "code"}>
                    <CodeView onMenu={() => setSidebar(true)} />
                  </Match>
                  <Match when={view() === "design"}>
                    <DesignView onMenu={() => setSidebar(true)} />
                  </Match>
                  <Match when={view() === "cowork"}>
                    <CoworkView onMenu={() => setSidebar(true)} />
                  </Match>
                  <Match when={view() === "image"}>
                    <ImageEditor onMenu={() => setSidebar(true)} />
                  </Match>
                  <Match when={view() === "audio"}>
                    <AudioEditor onMenu={() => setSidebar(true)} />
                  </Match>
                  <Match when={view() === "omni"}>
                    <OmniView onMenu={() => setSidebar(true)} />
                  </Match>
                </Switch>
              </Suspense>
            </main>
          </Show>
          <main class="main" style={{ display: view() === "chat" ? undefined : "none" }}>
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
                        <h1>One step to start</h1>
                        <p class="muted">Jonny's AI project runs on free open models through OpenRouter. Get a free key, no card needed:</p>
                        <ol class="steps setup-steps">
                          <li>
                            Sign up at{" "}
                            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">
                              openrouter.ai
                            </a>
                          </li>
                          <li>Create an API key and copy it</li>
                          <li>Paste it here in Settings</li>
                        </ol>
                        <button class="button primary wide" onClick={() => setShowSettings(true)}>
                          Add your free key
                        </button>
                        <p class="muted small-text">Running your own OmniRoute gateway? Choose it under Settings → AI provider.</p>
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
                        <button onClick={() => setDraft(s)}>{s}</button>
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
            />
          </Show>
          <Show when={showInstall()}>
            <InstallHelp onClose={() => setShowInstall(false)} />
          </Show>
        </div>
    </>
  )
}
