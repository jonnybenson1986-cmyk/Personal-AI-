import { createSignal, type JSX, Show } from "solid-js"
import { canChat, catalog, gatewayError, refreshCatalog, refreshStatus } from "../lib/catalog"
import { DEFAULT_SELECTION, GATEWAY_AUTO } from "../lib/models"
import { gatewayRoute } from "../lib/route"
import { isIOS } from "../lib/install"
import { clearAll, settings, updateSettings } from "../lib/store"
import type { Provider, Settings } from "../lib/types"
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

function OmniRouteFields(props: { onSave: (patch: Partial<Settings>) => void }) {
  const [testing, setTesting] = createSignal(false)
  const [result, setResult] = createSignal<string>()
  const route = () => gatewayRoute(settings.omnirouteUrl)
  async function test() {
    setTesting(true)
    setResult(undefined)
    const count = await refreshCatalog(settings)
    setResult(count ? `Connected: ${count} model${count === 1 ? "" : "s"} available.` : undefined)
    setTesting(false)
  }
  return (
    <>
      <p class="muted small-text">
        OmniRoute is a free AI gateway you run yourself. It connects many providers' free tiers behind one endpoint, with automatic fallback.
        Install it with <code>npm install -g omniroute</code>, run <code>omniroute</code>, and connect providers in its dashboard.
      </p>
      <label class="field">
        <span>OmniRoute address</span>
        <small>
          From your phone: turn on the Cloudflare tunnel in OmniRoute's Dashboard → Endpoints and paste its https address. On the computer running it:
          http://localhost:20128.
        </small>
        <input
          class="text-input"
          type="url"
          inputmode="url"
          autocapitalize="off"
          spellcheck={false}
          placeholder="https://your-tunnel.trycloudflare.com"
          value={settings.omnirouteUrl}
          onChange={(e) => props.onSave({ omnirouteUrl: e.currentTarget.value.trim() })}
        />
      </label>
      <Show when={route()?.mode === "direct"}>
        <div class="notice">
          This address is reached straight from your browser, so OmniRoute must allow this site. Start it with{" "}
          <code>CORS_ALLOWED_ORIGINS={location.origin}</code>. To use it from your phone, use the tunnel's https address instead.
        </div>
      </Show>
      <KeyField
        label="OmniRoute API key"
        hint="OmniRoute Dashboard → Endpoints → copy an API key. Saved only on this device."
        placeholder="Your OmniRoute key"
        value={settings.omnirouteKey}
        onSave={(omnirouteKey) => props.onSave({ omnirouteKey })}
      />
      <div class="inline">
        <button class="button ghost" disabled={testing() || !settings.omnirouteUrl || !settings.omnirouteKey} onClick={() => void test()}>
          {testing() ? "Testing…" : "Test connection"}
        </button>
        <span class="small-text key-status">
          <Show when={result()} fallback={<Show when={gatewayError()}>{(e) => <span class="error-text">{e()}</span>}</Show>}>
            {result()}
          </Show>
        </span>
      </div>
      <Show when={!result() && !gatewayError() && catalog().length > 1}>
        <p class="small-text key-status">{catalog().length} models available.</p>
      </Show>
    </>
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
      <div class="field">
        <span>AI provider</span>
        <Segmented<Provider>
          value={settings.provider}
          options={[
            { value: "openrouter", label: "OpenRouter (free)" },
            { value: "omniroute", label: "OmniRoute" },
          ]}
          onChange={(provider) => {
            // Model names differ between providers, so start each one on its own auto model.
            updateSettings({ provider, models: provider === "omniroute" ? [{ id: GATEWAY_AUTO }] : DEFAULT_SELECTION })
            void refreshStatus(settings)
          }}
        />
      </div>
      <Show
        when={settings.provider === "omniroute"}
        fallback={
          <>
            <p class="muted small-text">
              Free open models (Gemma, Nemotron, MiniMax and more) through OpenRouter. A free OpenRouter key is all it needs.
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
          </>
        }
      >
        <OmniRouteFields onSave={save} />
      </Show>
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
          keys are only used for the request and never stored.{settings.provider === "omniroute" ? " Needs a public https:// OmniRoute address; a local one works only while the app is open." : ""}
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
