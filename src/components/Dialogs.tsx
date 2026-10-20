import { createSignal, type JSX, Show } from "solid-js"
import { isIOS } from "../lib/install"
import { clearAll, settings, updateSettings } from "../lib/store"
import type { Effort, Settings } from "../lib/types"
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

export function SettingsDialog(props: { onClose: () => void; onSignOut: () => void }) {
  return (
    <Modal title="Settings" onClose={props.onClose}>
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
        <span>Thinking effort</span>
        <small>How hard the models think before answering. Higher is slower and costs more.</small>
        <Segmented<Effort>
          value={settings.effort}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
          onChange={(effort) => updateSettings({ effort })}
        />
      </div>
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
        <button class="button ghost" onClick={props.onSignOut}>
          Lock app
        </button>
      </div>
      <p class="muted small-text">Chats are stored in this browser only. API keys stay on your Netlify server and never reach the browser.</p>
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

export function Unlock(props: { error?: string; busy: boolean; onSubmit: (passcode: string) => void }) {
  const [value, setValue] = createSignal(settings.passcode)
  return (
    <div class="unlock">
      <form
        class="unlock-card"
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit(value().trim())
        }}
      >
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>Personal AI</h1>
        <p class="muted">Enter the passcode you set as APP_PASSCODE on Netlify.</p>
        <input type="password" autocomplete="current-password" placeholder="Passcode" value={value()} onInput={(e) => setValue(e.currentTarget.value)} autofocus />
        <Show when={props.error}>
          <div class="notice error">{props.error}</div>
        </Show>
        <button class="button primary wide" type="submit" disabled={!value().trim() || props.busy}>
          {props.busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  )
}
