import { createSignal, type JSX, Show } from "solid-js"
import { canChat, catalog, gatewayError, refreshCatalog, refreshStatus } from "../lib/catalog"
import { DEFAULT_SELECTION, GATEWAY_AUTO } from "../lib/models"
import { GATEWAYS, gatewayKind, gatewayPreset, type GatewayKind } from "../lib/gateways"
import { gatewayReady, gatewayRoute, isThisDevice, siteGateway, sitePasscode } from "../lib/route"
import { unlockPaid } from "../lib/providers"
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

/** Picks which gateway the address is; each fills in its usual address and starts on its own models. */
export function GatewayPicker() {
  const kind = () => gatewayKind(settings.omnirouteUrl, settings.gateway)
  return (
    <div class="field">
      <span>Gateway</span>
      <Segmented<GatewayKind>
        value={kind()}
        options={(Object.keys(GATEWAYS) as GatewayKind[]).map((k) => ({ value: k, label: GATEWAYS[k].label }))}
        onChange={(next) => {
          if (next === kind()) return
          const preset = GATEWAYS[next]
          updateSettings({ provider: "omniroute", gateway: next, omnirouteUrl: preset.url, omnirouteKey: "", models: preset.auto ? [{ id: GATEWAY_AUTO }] : [] })
          void refreshStatus(settings)
        }}
      />
    </div>
  )
}

export function CheaperInferenceSetup() {
  const [testing, setTesting] = createSignal(false)
  const [result, setResult] = createSignal<string>()
  const preset = GATEWAYS.cheaper
  return <section class="ai-box">
    <h3>Cheaper Inference · direct connection</h3>
    <p class="small-text">Connect from your phone with no OmniRoute server to install. Requests use your Cheaper Inference account and may incur charges.</p>
    <p class="small-text"><code>{preset.url}</code></p>
    <KeyField label="Cheaper Inference API key" hint={preset.keyHint} placeholder={preset.keyPlaceholder} value={settings.omnirouteKey} onSave={(omnirouteKey) => { updateSettings({ omnirouteKey }); setResult(undefined) }} />
    <button class="button" disabled={testing() || !settings.omnirouteKey.trim()} onClick={async () => {
      setTesting(true)
      setResult(undefined)
      try {
        updateSettings({ provider: "omniroute" })
        await refreshStatus(settings)
        setResult(gatewayError() || (catalog().length ? `Catalog connected: ${catalog().length} chat models. Choose a model and send a message to verify inference.` : "No chat models returned by this account."))
      } finally { setTesting(false) }
    }}>{testing() ? "Testing…" : "Test Cheaper Inference"}</button>
    <Show when={result()}><p class="notice small-text" role="status">{result()}</p></Show>
    <p class="small-text muted">Chat, Code, Design and Cowork share this connection. Photo, Audio and Video require models and endpoints supported by your account. Search, page reading, OCR, music and OmniRoute usage require an OmniRoute server.</p>
  </section>
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

function OmniRouteFields(props: { onSave: (patch: Partial<Settings>) => void }) {
  const [testing, setTesting] = createSignal(false)
  const [result, setResult] = createSignal<string>()
  const route = () => gatewayRoute(settings.omnirouteUrl)
  const preset = () => gatewayPreset(settings.omnirouteUrl, settings.gateway)
  async function test() {
    setTesting(true)
    setResult(undefined)
    const count = await refreshCatalog(settings)
    setResult(count ? `Connected: ${count} model${count === 1 ? "" : "s"} available.` : undefined)
    setTesting(false)
  }
  return (
    <>
      <GatewayPicker />
      <Show when={preset().kind !== "cheaper"} fallback={<CheaperInferenceSetup />}>
      <Show when={preset().kind === "freellmapi"}>
        <p class="muted small-text">
          FreeLLMAPI pools free tiers from many providers behind one OpenAI-compatible endpoint, with its own fallback chain. It runs on your computer
          (Docker, or its desktop app); add provider keys in its dashboard at http://localhost:3001. It's meant for personal use, and each provider's
          terms still apply. Search, page reading, OCR and music in Omni need OmniRoute.
        </p>
      </Show>
      <Show when={preset().kind === "omniroute"}>
      <p class="muted small-text">
        OmniRoute is a free AI gateway you run yourself. It connects many providers' free tiers behind one endpoint, with automatic fallback.
        Install it with <code>npm install -g omniroute</code>, run <code>omniroute</code>, and connect providers in its dashboard.
      </p>
      <Show when={siteGateway()}>
        <p class="notice small-text">This site has its own OmniRoute gateway set up on Netlify. Leave the address blank to use it, or enter your own.</p>
      </Show>
      </Show>
      <label class="field">
        <span>{preset().label} address</span>
        <small>{preset().urlHint}</small>
        <input
          class="text-input"
          type="url"
          inputmode="url"
          autocapitalize="off"
          spellcheck={false}
          placeholder={preset().url || "https://your-tunnel.trycloudflare.com"}
          value={settings.omnirouteUrl}
          onChange={(e) => props.onSave({ omnirouteUrl: e.currentTarget.value.trim() })}
        />
      </label>
      <Show when={isIOS() && isThisDevice(settings.omnirouteUrl)}>
        <div class="notice error">
          localhost means this iPhone itself, and {preset().label} can't run on an iPhone, so this address can't work here. Use the https address of a cloud server, or of a
          tunnel on the computer running it (see Omni → Set up). Until then, the free AI answers when {preset().label} can't be reached.
        </div>
      </Show>
      <Show when={route()?.mode === "direct" && !(isIOS() && isThisDevice(settings.omnirouteUrl))}>
        <div class="notice">
          This address is reached straight from your browser, so {preset().label} must allow this site
          <Show when={preset().corsEnv} fallback={<> (its CORS setting must include {location.origin})</>}>
            {(env) => (
              <>
                : start it with <code>{env()}={location.origin}</code>
              </>
            )}
          </Show>
          . To use it from your phone, use a tunnel's https address instead.
        </div>
      </Show>
      <KeyField
        label={`${preset().label} API key`}
        hint={preset().keyHint}
        placeholder={preset().keyPlaceholder}
        value={settings.omnirouteKey}
        onSave={(omnirouteKey) => props.onSave({ omnirouteKey })}
      />
      <div class="inline">
        <button class="button ghost" disabled={testing() || !gatewayReady(settings.omnirouteUrl, settings.omnirouteKey)} onClick={() => void test()}>
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
            { value: "openrouter", label: "OpenRouter" },
            { value: "omniroute", label: "Your gateway" },
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
              Free open models (Gemma, Nemotron, MiniMax and more) work with no setup. Add your own OpenRouter key to also use every other
              model (GPT, Claude, Gemini, Grok and hundreds more): those are billed to your OpenRouter account, the free ones stay free.
            </p>
            <KeyField
              label="OpenRouter key"
              hint="openrouter.ai → Settings → API Keys → Create. Free models need no card; for paid ones add credit at openrouter.ai → Credits. Saved only on this device."
              placeholder="sk-or-…"
              value={settings.openrouterKey}
              onSave={(openrouterKey) => save({ openrouterKey })}
            />
            <p class="small-text key-status">
              Status: <strong>{canChat() ? "ready" : "add a key to start"}</strong>
            </p>
            <Show when={sitePasscode() && !settings.openrouterKey.trim()}>
              <PaidUnlock />
            </Show>
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
