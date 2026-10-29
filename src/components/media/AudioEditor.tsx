import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { del, get, set } from "idb-keyval"
import {
  append,
  changeSpeed,
  type Clip,
  clipLength,
  cut,
  duration,
  encodeWav,
  fade,
  formatTime,
  gain,
  insertSilence,
  normalize,
  reverse,
  toMono,
  trim,
  waveform,
} from "../../lib/audioops"
import { download } from "../../lib/canvas"
import { hasGateway, mediaModels, speak, transcribe } from "../../lib/media-ai"
import { errorMessage } from "../../lib/providers"
import { IconMenu, IconMic, IconPause, IconPlay, IconRedo, IconScissors, IconUndo } from "../icons"

const SAVE_KEY = "audio:last"
let context: AudioContext | undefined
const audio = () => (context ??= new AudioContext())

async function decode(data: Blob): Promise<Clip> {
  const buffer = await audio().decodeAudioData(await data.arrayBuffer())
  return { rate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()) }
}

function toBuffer(c: Clip) {
  const buffer = audio().createBuffer(c.channels.length, Math.max(1, clipLength(c)), c.rate)
  c.channels.forEach((d, i) => buffer.copyToChannel(d as Float32Array<ArrayBuffer>, i))
  return buffer
}

export default function AudioEditor(props: { onMenu: () => void }) {
  const [clip, setClip] = createSignal<Clip>()
  const [name, setName] = createSignal("recording")
  const [past, setPast] = createSignal<Clip[]>([])
  const [future, setFuture] = createSignal<Clip[]>([])
  const [sel, setSel] = createSignal<[number, number]>()
  const [head, setHead] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [recording, setRecording] = createSignal<MediaRecorder>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal<string>()
  const [transcript, setTranscript] = createSignal<string>()
  const [ttsText, setTtsText] = createSignal("")
  const [voice, setVoice] = createSignal("alloy")
  const [models] = createResource(() => hasGateway() || undefined, () => mediaModels())
  const [ttsModel, setTtsModel] = createSignal("")
  const [sttModel, setSttModel] = createSignal("")
  let canvas!: HTMLCanvasElement
  let picker!: HTMLInputElement
  let adder!: HTMLInputElement
  let source: AudioBufferSourceNode | undefined
  let frame = 0

  createEffect(() => {
    const m = models()
    if (m && !ttsModel()) setTtsModel(m.speech[0] ?? "")
    if (m && !sttModel()) setSttModel(m.transcription[0] ?? "")
  })

  onMount(async () => {
    const saved = await get<{ name: string; wav: Blob }>(SAVE_KEY).catch(() => undefined)
    if (saved && !clip()) {
      setName(saved.name)
      setClip(await decode(saved.wav).catch(() => undefined))
    }
  })
  onCleanup(() => {
    stop()
    recording()?.stop()
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const c = clip()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (c) void set(SAVE_KEY, { name: name(), wav: new Blob([encodeWav(c) as Uint8Array<ArrayBuffer>], { type: "audio/wav" }) }).catch(() => {})
    }, 800)
  })

  /** Applies an edit with undo. With no selection it covers the whole clip. */
  function edit(fn: (c: Clip, a: number, b: number) => Clip, keepSelection = true) {
    const c = clip()
    if (!c) return
    stop()
    const [a, b] = sel() ?? [0, clipLength(c)]
    setPast((p) => [...p.slice(-19), c])
    setFuture([])
    const next = fn(c, a, b)
    setClip(next)
    if (!keepSelection || !sel()) setSel(undefined)
    setHead(Math.min(head(), clipLength(next)))
  }

  function undo() {
    const p = past()
    if (!p.length) return
    stop()
    setFuture((f) => [clip()!, ...f])
    setClip(p[p.length - 1])
    setPast(p.slice(0, -1))
    setSel(undefined)
  }

  function redo() {
    const f = future()
    if (!f.length) return
    stop()
    setPast((p) => [...p, clip()!])
    setClip(f[0])
    setFuture(f.slice(1))
    setSel(undefined)
  }

  async function load(file: Blob, label: string, mode: "replace" | "append" = "replace") {
    setError(undefined)
    try {
      const next = await decode(file)
      stop()
      if (mode === "append" && clip()) {
        const c = clip()!
        const resampled = next.rate === c.rate ? next : changeSpeed({ ...next, rate: c.rate }, next.rate / c.rate)
        setPast((p) => [...p.slice(-19), c])
        setClip(append(c, { ...resampled, rate: c.rate }))
      } else {
        if (clip()) setPast((p) => [...p.slice(-19), clip()!])
        setClip(next)
        setName(label.replace(/\.[^.]+$/, ""))
        setHead(0)
      }
      setFuture([])
      setSel(undefined)
      setTranscript(undefined)
    } catch {
      setError("That file couldn't be opened as audio.")
    }
  }

  async function record() {
    if (recording()) return recording()!.stop()
    setError(undefined)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(undefined)
        void load(new Blob(chunks, { type: recorder.mimeType }), `recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`, clip() ? "append" : "replace")
      }
      recorder.start()
      setRecording(recorder)
    } catch {
      setError("Microphone access was blocked. Allow it in your browser settings to record.")
    }
  }

  function stop() {
    cancelAnimationFrame(frame)
    try {
      source?.stop()
    } catch {
      // Already stopped.
    }
    source = undefined
    setPlaying(false)
  }

  function play() {
    const c = clip()
    if (!c) return
    if (playing()) return stop()
    void audio().resume()
    const [a, b] = sel() ?? [head() >= clipLength(c) ? 0 : head(), clipLength(c)]
    source = audio().createBufferSource()
    source.buffer = toBuffer(c)
    source.connect(audio().destination)
    const started = audio().currentTime
    source.start(0, a / c.rate, (b - a) / c.rate)
    source.onended = () => {
      if (source) stop()
    }
    setPlaying(true)
    const tick = () => {
      setHead(Math.min(b, a + Math.round((audio().currentTime - started) * c.rate)))
      frame = requestAnimationFrame(tick)
    }
    tick()
  }

  // Waveform: computed once per clip and canvas width, redrawn on selection/playhead moves.
  const [width, setWidth] = createSignal(800)
  onMount(() => {
    const observer = new ResizeObserver(() => setWidth(Math.max(200, Math.round(canvas.clientWidth))))
    observer.observe(canvas)
    onCleanup(() => observer.disconnect())
  })
  const peaks = createMemo(() => (clip() ? waveform(clip()!, width()) : []))
  createEffect(() => {
    const c = clip()
    const w = width()
    const dpr = devicePixelRatio || 1
    const h = canvas.clientHeight || 160
    canvas.width = w * dpr
    canvas.height = h * dpr
    const g = canvas.getContext("2d")!
    g.scale(dpr, dpr)
    const style = getComputedStyle(canvas)
    g.clearRect(0, 0, w, h)
    if (!c) return
    const n = clipLength(c) || 1
    const s = sel()
    if (s) {
      g.fillStyle = style.getPropertyValue("--sel") || "rgba(100,103,242,0.18)"
      g.fillRect((s[0] / n) * w, 0, ((s[1] - s[0]) / n) * w, h)
    }
    g.fillStyle = style.getPropertyValue("--wave") || "#6467f2"
    peaks().forEach(([lo, hi], x) => {
      const y1 = h / 2 - hi * (h / 2 - 4)
      const y2 = h / 2 - lo * (h / 2 - 4)
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1))
    })
    g.fillStyle = style.getPropertyValue("--head") || "#e5484d"
    g.fillRect((head() / n) * w, 0, 2, h)
  })

  let dragFrom: number | undefined
  let moved = false
  const sampleAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * clipLength(clip()!))
  }

  async function runTranscribe() {
    const c = clip()
    if (!c) return
    setBusy("Transcribing…")
    setError(undefined)
    try {
      const [a, b] = sel() ?? [0, clipLength(c)]
      const part = trim(toMono(c), a, b)
      setTranscript(await transcribe(new Blob([encodeWav(part) as Uint8Array<ArrayBuffer>], { type: "audio/wav" }), sttModel()))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(undefined)
    }
  }

  async function runSpeak(mode: "replace" | "append") {
    setBusy("Making speech…")
    setError(undefined)
    try {
      await load(await speak(ttsText(), ttsModel(), voice()), "speech", mode)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(undefined)
    }
  }

  const selLabel = () => {
    const c = clip()
    const s = sel()
    if (!c) return ""
    if (!s) return `${formatTime(head() / c.rate)} / ${formatTime(duration(c))}`
    return `Selected ${formatTime(s[0] / c.rate)} – ${formatTime(s[1] / c.rate)} (${((s[1] - s[0]) / c.rate).toFixed(2)}s)`
  }

  return (
    <div class="tool-view">
      <header class="topbar tool-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <strong class="tool-title">Audio</strong>
        <Show when={clip()}>
          <input class="name-input" value={name()} onChange={(e) => setName(e.currentTarget.value || "audio")} aria-label="File name" />
        </Show>
        <span class="spacer" />
        <button class="icon-button" title="Undo" aria-label="Undo" disabled={!past().length} onClick={undo}>
          <IconUndo />
        </button>
        <button class="icon-button" title="Redo" aria-label="Redo" disabled={!future().length} onClick={redo}>
          <IconRedo />
        </button>
        <Show when={clip()}>
          <button class="button primary small-button" onClick={() => download(`${name()}.wav`, new Blob([encodeWav(clip()!) as Uint8Array<ArrayBuffer>], { type: "audio/wav" }))}>
            Export WAV
          </button>
        </Show>
      </header>
      <div class="tool-body audio-body">
        <div class="tool-actions">
          <button class="button ghost" onClick={() => picker.click()}>
            Open audio
          </button>
          <button class={`button ${recording() ? "danger-solid" : "ghost"}`} onClick={() => void record()}>
            <IconMic /> {recording() ? "Stop recording" : clip() ? "Record more" : "Record"}
          </button>
          <Show when={clip()}>
            <button class="button ghost" onClick={() => adder.click()}>
              Add audio to end
            </button>
            <button
              class="button ghost"
              onClick={async () => {
                if (!confirm("Close this audio? Export it first if you want to keep it.")) return
                stop()
                setClip(undefined)
                setPast([])
                setFuture([])
                setSel(undefined)
                await del(SAVE_KEY).catch(() => {})
              }}
            >
              Close
            </button>
          </Show>
          <input ref={picker} type="file" accept="audio/*,video/*" hidden onChange={(e) => e.currentTarget.files?.[0] && void load(e.currentTarget.files[0], e.currentTarget.files[0].name).then(() => (picker.value = ""))} />
          <input ref={adder} type="file" accept="audio/*,video/*" hidden onChange={(e) => e.currentTarget.files?.[0] && void load(e.currentTarget.files[0], name(), "append").then(() => (adder.value = ""))} />
        </div>
        <Show when={error()}>
          <div class="notice error">{error()}</div>
        </Show>
        <div class={`wave-box ${clip() ? "" : "empty"}`}>
          <canvas
            ref={canvas}
            class="wave"
            onPointerDown={(e) => {
              if (!clip()) return
              canvas.setPointerCapture(e.pointerId)
              dragFrom = sampleAt(e)
              moved = false
            }}
            onPointerMove={(e) => {
              if (dragFrom === undefined) return
              const at = sampleAt(e)
              if (Math.abs(at - dragFrom) > clipLength(clip()!) / 400) moved = true
              if (moved) setSel([Math.min(dragFrom, at), Math.max(dragFrom, at)])
            }}
            onPointerUp={(e) => {
              if (dragFrom === undefined) return
              if (!moved) {
                stop()
                setSel(undefined)
                setHead(sampleAt(e))
              }
              dragFrom = undefined
            }}
          />
          <Show when={!clip()}>
            <div class="wave-empty muted">{recording() ? "Recording… tap Stop recording when you're done." : "Open an audio file or record from your microphone."}</div>
          </Show>
        </div>
        <Show when={clip()}>
          <div class="transport">
            <button class="send" aria-label={playing() ? "Pause" : "Play"} onClick={play}>
              {playing() ? <IconPause /> : <IconPlay />}
            </button>
            <span class="small-text transport-time">{selLabel()}</span>
            <Show when={sel()}>
              <button class="code-action" onClick={() => setSel(undefined)}>
                Clear selection
              </button>
            </Show>
          </div>
          <p class="muted small-text">Drag across the waveform to select part of it; tap to move the playhead. Edits apply to the selection, or to everything when nothing is selected.</p>
          <div class="tool-grid">
            <button class="tool-btn" disabled={!sel()} onClick={() => edit(trim, false)}>
              <IconScissors /> Keep selection
            </button>
            <button class="tool-btn" disabled={!sel()} onClick={() => edit(cut, false)}>
              <IconScissors /> Delete selection
            </button>
            <button class="tool-btn" onClick={() => edit((c, a, b) => fade(c, a, b, "in"))}>
              Fade in
            </button>
            <button class="tool-btn" onClick={() => edit((c, a, b) => fade(c, a, b, "out"))}>
              Fade out
            </button>
            <button class="tool-btn" onClick={() => edit((c, a, b) => gain(c, a, b, 3))}>
              Louder (+3 dB)
            </button>
            <button class="tool-btn" onClick={() => edit((c, a, b) => gain(c, a, b, -3))}>
              Quieter (−3 dB)
            </button>
            <button class="tool-btn" onClick={() => edit(normalize)}>
              Normalize
            </button>
            <button class="tool-btn" onClick={() => edit((c, a, b) => gain(c, a, b, -120))}>
              Mute
            </button>
            <button class="tool-btn" onClick={() => edit(reverse)}>
              Reverse
            </button>
            <button class="tool-btn" onClick={() => edit((c) => changeSpeed(c, 1.25), false)}>
              Faster (1.25×)
            </button>
            <button class="tool-btn" onClick={() => edit((c) => changeSpeed(c, 0.8), false)}>
              Slower (0.8×)
            </button>
            <button class="tool-btn" onClick={() => edit((c) => insertSilence(c, sel()?.[0] ?? head(), 1), false)}>
              Insert 1s silence
            </button>
            <Show when={clip()!.channels.length > 1}>
              <button class="tool-btn" onClick={() => edit(toMono)}>
                Make mono
              </button>
            </Show>
          </div>
        </Show>
        <section class="ai-box">
          <h3>AI audio</h3>
          <Show
            when={hasGateway()}
            fallback={<p class="muted small-text">Transcription and AI voices use your OmniRoute gateway. Choose it in Settings → AI provider, with speech models connected there.</p>}
          >
            <Show when={models()} fallback={<p class="muted small-text">Loading OmniRoute's audio models…</p>}>
              {(m) => (
                <>
                  <div class="ai-row">
                    <select class="text-input" value={sttModel()} onChange={(e) => setSttModel(e.currentTarget.value)} aria-label="Transcription model">
                      <For each={m().transcription} fallback={<option value="">No transcription models</option>}>
                        {(id) => <option value={id}>{id}</option>}
                      </For>
                    </select>
                    <button class="button ghost" disabled={!clip() || !sttModel() || !!busy()} onClick={() => void runTranscribe()}>
                      Transcribe {sel() ? "selection" : ""}
                    </button>
                  </div>
                  <Show when={transcript()}>
                    <div class="transcript">
                      <p>{transcript()}</p>
                      <button class="code-action" onClick={() => navigator.clipboard.writeText(transcript()!)}>
                        Copy
                      </button>
                    </div>
                  </Show>
                  <textarea class="text-input" rows={3} placeholder="Type something for an AI voice to say…" value={ttsText()} onInput={(e) => setTtsText(e.currentTarget.value)} />
                  <div class="ai-row">
                    <select class="text-input" value={ttsModel()} onChange={(e) => setTtsModel(e.currentTarget.value)} aria-label="Voice model">
                      <For each={m().speech} fallback={<option value="">No speech models</option>}>
                        {(id) => <option value={id}>{id}</option>}
                      </For>
                    </select>
                    <select class="text-input voice-select" value={voice()} onChange={(e) => setVoice(e.currentTarget.value)} aria-label="Voice">
                      <For each={["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]}>{(v) => <option value={v}>{v}</option>}</For>
                    </select>
                  </div>
                  <div class="ai-row">
                    <button class="button ghost" disabled={!ttsText().trim() || !ttsModel() || !!busy()} onClick={() => void runSpeak("replace")}>
                      Make speech
                    </button>
                    <Show when={clip()}>
                      <button class="button ghost" disabled={!ttsText().trim() || !ttsModel() || !!busy()} onClick={() => void runSpeak("append")}>
                        Add speech to end
                      </button>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          </Show>
          <Show when={busy()}>
            <p class="small-text shimmer">{busy()}</p>
          </Show>
        </section>
      </div>
    </div>
  )
}


