import { createSignal, type JSX, Show } from "solid-js"
import { canChat, refreshStatus } from "../lib/catalog"
import { isIOS } from "../lib/install"
import { setPin } from "../lib/lock"
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

function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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

function PinField() {
  const [pin, setPinValue] = createSignal("")
  const [saved, setSaved] = createSignal(false)
  return (
    <div class="field">
      <span>App passcode</span>
      <small>Asked for each time the app opens on this device.</small>
      <div class="inline">
        <input
          class="text-input"
          type="password"
          inputmode="numeric"
          autocomplete="new-password"
          placeholder="New passcode"
          value={pin()}
          onInput={(e) => {
            setPinValue(e.currentTarget.value)
            setSaved(false)
          }}
        />
        <button
          class="button ghost"
          disabled={pin().trim().length < 4}
          onClick={async () => {
            await setPin(pin().trim())
            setPinValue("")
            setSaved(true)
          }}
        >
          {saved() ? "Saved" : "Change"}
        </button>
      </div>
      <Show when={pin() && pin().trim().length < 4}>
        <small>Use at least 4 characters.</small>
      </Show>
    </div>
  )
}

export function SettingsDialog(props: { onClose: () => void; onLock: () => void }) {
  const save = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch)
    void refreshStatus(settings)
  }
  return (
    <Modal title="Settings" onClose={props.onClose}>
      <h3 class="section">AI</h3>
      <p class="muted small-text">
        Personal AI uses free open models (Gemma, Nemotron, MiniMax and more) through OpenRouter. A free OpenRouter key is all it needs.
      </p>
      <KeyField
        label="OpenRouter key"
        hint="Free: sign up at openrouter.ai, then Settings → API Keys → Create. No card needed. Saved only on this device."
        placeholder="sk-or-…"
        value={settings.openrouterKey}
        onSave={(openrouterKey) => save({ openrouterKey })}
      />
      <p class="small-text key-status">
        Status: <strong>{canChat() ? "ready" : "add a key to start"}</strong>
      </p>
      <details class="advanced">
        <summary>Site has its own key with a passcode?</summary>
        <KeyField
          label="Server passcode"
          hint="Only if APP_PASSCODE is set in Netlify's environment variables."
          placeholder="APP_PASSCODE"
          value={settings.passcode}
          onSave={(passcode) => save({ passcode })}
        />
      </details>
      <h3 class="section">App</h3>
      <PinField />
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
        <button class="button ghost" onClick={props.onLock}>
          Lock app
        </button>
      </div>
      <p class="muted small-text">Chats and keys are stored on this device only.</p>
    </Modal>
  )
}

export function InstallHelp(props: { onClose: () => void }) {
  return (
    <Modal title="Install Personal AI" onClose={props.onClose}>
      <Show
        when={isIOS()}
        fallback={
          <ol class="steps">
            <li>
              <strong>Chrome or Edge (desktop):</strong> click the install icon at the right of the address bar, or open the browser menu and choose <em>Install Personal AI</em>.
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

export function Unlock(props: { error?: string; onSubmit: (pin: string) => void }) {
  const [value, setValue] = createSignal("")
  return (
    <div class="unlock">
      <form
        class="unlock-card"
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit(value().trim())
          setValue("")
        }}
      >
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>Personal AI</h1>
        <p class="muted">Enter your passcode to open the app.</p>
        <input
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          placeholder="Passcode"
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          autofocus
        />
        <Show when={props.error}>
          <div class="notice error">{props.error}</div>
        </Show>
        <button class="button primary wide" type="submit" disabled={!value().trim()}>
          Unlock
        </button>
      </form>
    </div>
  )
}
