import { createSignal, type JSX, Show } from "solid-js"
import { canChat, refreshStatus } from "../lib/catalog"
import { sitePasscode } from "../lib/route"
import { unlockPaid } from "../lib/providers"
import { isIOS } from "../lib/install"
import { clearAll, settings, updateSettings } from "../lib/store"
import type { Settings } from "../lib/types"
import { IconX } from "./icons"

export function Modal(props: { title: string; onClose: () => void; children: JSX.Element }) {
  return (
    <div class="modal-scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="modal-head">
          <h2>{props.title}</h2>
          <button class="icon-button" aria-label="Close" onClick={props.onClose}>
            <IconX />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button role="radio" aria-checked={props.value === o.value} class={props.value === o.value ? "on" : ""} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function KeyField(props: { label: string; hint: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <small>{props.hint}</small>
      <input
        class="text-input"
        type="password"
        autocomplete="off"
        spellcheck={false}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onSave(e.currentTarget.value.trim())}
      />
    </label>
  )
}

/** The owner's passcode: unlocks paid models on the site's own key, on this device. */
function PaidUnlock() {
  const [code, setCode] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  async function unlock() {
    setBusy(true)
    setError(undefined)
    try {
      updateSettings({ sitePass: await unlockPaid(code().trim()) })
      setCode("")
      await refreshStatus(settings)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="field">
      <span>Paid models</span>
      <Show
        when={settings.sitePass}
        fallback={
          <>
            <small>Enter the site's passcode once on this device to use every model (GPT, Claude, Gemini…), billed to the site's OpenRouter account.</small>
            <form
              class="inline"
              onSubmit={(e) => {
                e.preventDefault()
                if (code().trim()) void unlock()
              }}
            >
              <input
                class="text-input"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                placeholder="Passcode"
                aria-label="Passcode"
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value)}
              />
              <button class="button" type="submit" disabled={busy() || !code().trim()}>
                {busy() ? "Checking…" : "Unlock"}
              </button>
            </form>
            <Show when={error()}>{(e) => <p class="small-text error-text">{e()}</p>}</Show>
          </>
        }
      >
        <small>Unlocked on this device: every model is in the model picker.</small>
        <div class="inline">
          <button
            class="button ghost"
            onClick={() => {
              updateSettings({ sitePass: undefined })
              void refreshStatus(settings)
            }}
          >
            Lock this device
          </button>
        </div>
      </Show>
    </div>
  )
}

export function SettingsDialog(props: { onClose: () => void }) {
  const save = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch)
    void refreshStatus(settings)
  }
  return (
    <Modal title="Settings" onClose={props.onClose}>
      <h3 class="section">AI</h3>
      <p class="muted small-text">
        The AI runs on OpenRouter, using this site's own key, so free models (Gemma, Nemotron, MiniMax and more) work with no setup. Every other model
        (GPT, Claude, Gemini, Grok and hundreds more) is paid: unlock them with the site's passcode, or add your own OpenRouter key.
      </p>
      <p class="small-text key-status">
        Status: <strong>{canChat() ? "ready" : "the site has no OpenRouter key yet: add one below"}</strong>
      </p>
      <Show when={sitePasscode() && !settings.openrouterKey.trim()}>
        <PaidUnlock />
      </Show>
      <KeyField
        label="Your own OpenRouter key (optional)"
        hint="Only needed to bill paid models to a different account: openrouter.ai → Settings → API Keys → Create, with credit at openrouter.ai → Credits. Saved only on this device."
        placeholder="sk-or-…"
        value={settings.openrouterKey}
        onSave={(openrouterKey) => save({ openrouterKey })}
      />
      <KeyField
        label="GitHub token"
        hint="Needed to push changes, and for private repos. github.com → Settings → Developer settings → Fine-grained tokens → choose your repos → Permissions: Contents and Pull requests set to Read and write. Saved only on this device."
        placeholder="github_pat_…"
        value={settings.githubToken}
        onSave={(githubToken) => updateSettings({ githubToken })}
      />
      <div class="field">
        <span>Keep working when the app is closed</span>
        <small>
          Replies are written on this site's server, so they finish even if you close the app or lock your phone, and are waiting when you come back. Your
          keys are only used for the request and never stored.
        </small>
        <Segmented<"on" | "off">
          value={settings.background === false ? "off" : "on"}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => updateSettings({ background: v === "on" })}
        />
      </div>
      <h3 class="section">App</h3>
      <label class="field">
        <span>Custom instructions</span>
        <small>Sent to every model as the system prompt. Applies to new chats.</small>
        <textarea
          rows={5}
          placeholder="e.g. I'm a product designer in London. Keep answers short and use British spelling."
          value={settings.system}
          onChange={(e) => updateSettings({ system: e.currentTarget.value })}
        />
      </label>
      <div class="field">
        <span>Theme</span>
        <Segmented<Settings["theme"]>
          value={settings.theme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
      </div>
      <div class="field row">
        <button
          class="button ghost danger"
          onClick={() => confirm("Delete every chat on this device? This can't be undone.") && void clearAll()}
        >
          Delete all chats
        </button>
      </div>
      <p class="muted small-text">Chats and keys are stored on this device only.</p>
    </Modal>
  )
}

export function InstallHelp(props: { onClose: () => void }) {
  return (
    <Modal title="Install Jonny's AI project" onClose={props.onClose}>
      <Show
        when={isIOS()}
        fallback={
          <ol class="steps">
            <li>
              <strong>Chrome or Edge (desktop):</strong> click the install icon at the right of the address bar, or open the browser menu and choose <em>Install Jonny's AI project</em>.
            </li>
            <li>
              <strong>Android:</strong> open the browser menu (⋮) and tap <em>Install app</em> or <em>Add to Home screen</em>.
            </li>
            <li>
              <strong>Safari (Mac):</strong> choose <em>File → Add to Dock</em>.
            </li>
          </ol>
        }
      >
        <ol class="steps">
          <li>Open this site in Safari.</li>
          <li>
            Tap the <strong>Share</strong> button.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
        </ol>
      </Show>
      <p class="muted small-text">The installed app opens in its own window and still loads your past chats when you're offline.</p>
    </Modal>
  )
}
