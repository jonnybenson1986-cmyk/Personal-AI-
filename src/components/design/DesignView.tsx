import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { get, set } from "idb-keyval"
import { download } from "../../lib/canvas"
import { designDocument, designRequest, designSummary, designSystem, extractDesign, findKind, KINDS } from "../../lib/design"
import { DETACH } from "../../lib/jobs"
import { errorMessage, isAbort, type JobHooks, resumeChat, streamChat } from "../../lib/providers"
import { settings } from "../../lib/store"
import { IconMenu, IconPalette, IconSend, IconStop, IconTrash } from "../icons"

interface Version {
  prompt: string
  code: string
  summary?: string
  at: number
}

interface Design {
  id: string
  title: string
  kind: string
  versions: Version[]
  current: number
  /** A version being made on the server, picked up again if the app was closed meanwhile. */
  pending?: { job: string; prompt: string }
}

interface State {
  designs: Design[]
  active?: string
}

const KEY = "design:state"
const VIEWPORTS: [string, number][] = [
  ["Phone", 390],
  ["Tablet", 820],
  ["Desktop", 1280],
]

/** Renders a design to PNG in a hidden same-origin frame with scripts off, then snapshots it. */
async function toPng(doc: string, width: number, height?: number) {
  const { toBlob } = await import("html-to-image")
  const frame = document.createElement("iframe")
  frame.setAttribute("sandbox", "allow-same-origin")
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height ?? 900}px;border:0;`
  document.body.append(frame)
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve()
      frame.srcdoc = doc
    })
    const d = frame.contentDocument!
    await d.fonts?.ready
    const h = height ?? Math.max(d.documentElement.scrollHeight, d.body.scrollHeight)
    frame.style.height = `${h}px`
    await new Promise((r) => setTimeout(r, 150))
    const blob = await toBlob(d.documentElement, { width, height: h, pixelRatio: 1, cacheBust: true })
    if (!blob) throw new Error("Couldn't render the image.")
    return blob
  } finally {
    frame.remove()
  }
}

export default function DesignView(props: { onMenu: () => void }) {
  const [state, setState] = createStore<State>({ designs: [] })
  const [kindId, setKindId] = createSignal(KINDS[0].id)
  const [input, setInput] = createSignal("")
  const [streaming, setStreaming] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [viewport, setViewport] = createSignal(390)
  const [exporting, setExporting] = createSignal(false)
  const [scale, setScale] = createSignal(1)
  let stage!: HTMLDivElement
  let controller: AbortController | undefined

  // Saving starts only once the saved designs have loaded, so they can't be overwritten.
  const [loaded, setLoaded] = createSignal(false)
  onMount(async () => {
    const saved = await get<State>(KEY).catch(() => undefined)
    if (saved?.designs) setState(reconcile(saved))
    setLoaded(true)
    const waiting = state.designs.find((d) => d.pending)
    if (waiting) {
      const { job, prompt } = waiting.pending!
      setState("active", waiting.id)
      void run(waiting.id, findKind(waiting.kind), prompt, (events, signal) => resumeChat(job, settings, events, signal, () => {}))
    }
  })
  // Leaving the Design screen stops watching; a reply on the server still finishes.
  onCleanup(() => controller?.abort(DETACH))
  createEffect(() => {
    const snapshot = JSON.parse(JSON.stringify(state))
    if (loaded()) void set(KEY, snapshot).catch(() => {})
  })

  const design = () => state.designs.find((d) => d.id === state.active)
  const kind = () => findKind(design()?.kind ?? kindId())
  const version = () => design()?.versions[design()!.current]
  const frameWidth = () => kind().size?.[0] ?? viewport()
  const frameHeight = () => kind().size?.[1] ?? 900
  const code = createMemo(() => (streaming() !== undefined ? extractDesign(streaming()!, kind().format) : undefined) ?? version()?.code)

  // Fit the frame to the space available.
  const fit = () => {
    if (!stage) return
    const w = stage.clientWidth - 24
    const h = kind().size ? Math.max(260, Math.min(window.innerHeight * 0.55, stage.clientHeight || 9999)) : Infinity
    setScale(Math.min(1, w / frameWidth(), h / frameHeight()))
  }
  onMount(() => {
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    onCleanup(() => observer.disconnect())
  })
  createEffect(() => {
    frameWidth()
    frameHeight()
    fit()
  })

  // The preview updates at most every 700 ms while the AI is writing.
  const [shown, setShown] = createSignal<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const c = code()
    if (streaming() === undefined) {
      clearTimeout(timer)
      timer = undefined
      setShown(c)
    } else if (!timer)
      timer = setTimeout(() => {
        timer = undefined
        setShown(code())
      }, 700)
  })

  function newDesign() {
    controller?.abort()
    setState("active", undefined)
    setInput("")
    setError(undefined)
  }

  async function generate() {
    const instruction = input().trim()
    if (!instruction || streaming() !== undefined) return
    setError(undefined)
    let d = design()
    const k = kind()
    if (!d) {
      d = { id: crypto.randomUUID(), title: instruction.slice(0, 40), kind: k.id, versions: [], current: -1 }
      setState("designs", (list) => [d!, ...list])
      setState("active", d.id)
    }
    const current = version()?.code
    await run(d.id, k, instruction, (events, signal, job) =>
      streamChat({
        messages: [
          { role: "system", content: designSystem(k) },
          { role: "user", content: designRequest(k, instruction, current) },
        ],
        model: settings.models[0],
        credentials: settings,
        signal,
        events,
        job,
      }),
    )
  }

  /** Makes a new version of a design from a reply, streamed now or picked up from the server. */
  async function run(
    id: string,
    k: ReturnType<typeof findKind>,
    instruction: string,
    start: (events: { text(d: string): void; thinking(d: string): void; servedBy(m: string): void }, signal: AbortSignal, job: JobHooks) => Promise<unknown>,
  ) {
    setStreaming("")
    controller = new AbortController()
    const signal = controller.signal
    const job: JobHooks = { started: (jobId) => setState("designs", (x) => x.id === id, "pending", { job: jobId, prompt: instruction }) }
    try {
      let reply = ""
      await start({ text: (t) => setStreaming((reply += t)), thinking: () => {}, servedBy: () => {} }, signal, job)
      setState("designs", (x) => x.id === id, "pending", undefined)
      const result = extractDesign(reply, k.format)
      if (!result) throw new Error("The AI didn't return a design. Try again, or pick another model.")
      setState(
        "designs",
        (x) => x.id === id,
        produce((x) => {
          x.versions = x.versions.slice(0, x.current + 1)
          x.versions.push({ prompt: instruction, code: result, summary: designSummary(reply), at: Date.now() })
          x.current = x.versions.length - 1
        }),
      )
      setInput("")
    } catch (e) {
      if (signal.reason === DETACH) return
      setState("designs", (x) => x.id === id, "pending", undefined)
      if (!isAbort(e)) setError(errorMessage(e))
      // A first attempt that produced nothing leaves no empty design behind.
      if (!state.designs.find((x) => x.id === id)?.versions.length) {
        setState("designs", (list) => list.filter((x) => x.id !== id))
        setState("active", undefined)
      }
    } finally {
      setStreaming(undefined)
    }
  }

  async function exportAs(type: "png" | "html" | "svg") {
    const v = version()
    if (!v) return
    const name = (design()!.title || "design").replace(/[^\w-]+/g, "-").toLowerCase()
    setExporting(true)
    setError(undefined)
    try {
      if (type === "html") download(`${name}.html`, designDocument(v.code, kind().format), "text/html")
      else if (type === "svg") download(`${name}.svg`, v.code, "image/svg+xml")
      else download(`${name}.png`, await toPng(designDocument(v.code, kind().format), frameWidth(), kind().size?.[1]))
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div class="tool-view">
      <header class="topbar tool-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <strong class="tool-title">Design</strong>
        <Show when={design()}>
          <input class="name-input" value={design()!.title} onChange={(e) => setState("designs", (x) => x.id === state.active, "title", e.currentTarget.value || "Design")} aria-label="Design name" />
        </Show>
        <span class="spacer" />
        <Show when={design()}>
          <button class="button ghost small-button" onClick={newDesign}>
            New
          </button>
        </Show>
      </header>
      <div class="tool-body design-body">
        <Show when={!design()}>
          <div class="tool-actions kind-row">
            <For each={KINDS}>
              {(k) => (
                <button class={`chip ${kindId() === k.id ? "on" : ""}`} onClick={() => setKindId(k.id)}>
                  {k.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="design-stage" ref={stage}>
          <Show
            when={shown()}
            fallback={
              <div class="design-empty">
                <IconPalette />
                <p>{streaming() !== undefined ? "Designing…" : `Describe a ${kind().label.toLowerCase()} and the AI will design it.`}</p>
                <Show when={streaming() === undefined && !design()}>
                  <button class="suggestion-chip" onClick={() => setInput(kind().example)}>
                    Try: {kind().example}
                  </button>
                </Show>
              </div>
            }
          >
            <div class="design-frame" style={{ width: `${frameWidth() * scale()}px`, height: `${frameHeight() * scale()}px` }}>
              <iframe
                title="Design preview"
                sandbox="allow-scripts"
                srcdoc={designDocument(shown()!, kind().format)}
                style={{ width: `${frameWidth()}px`, height: `${frameHeight()}px`, transform: `scale(${scale()})` }}
              />
            </div>
          </Show>
        </div>
        <Show when={!kind().size && shown()}>
          <div class="tool-actions viewport-row">
            <For each={VIEWPORTS}>
              {([label, w]) => (
                <button class={`chip ${viewport() === w ? "on" : ""}`} onClick={() => setViewport(w)}>
                  {label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={streaming() !== undefined}>
          <p class="small-text shimmer">Designing… {Math.round((streaming()?.length ?? 0) / 100) / 10}k characters</p>
        </Show>
        <Show when={error()}>
          <div class="notice error">{error()}</div>
        </Show>
        <form
          class="design-input"
          onSubmit={(e) => {
            e.preventDefault()
            void generate()
          }}
        >
          <textarea
            rows={2}
            placeholder={design() ? "What should change? e.g. “make the heading bigger and the background dark green”" : `Describe your ${kind().label.toLowerCase()}…`}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) {
                e.preventDefault()
                void generate()
              }
            }}
          />
          <Show
            when={streaming() === undefined}
            fallback={
              <button class="send" type="button" aria-label="Stop" onClick={() => controller?.abort()}>
                <IconStop />
              </button>
            }
          >
            <button class="send" type="submit" aria-label={design() ? "Update design" : "Create design"} disabled={!input().trim()}>
              <IconSend />
            </button>
          </Show>
        </form>
        <Show when={version()}>
          <div class="tool-actions">
            <button class="button primary" disabled={exporting()} onClick={() => void exportAs("png")}>
              {exporting() ? "Exporting…" : "Download PNG"}
            </button>
            <Show when={kind().format === "svg"} fallback={<button class="button ghost" onClick={() => void exportAs("html")}>Download HTML</button>}>
              <button class="button ghost" onClick={() => void exportAs("svg")}>
                Download SVG
              </button>
            </Show>
            <button class="button ghost" onClick={() => navigator.clipboard.writeText(version()!.code)}>
              Copy code
            </button>
          </div>
          <section class="versions">
            <h3>Versions</h3>
            <For each={design()!.versions}>
              {(v, i) => (
                <button class={`version-row ${design()!.current === i() ? "on" : ""}`} onClick={() => setState("designs", (x) => x.id === state.active, "current", i())}>
                  <span class="version-no">v{i() + 1}</span>
                  <span class="version-text">
                    {v.prompt}
                    <Show when={v.summary}>
                      <small>{v.summary}</small>
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </section>
        </Show>
        <Show when={state.designs.length}>
          <section class="versions">
            <h3>Your designs</h3>
            <For each={state.designs}>
              {(d) => (
                <div class={`version-row ${state.active === d.id ? "on" : ""}`}>
                  <button class="version-text" onClick={() => setState("active", d.id)}>
                    {d.title}
                    <small>
                      {findKind(d.kind).label} · {d.versions.length} version{d.versions.length === 1 ? "" : "s"}
                    </small>
                  </button>
                  <button
                    class="icon-button small"
                    aria-label={`Delete ${d.title}`}
                    onClick={() => {
                      if (!confirm(`Delete "${d.title}"?`)) return
                      setState("designs", (list) => list.filter((x) => x.id !== d.id))
                      if (state.active === d.id) setState("active", undefined)
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              )}
            </For>
          </section>
        </Show>
      </div>
    </div>
  )
}
