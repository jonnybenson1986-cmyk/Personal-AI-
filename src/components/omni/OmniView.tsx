import { createMemo, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { get, set } from "idb-keyval"
import { refreshCatalog } from "../../lib/catalog"
import { download } from "../../lib/canvas"
import { DETACH } from "../../lib/jobs"
import { renderMarkdown } from "../../lib/markdown"
import { GATEWAY_AUTO } from "../../lib/models"
import { isIOS } from "../../lib/device"
import {
  cloudEnv,
  cloudSteps,
  connectSteps,
  decisionLabel,
  FREE_PROVIDERS,
  mediaItems,
  mediaType,
  OMNI_LOCAL,
  OMNI_REPO,
  OMNI_SITE,
  ocrText,
  ROUTING_MODES,
  type SearchHit,
  searchHits,
  SETUP_OPTIONS,
  usageSummary,
} from "../../lib/omni"
import { makeMusic, makeVideo, omniConfigured, omniModels, omniStatus, omniUsage, readDocument, readPage, resumeOmni, webSearch } from "../../lib/omniapi"
import { gatewayRoute, siteGateway } from "../../lib/route"
import { settings, updateSettings } from "../../lib/store"
import { Segmented } from "../Dialogs"
import { IconCopy, IconDownload, IconFile, IconGlobe, IconHub, IconMenu, IconMusic, IconSearch, IconStop, IconTrash, IconVideo } from "../icons"

type Tab = "setup" | "tools" | "providers"
type Kind = "search" | "page" | "video" | "music" | "ocr"

interface Media {
  blob?: Blob
  url?: string
  type: string
}

interface Item {
  id: string
  kind: Kind
  input: string
  status: "running" | "done" | "error" | "stopped"
  /** The server job, while it runs there. */
  job?: string
  error?: string
  at: number
  hits?: SearchHit[]
  answer?: string
  title?: string
  text?: string
  media?: Media[]
}

const KEY = "omni:state"
const KINDS: { id: Kind; label: string; icon: () => ReturnType<typeof IconSearch> }[] = [
  { id: "search", label: "Web search", icon: IconSearch },
  { id: "page", label: "Read a page", icon: IconGlobe },
  { id: "video", label: "Make a video", icon: IconVideo },
  { id: "music", label: "Make music", icon: IconMusic },
  { id: "ocr", label: "Read text", icon: IconFile },
]

function toBlob(b64: string, type: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

function CopyBlock(props: { code: string }) {
  const [copied, setCopied] = createSignal(false)
  return (
    <div class="omni-code">
      <pre>{props.code}</pre>
      <button
        class="icon-button"
        aria-label="Copy"
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(props.code).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied() ? "✓" : <IconCopy />}
      </button>
    </div>
  )
}

export default function OmniView(props: { onMenu: () => void }) {
  const [tab, setTab] = createSignal<Tab>(omniConfigured() ? "tools" : "setup")
  const [state, setState] = createStore<{ items: Item[] }>({ items: [] })
  const [loaded, setLoaded] = createSignal(false)
  const controllers = new Map<string, AbortController>()

  const save = () => loaded() && void set(KEY, structuredClone(unwrap(state))).catch(() => {})
  const edit = (id: string, fn: (i: Item) => void) => {
    setState("items", (i) => i.id === id, produce(fn))
    save()
  }

  onMount(async () => {
    const saved = await get<{ items: Item[] }>(KEY).catch(() => undefined)
    if (saved?.items) setState(reconcile({ items: saved.items }))
    setLoaded(true)
    for (const item of state.items) {
      if (item.status !== "running") continue
      // Work that ran on the server carries on; work that ran in the app ended with it.
      if (item.job) {
        const job = item.job
        void follow(item.id, (signal) => resumeOmni(job, signal))
      } else edit(item.id, (i) => Object.assign(i, { status: "stopped", error: "Interrupted when the app closed." }))
    }
  })
  // Leaving the screen stops watching; server jobs still finish and are picked up next time.
  onCleanup(() => controllers.forEach((c) => c.abort(DETACH)))

  async function follow(id: string, run: (signal: AbortSignal, onJob: (job: string) => void) => Promise<unknown>) {
    const controller = new AbortController()
    controllers.set(id, controller)
    try {
      const result = await run(controller.signal, (job) => edit(id, (i) => (i.job = job)))
      const kind = state.items.find((i) => i.id === id)?.kind
      edit(id, (i) => {
        i.status = "done"
        i.job = undefined
        if (kind === "search") Object.assign(i, searchHits(result))
        else if (kind === "page") Object.assign(i, result as { title: string; text: string })
        else if (kind === "ocr") i.text = ocrText(result)
        else
          i.media = mediaItems(result).map((m) => {
            const type = mediaType(m.format, kind === "video" ? "video/mp4" : "audio/mpeg")
            return m.b64_json ? { blob: toBlob(m.b64_json, type), type } : { url: m.url, type }
          })
        if (kind !== "search" && kind !== "page" && kind !== "ocr" && !i.media?.length) Object.assign(i, { status: "error", error: "Nothing was generated. Try another model." })
      })
    } catch (e) {
      if (controller.signal.reason === DETACH) return
      const stopped = controller.signal.aborted
      edit(id, (i) => {
        i.job = undefined
        i.status = stopped ? "stopped" : "error"
        if (!stopped) i.error = e instanceof Error ? e.message : String(e)
      })
    } finally {
      controllers.delete(id)
    }
  }

  function start(kind: Kind, input: string, run: (signal: AbortSignal, onJob: (job: string) => void) => Promise<unknown>) {
    const id = crypto.randomUUID()
    setState("items", (list) => [{ id, kind, input, status: "running" as const, at: Date.now() }, ...list])
    save()
    void follow(id, run)
  }

  const connected = () => omniConfigured()
  const [status, { refetch }] = createResource(
    () => (connected() ? `${settings.omnirouteUrl}|${settings.omnirouteKey}` : undefined),
    () => omniStatus().catch((e: Error) => ({ error: e.message })),
  )

  return (
    <div class="tool-view omni-view">
      <header class="topbar tool-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <strong class="tool-title">Omni</strong>
        <span class="omni-status small-text">
          <Show when={connected()} fallback={<span class="muted">OmniRoute not connected</span>}>
            <Show when={status()} fallback={<span class="muted">Checking…</span>}>
              {(s) => (
                <Show when={!("error" in s())} fallback={<span class="error-text">Can't reach OmniRoute</span>}>
                  <span class="ok-dot" /> Connected · {(s() as { models: number }).models} models
                </Show>
              )}
            </Show>
          </Show>
        </span>
      </header>
      <div class="tabs-row omni-tabs" role="tablist">
        <For each={[["setup", "Set up"], ["tools", "Tools"], ["providers", "Providers & routing"]] as [Tab, string][]}>
          {([id, label]) => (
            <button role="tab" aria-selected={tab() === id} classList={{ on: tab() === id }} onClick={() => setTab(id)}>
              {label}
            </button>
          )}
        </For>
      </div>
      <div class="tool-body omni-body">
        <Switch>
          <Match when={tab() === "setup"}>
            <Setup status={status()} onTest={refetch} />
          </Match>
          <Match when={tab() === "tools"}>
            <Tools start={start} />
            <Show when={state.items.length}>
              <h3 class="omni-h">Results</h3>
              <For each={state.items}>
                {(item) => (
                  <ResultCard
                    item={item}
                    onStop={() => controllers.get(item.id)?.abort()}
                    onRemove={() => {
                      controllers.get(item.id)?.abort()
                      setState("items", (list) => list.filter((i) => i.id !== item.id))
                      save()
                    }}
                  />
                )}
              </For>
            </Show>
          </Match>
          <Match when={tab() === "providers"}>
            <Providers />
          </Match>
        </Switch>
      </div>
    </div>
  )
}

const CLOUD = { id: "cloud", label: "iPhone / cloud", hint: "No computer needed: a cloud server you set up from your phone" }

function Setup(props: { status: { models: number; version?: string } | { error: string } | undefined; onTest: () => void }) {
  // An iPhone can't run OmniRoute itself, so it starts on the cloud option.
  const [device, setDevice] = createSignal(isIOS() ? CLOUD.id : SETUP_OPTIONS[0].id)
  // Fresh secrets for this visit, made on the device.
  const cloud = cloudEnv((n) => crypto.getRandomValues(new Uint8Array(n)))
  const options = [CLOUD, ...SETUP_OPTIONS]
  const option = () => (device() === CLOUD.id ? { ...CLOUD, steps: cloudSteps(cloud.env) } : SETUP_OPTIONS.find((o) => o.id === device())!)
  const [usage, setUsage] = createSignal<ReturnType<typeof usageSummary> | { error: string }>()
  const route = () => gatewayRoute(settings.omnirouteUrl)
  const steps = createMemo(() => connectSteps(location.origin))
  return (
    <>
      <section class="ai-box">
        <h3>What OmniRoute is</h3>
        <p class="small-text">
          A free, open-source AI gateway (MIT) that you run yourself. It puts hundreds of AI providers, many with free tiers, behind one address, and switches between
          them automatically when one is busy or runs out. Jonny's AI connects to it for chat, code, design, photos, audio, and the tools here.{" "}
          <a href={OMNI_SITE} target="_blank" rel="noopener">
            omniroute.online
          </a>{" "}
          ·{" "}
          <a href={OMNI_REPO} target="_blank" rel="noopener">
            GitHub
          </a>
        </p>
      </section>

      <section class="ai-box">
        <h3>1. Install and start it</h3>
        <p class="small-text muted">Where will OmniRoute run?</p>
        <div class="chips">
          <For each={options}>
            {(o) => (
              <button class="chip" classList={{ on: device() === o.id }} title={o.hint} onClick={() => setDevice(o.id)}>
                {o.label}
              </button>
            )}
          </For>
        </div>
        <p class="small-text muted">{option().hint}</p>
        <Show when={device() === CLOUD.id}>
          <p class="small-text">
            An iPhone can't run OmniRoute itself: it needs a server that stays on. Either put it on a cloud host (below), or run it on a computer you leave on (the
            Computer option) and reach it from your iPhone through its Cloudflare tunnel.
          </p>
        </Show>
        <ol class="omni-steps">
          <For each={option().steps}>
            {(s) => (
              <li>
                <strong>{s.title}</strong>
                <Show when={s.text}>
                  <p class="small-text">{s.text}</p>
                </Show>
                <Show when={s.code}>{(code) => <CopyBlock code={code()} />}</Show>
              </li>
            )}
          </For>
        </ol>
      </section>

      <section class="ai-box">
        <h3>2. Set it up</h3>
        <ol class="omni-steps">
          <For each={steps()}>
            {(s) => (
              <li>
                <strong>{s.title}</strong>
                <Show when={s.text}>
                  <p class="small-text">{s.text}</p>
                </Show>
                <Show when={s.code}>{(code) => <CopyBlock code={code()} />}</Show>
              </li>
            )}
          </For>
        </ol>
      </section>

      <section class="ai-box">
        <h3>3. Connect</h3>
        <Show when={siteGateway()}>
          <p class="notice small-text">This site has its own OmniRoute gateway set up on Netlify. Leave the address blank to use it, or enter your own.</p>
        </Show>
        <label class="field">
          <span>OmniRoute address</span>
          <input
            class="text-input"
            type="url"
            inputmode="url"
            autocapitalize="off"
            spellcheck={false}
            placeholder={`https://….trycloudflare.com or ${OMNI_LOCAL}`}
            value={settings.omnirouteUrl}
            onChange={(e) => updateSettings({ omnirouteUrl: e.currentTarget.value.trim() })}
          />
        </label>
        <Show when={route()?.mode === "direct"}>
          <p class="notice small-text">
            A local address works only on the device running OmniRoute, while this app is open, and OmniRoute must allow this site (CORS_ALLOWED_ORIGINS above).
          </p>
        </Show>
        <label class="field">
          <span>OmniRoute API key</span>
          <input
            class="text-input"
            type="password"
            autocomplete="off"
            placeholder="From Dashboard → API Keys"
            value={settings.omnirouteKey}
            onChange={(e) => updateSettings({ omnirouteKey: e.currentTarget.value.trim() })}
          />
        </label>
        <div class="ai-row">
          <button class="button" disabled={!omniConfigured()} onClick={props.onTest}>
            Test connection
          </button>
          <span class="small-text">
            <Show when={omniConfigured() && props.status}>
              {(s) =>
                "error" in s() ? (
                  <span class="error-text">{(s() as { error: string }).error}</span>
                ) : (
                  <>
                    Connected: {(s() as { models: number }).models} models{(s() as { version?: string }).version ? ` · OmniRoute ${(s() as { version?: string }).version}` : ""}
                  </>
                )
              }
            </Show>
          </span>
        </div>
        <div class="ai-row">
          <Show
            when={settings.provider === "omniroute"}
            fallback={
              <button
                class="button primary"
                disabled={!omniConfigured()}
                onClick={() => {
                  updateSettings({ provider: "omniroute", models: [{ id: GATEWAY_AUTO }] })
                  void refreshCatalog(settings)
                }}
              >
                Use OmniRoute for all AI
              </button>
            }
          >
            <span class="small-text">
              OmniRoute is your AI provider. <span class="muted">Switch back in Settings → AI provider.</span>
            </span>
          </Show>
        </div>
        <p class="small-text muted">The address and key are saved only on this device, and are the same ones as in Settings.</p>
      </section>

      <section class="ai-box">
        <h3>Usage</h3>
        <div class="ai-row">
          <button class="button" disabled={!omniConfigured()} onClick={() => void omniUsage().then((u) => setUsage(usageSummary(u)), (e: Error) => setUsage({ error: e.message }))}>
            Check usage
          </button>
        </div>
        <Show when={usage()}>
          {(u) => (
            <Show when={!("error" in u())} fallback={<p class="error-text small-text">{(u() as { error: string }).error}</p>}>
              <Show
                when={(u() as { allowed: boolean }).allowed}
                fallback={<p class="small-text">{(u() as { message?: string }).message ?? "Usage isn't allowed for this key."}</p>}
              >
                <ul class="small-text">
                  <For each={(u() as { lines: string[] }).lines}>{(l) => <li>{l}</li>}</For>
                  <Show when={(u() as { providers: string[] }).providers.length}>
                    <li>Providers: {(u() as { providers: string[] }).providers.join(", ")}</li>
                  </Show>
                </ul>
                <Show when={!(u() as { lines: string[] }).lines.length}>
                  <p class="small-text muted">No spending recorded for this key yet. Detailed charts are in OmniRoute's dashboard.</p>
                </Show>
              </Show>
            </Show>
          )}
        </Show>
      </section>
    </>
  )
}

function Tools(props: { start: (kind: Kind, input: string, run: (signal: AbortSignal, onJob: (job: string) => void) => Promise<unknown>) => void }) {
  const [kind, setKind] = createSignal<Kind>("search")
  const [text, setText] = createSignal("")
  const [searchType, setSearchType] = createSignal<"web" | "news">("web")
  const [seconds, setSeconds] = createSignal(15)
  const [instrumental, setInstrumental] = createSignal(false)
  const [file, setFile] = createSignal<File>()
  const [model, setModel] = createSignal("")
  const [models] = createResource(
    () => (omniConfigured() && (kind() === "video" || kind() === "music") ? kind() : undefined),
    (k) => omniModels(k),
  )
  const chosenModel = () => model() || models()?.[0] || ""
  const ready = () =>
    omniConfigured() && (kind() === "ocr" ? !!file() : !!text().trim()) && (kind() === "video" || kind() === "music" ? !!chosenModel() : true)

  function go() {
    const input = text().trim()
    const k = kind()
    if (k === "search") props.start(k, input, (signal) => webSearch(input, { type: searchType() }, signal))
    else if (k === "page") {
      const url = /^https?:\/\//i.test(input) ? input : `https://${input}`
      props.start(k, url, (signal) => readPage(url, signal))
    } else if (k === "video") {
      const m = chosenModel()
      props.start(k, input, (signal, onJob) => makeVideo(input, m, signal, onJob))
    } else if (k === "music") {
      const m = chosenModel()
      const s = seconds()
      const inst = instrumental()
      props.start(k, input, (signal, onJob) => makeMusic(input, m, s, inst, signal, onJob))
    } else {
      const f = file()!
      props.start(k, f.name, (signal, onJob) => readDocument(f, undefined, signal, onJob))
      setFile(undefined)
    }
    if (k !== "ocr") setText("")
  }

  return (
    <section class="ai-box">
      <Show when={!omniConfigured()}>
        <p class="notice small-text">These tools use your OmniRoute gateway. Connect it under Set up first.</p>
      </Show>
      <div class="chips">
        <For each={KINDS}>
          {(k) => (
            <button
              class="chip"
              classList={{ on: kind() === k.id }}
              onClick={() => {
                setKind(k.id)
                setModel("")
              }}
            >
              {k.icon()} {k.label}
            </button>
          )}
        </For>
      </div>
      <Switch>
        <Match when={kind() === "search"}>
          <p class="small-text muted">Searches the web with the search providers connected in OmniRoute (Tavily, Brave, Exa, Serper, Jina…).</p>
          <Segmented<"web" | "news">
            value={searchType()}
            options={[
              { value: "web", label: "Web" },
              { value: "news", label: "News" },
            ]}
            onChange={setSearchType}
          />
        </Match>
        <Match when={kind() === "page"}>
          <p class="small-text muted">Turns any web page into clean text with OmniRoute's page readers (Firecrawl, Jina Reader, Tavily…), even ones this site can't open.</p>
        </Match>
        <Match when={kind() === "video" || kind() === "music"}>
          <p class="small-text muted">
            {kind() === "video" ? "Creates a short video" : "Creates a song or sound"} with the {kind()} models connected in OmniRoute. It can take a few minutes, and keeps
            going if you close the app.
          </p>
          <Show when={models() && !models()!.length}>
            <p class="notice small-text">No {kind()} models are connected in OmniRoute yet. Add a provider that makes {kind() === "video" ? "videos" : "music"} in its dashboard.</p>
          </Show>
          <Show when={models()?.length}>
            <label class="field">
              <span>Model</span>
              <select class="text-input" value={chosenModel()} onChange={(e) => setModel(e.currentTarget.value)}>
                <For each={models()}>{(m) => <option value={m}>{m}</option>}</For>
              </select>
            </label>
          </Show>
          <Show when={kind() === "music"}>
            <div class="ai-row">
              <label class="small-text">
                Length: {seconds()} s <input type="range" min="5" max="120" step="5" value={seconds()} onInput={(e) => setSeconds(Number(e.currentTarget.value))} />
              </label>
              <label class="small-text">
                <input type="checkbox" checked={instrumental()} onChange={(e) => setInstrumental(e.currentTarget.checked)} /> Instrumental
              </label>
            </div>
          </Show>
        </Match>
        <Match when={kind() === "ocr"}>
          <p class="small-text muted">Reads the text in a PDF, scan or photo (OmniRoute's OCR, Mistral OCR by default), as Markdown.</p>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.currentTarget.files?.[0])} />
        </Match>
      </Switch>
      <Show when={kind() !== "ocr"}>
        <form
          class="ai-row"
          // Addresses without https:// are fine: they're completed when sent.
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (ready()) go()
          }}
        >
          <Show
            when={kind() === "video" || kind() === "music"}
            fallback={
              <input
                class="text-input"
                type={kind() === "page" ? "url" : "search"}
                placeholder={kind() === "page" ? "https://example.com/article" : "What do you want to find?"}
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
              />
            }
          >
            <textarea
              class="text-input"
              rows={3}
              placeholder={kind() === "video" ? "A drone shot over a misty forest at sunrise" : "Upbeat lo-fi beat with soft piano, for studying"}
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
            />
          </Show>
          <button class="button primary" type="submit" disabled={!ready()}>
            {kind() === "search" ? "Search" : kind() === "page" ? "Read" : "Create"}
          </button>
        </form>
      </Show>
      <Show when={kind() === "ocr"}>
        <div class="ai-row">
          <button class="button primary" disabled={!ready()} onClick={go}>
            Read text
          </button>
        </div>
      </Show>
    </section>
  )
}

function ResultCard(props: { item: Item; onStop: () => void; onRemove: () => void }) {
  const item = () => props.item
  const kind = () => KINDS.find((k) => k.id === item().kind)!
  const urls = createMemo(() => {
    const list = (item().media ?? []).map((m) => (m.blob ? URL.createObjectURL(m.blob) : m.url!))
    onCleanup(() => list.forEach((u) => u.startsWith("blob:") && URL.revokeObjectURL(u)))
    return list
  })
  const asText = () => {
    const i = item()
    if (i.kind === "search") return [i.answer ? `${i.answer}\n` : "", ...(i.hits ?? []).map((h) => `- [${h.title}](${h.url})\n  ${h.snippet}`)].join("\n")
    return i.text ?? ""
  }
  const baseName = () => item().input.replace(/^https?:\/\//, "").replace(/[^\w-]+/g, "-").slice(0, 40).replace(/-+$/, "") || item().kind
  const saveToCowork = async () => {
    const { writeText, restoreCowork, findFile } = await import("../../lib/coworkspace")
    await restoreCowork()
    let path = `${baseName()}.md`
    for (let n = 2; findFile(path); n++) path = `${baseName()} (${n}).md`
    writeText(path, `# ${item().title ?? item().input}\n\n${asText()}`)
    alert(`Saved to Cowork as ${path}.`)
  }
  return (
    <article class="omni-card">
      <header class="omni-card-head">
        {kind().icon()}
        <div class="omni-card-title">
          <strong>{item().title ?? item().input}</strong>
          <span class="small-text muted">
            {kind().label} · {new Date(item().at).toLocaleString()}
          </span>
        </div>
        <Show when={item().status === "running"}>
          <button class="icon-button" aria-label="Stop" title="Stop" onClick={props.onStop}>
            <IconStop />
          </button>
        </Show>
        <button class="icon-button" aria-label="Remove" title="Remove" onClick={props.onRemove}>
          <IconTrash />
        </button>
      </header>
      <Switch>
        <Match when={item().status === "running"}>
          <p class="small-text shimmer">
            Working…{item().job ? " It keeps going on the server if you close the app." : ""}
          </p>
        </Match>
        <Match when={item().status === "error"}>
          <p class="notice error small-text">{item().error}</p>
        </Match>
        <Match when={item().status === "stopped"}>
          <p class="small-text muted">{item().error ?? "Stopped."}</p>
        </Match>
        <Match when={item().kind === "search"}>
          <Show when={item().answer}>
            <p class="omni-answer">{item().answer}</p>
          </Show>
          <Show when={item().hits?.length} fallback={<p class="small-text muted">No results.</p>}>
            <ol class="omni-hits">
              <For each={item().hits}>
                {(h) => (
                  <li>
                    <a href={h.url} target="_blank" rel="noopener">
                      {h.title}
                    </a>
                    <span class="small-text muted omni-url">{h.url}</span>
                    <p class="small-text">{h.snippet}</p>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </Match>
        <Match when={item().kind === "page" || item().kind === "ocr"}>
          <div class="markdown omni-text" innerHTML={renderMarkdown(item().text || "*No text found.*")} />
        </Match>
        <Match when={item().media?.length}>
          <For each={item().media}>
            {(m, i) =>
              m.type.startsWith("video/") ? (
                <video class="omni-media" src={urls()[i()]} controls playsinline />
              ) : m.type.startsWith("image/") ? (
                <img class="omni-media" src={urls()[i()]} alt={item().input} />
              ) : (
                <audio class="omni-audio" src={urls()[i()]} controls />
              )
            }
          </For>
        </Match>
      </Switch>
      <Show when={item().status === "done"}>
        <div class="ai-row">
          <Show
            when={item().media?.length}
            fallback={
              <>
                <button class="button small-button" onClick={() => void navigator.clipboard?.writeText(asText())}>
                  <IconCopy /> Copy
                </button>
                <button class="button small-button" onClick={() => download(`${baseName()}.md`, asText(), "text/markdown")}>
                  <IconDownload /> Download
                </button>
                <button class="button small-button" onClick={() => void saveToCowork()}>
                  Save to Cowork
                </button>
              </>
            }
          >
            <For each={item().media}>
              {(m, i) => (
                <button
                  class="button small-button"
                  onClick={async () => {
                    const ext = m.type.split("/")[1]?.replace("mpeg", "mp3") ?? "bin"
                    download(`${baseName()}${i() ? `-${i() + 1}` : ""}.${ext}`, m.blob ?? (await (await fetch(m.url!)).blob()))
                  }}
                >
                  <IconDownload /> Download{item().media!.length > 1 ? ` ${i() + 1}` : ""}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </article>
  )
}

function Providers() {
  return (
    <>
      <section class="ai-box">
        <h3>Routing modes</h3>
        <p class="small-text muted">
          Pick these in the model picker when OmniRoute is your AI provider. OmniRoute chooses a provider for every message and moves to the next one if it fails or runs
          out. Each reply shows which provider answered.
        </p>
        <ul class="omni-list">
          <For each={ROUTING_MODES}>
            {(m) => (
              <li>
                <code>{m.id}</code> <strong>{m.label.replace("Auto · ", "")}</strong>
                <span class="small-text muted"> · {m.hint}</span>
              </li>
            )}
          </For>
        </ul>
        <p class="small-text muted">Your own combos, built in OmniRoute's dashboard (Combos), appear in the model picker too.</p>
      </section>
      <section class="ai-box">
        <h3>Free providers to connect</h3>
        <p class="small-text muted">
          Connect them in OmniRoute's dashboard → Providers. Limits are set by each provider and change over time; some need a sign-up or card. OmniRoute supports hundreds
          more (OpenAI, Anthropic, DeepSeek, xAI, local Ollama…).
        </p>
        <div class="omni-table-wrap">
          <table class="cw-table omni-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Free</th>
                <th>Needs</th>
              </tr>
            </thead>
            <tbody>
              <For each={FREE_PROVIDERS}>
                {(p) => (
                  <tr>
                    <td>{p.name}</td>
                    <td>{p.free}</td>
                    <td>{p.connect}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="small-text">
          <a href={`${OMNI_SITE}/providers/`} target="_blank" rel="noopener">
            Full provider list on omniroute.online
          </a>
        </p>
      </section>
      <section class="ai-box">
        <h3>What OmniRoute adds to Jonny's AI</h3>
        <ul class="small-text omni-list">
          <li>Chat, Code, Design and Cowork through any connected provider, with automatic fallback ({decisionLabel("strategy=auto; provider=groq; latency_ms=820")} shown on replies).</li>
          <li>Photo: AI photo edits and new images. Audio: transcription and AI voices.</li>
          <li>Tools here: web search, reading pages, videos, music, and reading text from PDFs and photos.</li>
          <li>Replies and slow jobs keep running on this site's server when the app is closed (with a public https address).</li>
        </ul>
      </section>
    </>
  )
}
