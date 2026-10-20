import { createEffect, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { useRegisterSW } from "virtual:pwa-register/solid"
import { InstallHelp, SettingsDialog, Unlock } from "./components/Dialogs"
import { IconCompose, IconMenu } from "./components/icons"
import { Composer } from "./components/Composer"
import { ModelPicker } from "./components/ModelPicker"
import { Sidebar } from "./components/Sidebar"
import { Thread } from "./components/Thread"
import { refreshCatalog, setStatus, status } from "./lib/catalog"
import { checkStatus } from "./lib/providers"
import { activeConversation, loadConversations, loaded, newChat, settings, updateSettings } from "./lib/store"

const SUGGESTIONS = [
  "Explain a tricky concept simply",
  "Help me write a polite but firm email",
  "Plan a 3-day trip to Lisbon",
  "Review this code for bugs",
]

export function App() {
  const [locked, setLocked] = createSignal(true)
  const [checking, setChecking] = createSignal(false)
  const [unlockError, setUnlockError] = createSignal<string>()
  const [sidebar, setSidebar] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [showInstall, setShowInstall] = createSignal(false)
  const [draft, setDraft] = createSignal("")

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  createEffect(() => {
    const root = document.documentElement
    if (settings.theme === "system") root.removeAttribute("data-theme")
    else root.dataset.theme = settings.theme
  })

  async function unlock(passcode: string) {
    setChecking(true)
    setUnlockError(undefined)
    try {
      const s = await checkStatus(passcode)
      updateSettings({ passcode })
      setStatus(s)
      setLocked(false)
      void refreshCatalog(passcode, s)
    } catch (e) {
      // Offline: let the app open so past chats can still be read.
      if (e instanceof TypeError && settings.passcode === passcode && !navigator.onLine) setLocked(false)
      else setUnlockError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  onMount(() => {
    void loadConversations()
    if (settings.passcode) void unlock(settings.passcode)
  })

  const noKeys = () => status() && !status()!.anthropic && !status()!.openai

  return (
    <Switch>
      <Match when={locked() && (!settings.passcode || unlockError())}>
        <Unlock error={unlockError()} busy={checking()} onSubmit={unlock} />
      </Match>
      <Match when={locked()}>
        <div class="splash">
          <img src="/favicon.svg" alt="" width="40" height="40" />
        </div>
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
            <Show when={noKeys()}>
              <div class="banner">No API keys are set on the server. Add ANTHROPIC_API_KEY and/or OPENAI_API_KEY in Netlify, then redeploy.</div>
            </Show>
            <Show
              when={activeConversation()}
              fallback={
                <div class="welcome">
                  <h1>What's on your mind?</h1>
                  <Composer autofocus draft={draft} onDraftUsed={() => setDraft("")} />
                  <div class="suggestions">
                    <For each={SUGGESTIONS}>{(s) => <button onClick={() => setDraft(s)}>{s}</button>}</For>
                  </div>
                </div>
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
          <Show when={showSettings()}>
            <SettingsDialog
              onClose={() => setShowSettings(false)}
              onSignOut={() => {
                updateSettings({ passcode: "" })
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
