import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { del, get, set } from "idb-keyval"
import { download } from "../../lib/canvas"
import {
  type Adjust,
  AI_ADJUST_PROMPT,
  applyColor,
  applyVignette,
  aspectCrop,
  boxBlur,
  type Crop,
  clampCrop,
  type Turn,
  turnCrop,
  turnGeometry,
  turnPoint,
  FULL,
  NEUTRAL,
  outputSize,
  parseAdjust,
  PRESETS,
  RANGES,
} from "../../lib/imageops"
import { ask, editImage, generateImage, hasGateway, mediaModels } from "../../lib/media-ai"
import { errorMessage } from "../../lib/providers"
import { IconCamera, IconCrop, IconFlip, IconImage, IconMenu, IconPen, IconRedo, IconRotate, IconSparkle, IconText, IconUndo } from "../icons"

type Mark =
  | { kind: "stroke"; color: string; size: number; points: [number, number][] }
  | { kind: "text"; color: string; size: number; x: number; y: number; text: string }

interface Doc {
  src: Blob
  adjust: Adjust
  rotate: number
  flipH: boolean
  flipV: boolean
  crop: Crop
  /** Positions and sizes are fractions of the final (cropped) image. */
  marks: Mark[]
}

type Tab = "adjust" | "filters" | "crop" | "draw" | "text" | "ai"

const SAVE_KEY = "image:last"
const PREVIEW_SIDE = 1400
const ADJUST_LABELS: [keyof Adjust, string][] = [
  ["brightness", "Brightness"],
  ["contrast", "Contrast"],
  ["saturation", "Saturation"],
  ["warmth", "Warmth"],
  ["hue", "Hue"],
  ["grayscale", "Black & white"],
  ["sepia", "Sepia"],
  ["vignette", "Vignette"],
  ["blur", "Blur"],
]
const ASPECTS: [string, number | undefined][] = [
  ["Free", undefined],
  ["Square", 1],
  ["4:5", 4 / 5],
  ["3:2", 3 / 2],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
]

const bitmaps = new WeakMap<Blob, Promise<ImageBitmap>>()
const bitmapOf = (b: Blob) => {
  if (!bitmaps.has(b)) bitmaps.set(b, createImageBitmap(b))
  return bitmaps.get(b)!
}

/** Draws the edited image: rotation/flip, crop, colour, vignette, blur, then drawings and text. */
async function render(doc: Doc, maxSide: number, opts: { full?: boolean } = {}) {
  const bmp = await bitmapOf(doc.src)
  const crop = opts.full ? FULL : doc.crop
  const size = outputSize(bmp.width, bmp.height, doc.rotate, crop, maxSide)
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const g = canvas.getContext("2d", { willReadFrequently: true })!
  const k = size.width / (size.rotatedWidth * crop.w)
  g.save()
  g.scale(k, k)
  g.translate(-crop.x * size.rotatedWidth, -crop.y * size.rotatedHeight)
  g.translate(size.rotatedWidth / 2, size.rotatedHeight / 2)
  // Flips act on the picture as you see it, after rotating.
  g.scale(doc.flipH ? -1 : 1, doc.flipV ? -1 : 1)
  g.rotate((doc.rotate * Math.PI) / 180)
  g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
  g.restore()
  const a = doc.adjust
  if (JSON.stringify(a) !== JSON.stringify(NEUTRAL)) {
    const img = g.getImageData(0, 0, size.width, size.height)
    applyColor(img.data, a)
    applyVignette(img.data, size.width, size.height, a.vignette)
    const data = a.blur ? boxBlur(img.data, size.width, size.height, (a.blur * Math.max(size.width, size.height)) / 1200) : img.data
    g.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size.width, size.height), 0, 0)
  }
  if (!opts.full) drawMarks(g, doc.marks, size.width, size.height)
  return canvas
}

function drawMarks(g: CanvasRenderingContext2D, marks: Mark[], w: number, h: number) {
  for (const m of marks) {
    if (m.kind === "stroke") {
      g.strokeStyle = m.color
      g.lineWidth = Math.max(1, m.size * w)
      g.lineCap = "round"
      g.lineJoin = "round"
      g.beginPath()
      m.points.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)))
      if (m.points.length === 1) g.lineTo(m.points[0][0] * w + 0.1, m.points[0][1] * h)
      g.stroke()
    } else {
      const px = Math.max(8, m.size * w)
      g.font = `700 ${px}px ui-sans-serif, system-ui, sans-serif`
      g.textAlign = "center"
      g.textBaseline = "middle"
      g.lineWidth = px / 8
      g.strokeStyle = m.color === "#ffffff" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)"
      g.strokeText(m.text, m.x * w, m.y * h)
      g.fillStyle = m.color
      g.fillText(m.text, m.x * w, m.y * h)
    }
  }
}

/** Turns or flips the picture, keeping the crop and drawings on the same part of it. */
function turnDoc(d: Doc, turn: Turn): Doc {
  return {
    ...d,
    ...turnGeometry(d, turn),
    crop: turnCrop(d.crop, turn),
    marks: d.marks.map((m): Mark => (m.kind === "stroke" ? { ...m, points: m.points.map((p) => turnPoint(p, turn)) } : { ...m, ...pointXY(turnPoint([m.x, m.y], turn)) })),
  }
}
const pointXY = ([x, y]: [number, number]) => ({ x, y })

const toBlob = (c: HTMLCanvasElement, type = "image/png", quality = 0.92) => new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), type, quality))

export default function ImageEditor(props: { onMenu: () => void }) {
  const [doc, setDoc] = createSignal<Doc>()
  const [name, setName] = createSignal("photo")
  const [past, setPast] = createSignal<Doc[]>([])
  const [future, setFuture] = createSignal<Doc[]>([])
  const [tab, setTab] = createSignal<Tab>("adjust")
  const [draftCrop, setDraftCrop] = createSignal<Crop>(FULL)
  const [aspect, setAspect] = createSignal<number>()
  const [penColor, setPenColor] = createSignal("#ff3b30")
  const [penSize, setPenSize] = createSignal(1.2)
  const [textValue, setTextValue] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal<string>()
  const [instruction, setInstruction] = createSignal("")
  const [description, setDescription] = createSignal<string>()
  const [aiPrompt, setAiPrompt] = createSignal("")
  const [imageModel, setImageModel] = createSignal("")
  const [exportOpen, setExportOpen] = createSignal(false)
  const [format, setFormat] = createSignal<"image/png" | "image/jpeg">("image/jpeg")
  const [maxSide, setMaxSide] = createSignal(0)
  const [models] = createResource(() => hasGateway() || undefined, () => mediaModels())
  let preview!: HTMLCanvasElement
  let stage!: HTMLDivElement
  let picker!: HTMLInputElement
  let camera!: HTMLInputElement

  createEffect(() => {
    const m = models()
    if (m && !imageModel()) setImageModel(m.image[0] ?? "")
  })

  onMount(async () => {
    const saved = await get<{ doc: Doc; name: string }>(SAVE_KEY).catch(() => undefined)
    if (saved?.doc && !doc()) {
      setDoc({ ...saved.doc, adjust: { ...NEUTRAL, ...saved.doc.adjust } })
      setName(saved.name)
    }
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const d = doc()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => d && void set(SAVE_KEY, { doc: d, name: name() }).catch(() => {}), 600)
  })

  /** A change with undo. Slider drags pass `merge` so one drag is one undo step. */
  let lastMerge = ""
  function change(fn: (d: Doc) => Doc, merge?: string) {
    const d = doc()
    if (!d) return
    if (!merge || merge !== lastMerge) {
      setPast((p) => [...p.slice(-29), d])
      setFuture([])
    }
    lastMerge = merge ?? ""
    setDoc(fn(d))
  }

  function undo() {
    const p = past()
    if (!p.length) return
    setFuture((f) => [doc()!, ...f])
    setDoc(p[p.length - 1])
    setPast(p.slice(0, -1))
    lastMerge = ""
  }

  function redo() {
    const f = future()
    if (!f.length) return
    setPast((p) => [...p, doc()!])
    setDoc(f[0])
    setFuture(f.slice(1))
    lastMerge = ""
  }

  function open(file: Blob, label: string) {
    setError(undefined)
    if (!file.type.startsWith("image/")) return setError("That isn't an image.")
    if (doc()) setPast((p) => [...p.slice(-29), doc()!])
    setFuture([])
    setDoc({ src: file, adjust: { ...NEUTRAL }, rotate: 0, flipH: false, flipV: false, crop: FULL, marks: [] })
    setName(label.replace(/\.[^.]+$/, "") || "photo")
    setDescription(undefined)
    setTab("adjust")
  }

  /** Swaps in a new picture (AI result), keeping the old one in undo. */
  function replaceSource(src: Blob) {
    change(() => ({ src, adjust: { ...NEUTRAL }, rotate: 0, flipH: false, flipV: false, crop: FULL, marks: [] }))
  }

  // Preview: re-rendered at most once per frame.
  let frame = 0
  createEffect(() => {
    const d = doc()
    const cropping = tab() === "crop"
    tab()
    cancelAnimationFrame(frame)
    if (!d) return
    frame = requestAnimationFrame(async () => {
      const c = await render(d, PREVIEW_SIDE, { full: cropping })
      preview.width = c.width
      preview.height = c.height
      preview.getContext("2d")!.drawImage(c, 0, 0)
    })
  })
  onCleanup(() => cancelAnimationFrame(frame))

  // Entering crop mode starts from the current crop.
  createEffect(() => {
    if (tab() === "crop" && doc()) setDraftCrop(doc()!.crop)
  })

  const rotatedSize = async () => {
    const d = doc()!
    const bmp = await bitmapOf(d.src)
    return d.rotate % 180 === 0 ? [bmp.width, bmp.height] : [bmp.height, bmp.width]
  }

  // Pointer helpers: fractions of the preview canvas.
  const frac = (e: PointerEvent): [number, number] => {
    const r = preview.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }

  let stroke: Mark | undefined
  function onCanvasDown(e: PointerEvent) {
    if (!doc()) return
    if (tab() === "draw") {
      preview.setPointerCapture(e.pointerId)
      stroke = { kind: "stroke", color: penColor(), size: penSize() / 100, points: [frac(e)] }
      change((d) => ({ ...d, marks: [...d.marks, stroke!] }))
    }
    if (tab() === "text" && textValue().trim()) {
      const [x, y] = frac(e)
      change((d) => ({ ...d, marks: [...d.marks, { kind: "text", color: penColor(), size: penSize() * 4 / 100, x, y, text: textValue().trim() }] }))
    }
  }
  function onCanvasMove(e: PointerEvent) {
    if (!stroke || stroke.kind !== "stroke") return
    stroke.points = [...stroke.points, frac(e)]
    setDoc((d) => d && { ...d, marks: [...d.marks.slice(0, -1), { ...stroke! } as Mark] })
  }
  const onCanvasUp = () => (stroke = undefined)

  // Crop box dragging: "move" or a corner ("nw", "ne", "sw", "se").
  let cropDrag: { mode: string; start: [number, number]; from: Crop; ratio?: number } | undefined
  async function startCrop(e: PointerEvent, mode: string) {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const [w, h] = await rotatedSize()
    // Height fraction per width fraction that keeps the chosen pixel shape.
    cropDrag = { mode, start: frac(e), from: draftCrop(), ratio: aspect() ? w / h / aspect()! : undefined }
  }
  function moveCrop(e: PointerEvent) {
    if (!cropDrag) return
    const [x, y] = frac(e)
    const dx = x - cropDrag.start[0]
    const dy = y - cropDrag.start[1]
    const f = cropDrag.from
    if (cropDrag.mode === "move") return setDraftCrop(clampCrop({ ...f, x: f.x + dx, y: f.y + dy }))
    let { x: cx, y: cy, w, h } = f
    if (cropDrag.mode.includes("e")) w = f.w + dx
    if (cropDrag.mode.includes("s")) h = f.h + dy
    if (cropDrag.mode.includes("w")) {
      cx = f.x + dx
      w = f.w - dx
    }
    if (cropDrag.mode.includes("n")) {
      cy = f.y + dy
      h = f.h - dy
    }
    if (cropDrag.ratio) {
      // Keep the chosen shape: height follows width (in fractions of the image).
      const nh = w * cropDrag.ratio
      if (cropDrag.mode.includes("n")) cy = f.y + f.h - nh
      h = nh
    }
    setDraftCrop(clampCrop({ x: cx, y: cy, w, h }))
  }

  async function pickAspect(ratio: number | undefined) {
    setAspect(ratio)
    const [w, h] = await rotatedSize()
    setDraftCrop(aspectCrop(w, h, ratio))
  }

  async function exportImage() {
    const d = doc()
    if (!d) return
    setBusy("Exporting…")
    try {
      const c = await render(d, maxSide() || Infinity)
      const ext = format() === "image/png" ? "png" : "jpg"
      download(`${name()}-edited.${ext}`, await toBlob(c, format(), 0.92))
      setExportOpen(false)
    } finally {
      setBusy(undefined)
    }
  }

  async function aiAdjust() {
    const d = doc()
    if (!d || !instruction().trim()) return
    setBusy("Asking the AI…")
    setError(undefined)
    try {
      const reply = await ask(AI_ADJUST_PROMPT, `Current values: ${JSON.stringify(d.adjust)}\nRequest: ${instruction().trim()}`)
      const patch = parseAdjust(reply)
      if (!patch) throw new Error("The AI didn't give usable settings. Try rewording, or pick another model.")
      change((x) => ({ ...x, adjust: { ...x.adjust, ...patch } }))
      setInstruction("")
      setTab("adjust")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(undefined)
    }
  }

  async function describe() {
    const d = doc()
    if (!d) return
    setBusy("Looking at the photo…")
    setError(undefined)
    try {
      const small = await render(d, 1024)
      const url = small.toDataURL("image/jpeg", 0.85)
      setDescription(
        await ask("Describe photos clearly and helpfully: what's in it, the mood, and one or two ideas to make it look better.", [
          { type: "image_url", image_url: { url } },
          { type: "text", text: "Describe this photo." },
        ]),
      )
    } catch (e) {
      setError(`${errorMessage(e)} (Describing needs a model that can see images.)`)
    } finally {
      setBusy(undefined)
    }
  }

  async function aiImage(mode: "edit" | "generate") {
    setBusy(mode === "edit" ? "Editing with AI…" : "Creating an image…")
    setError(undefined)
    try {
      if (mode === "edit") replaceSource(await editImage(await toBlob(await render(doc()!, 1536)), aiPrompt(), imageModel()))
      else {
        const result = await generateImage(aiPrompt(), imageModel())
        if (doc()) replaceSource(result)
        else open(result, "ai-image")
      }
      setAiPrompt("")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(undefined)
    }
  }

  const cropStyle = () => {
    const c = draftCrop()
    return { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }
  }

  return (
    <div class="tool-view">
      <header class="topbar tool-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <strong class="tool-title">Photo</strong>
        <Show when={doc()}>
          <input class="name-input" value={name()} onChange={(e) => setName(e.currentTarget.value || "photo")} aria-label="File name" />
        </Show>
        <span class="spacer" />
        <button class="icon-button" title="Undo" aria-label="Undo" disabled={!past().length} onClick={undo}>
          <IconUndo />
        </button>
        <button class="icon-button" title="Redo" aria-label="Redo" disabled={!future().length} onClick={redo}>
          <IconRedo />
        </button>
        <Show when={doc()}>
          <button class="button primary small-button" onClick={() => setExportOpen(!exportOpen())}>
            Export
          </button>
        </Show>
      </header>
      <Show when={exportOpen()}>
        <div class="export-panel">
          <select class="text-input" value={format()} onChange={(e) => setFormat(e.currentTarget.value as "image/png")} aria-label="Format">
            <option value="image/jpeg">JPEG (smaller)</option>
            <option value="image/png">PNG (best quality)</option>
          </select>
          <select class="text-input" value={maxSide()} onChange={(e) => setMaxSide(Number(e.currentTarget.value))} aria-label="Size">
            <option value="0">Full size</option>
            <option value="2048">Large (2048 px)</option>
            <option value="1080">Social (1080 px)</option>
            <option value="640">Small (640 px)</option>
          </select>
          <button class="button primary" disabled={!!busy()} onClick={() => void exportImage()}>
            Download
          </button>
        </div>
      </Show>
      <div class="tool-body photo-body">
        <Show
          when={doc()}
          fallback={
            <div class="photo-empty">
              <IconImage />
              <p class="muted">Open a photo to edit it, or take one with your camera.</p>
              <div class="tool-actions">
                <button class="button primary" onClick={() => picker.click()}>
                  Open photo
                </button>
                <button class="button ghost" onClick={() => camera.click()}>
                  <IconCamera /> Take photo
                </button>
              </div>
            </div>
          }
        >
          <div class="photo-stage" ref={stage}>
            <div class="photo-frame">
              <canvas
                ref={preview}
                class={`photo-canvas ${tab() === "draw" || (tab() === "text" && textValue().trim()) ? "drawing" : ""}`}
                onPointerDown={onCanvasDown}
                onPointerMove={onCanvasMove}
                onPointerUp={onCanvasUp}
                onPointerCancel={onCanvasUp}
              />
              <Show when={tab() === "crop"}>
                <div class="crop-box" style={cropStyle()} onPointerDown={(e) => void startCrop(e, "move")} onPointerMove={moveCrop} onPointerUp={() => (cropDrag = undefined)}>
                  <For each={["nw", "ne", "sw", "se"]}>
                    {(corner) => <span class={`crop-handle ${corner}`} onPointerDown={(e) => void startCrop(e, corner)} onPointerMove={moveCrop} onPointerUp={() => (cropDrag = undefined)} />}
                  </For>
                </div>
              </Show>
            </div>
          </div>
          <div class="tabs-row" role="tablist">
            <For
              each={[
                ["adjust", "Adjust"],
                ["filters", "Filters"],
                ["crop", "Crop"],
                ["draw", "Draw"],
                ["text", "Text"],
                ["ai", "AI"],
              ] as [Tab, string][]}
            >
              {([id, label]) => (
                <button role="tab" class={tab() === id ? "on" : ""} aria-selected={tab() === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              )}
            </For>
          </div>
          <Show when={error()}>
            <div class="notice error">{error()}</div>
          </Show>
          <Show when={busy()}>
            <p class="small-text shimmer">{busy()}</p>
          </Show>
          <Show when={tab() === "adjust"}>
            <div class="sliders">
              <For each={ADJUST_LABELS}>
                {([key, label]) => (
                  <label class="slider">
                    <span>
                      {label} <small class="muted">{doc()!.adjust[key]}</small>
                    </span>
                    <input
                      type="range"
                      min={RANGES[key][0]}
                      max={RANGES[key][1]}
                      value={doc()!.adjust[key]}
                      onInput={(e) => {
                        const v = Number(e.currentTarget.value)
                        change((d) => ({ ...d, adjust: { ...d.adjust, [key]: v } }), `adjust:${key}`)
                      }}
                      onDblClick={() => change((d) => ({ ...d, adjust: { ...d.adjust, [key]: NEUTRAL[key] } }))}
                    />
                  </label>
                )}
              </For>
              <button class="button ghost" onClick={() => change((d) => ({ ...d, adjust: { ...NEUTRAL } }))}>
                Reset adjustments
              </button>
            </div>
          </Show>
          <Show when={tab() === "filters"}>
            <div class="tool-grid">
              <For each={PRESETS}>
                {(p) => (
                  <button class="tool-btn" onClick={() => change((d) => ({ ...d, adjust: { ...NEUTRAL, ...p.adjust } }))}>
                    {p.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={tab() === "crop"}>
            <div class="tool-actions">
              <For each={ASPECTS}>
                {([label, ratio]) => (
                  <button class={`chip ${aspect() === ratio ? "on" : ""}`} onClick={() => void pickAspect(ratio)}>
                    {label}
                  </button>
                )}
              </For>
            </div>
            <div class="tool-actions">
              <button class="tool-btn" onClick={() => {
                  change((d) => turnDoc(d, "left"))
                  setDraftCrop(turnCrop(draftCrop(), "left"))
                }}>
                <IconRotate /> Rotate left
              </button>
              <button class="tool-btn" onClick={() => {
                  change((d) => turnDoc(d, "right"))
                  setDraftCrop(turnCrop(draftCrop(), "right"))
                }}>
                <IconRotate /> Rotate right
              </button>
              <button class="tool-btn" onClick={() => {
                  change((d) => turnDoc(d, "flipH"))
                  setDraftCrop(turnCrop(draftCrop(), "flipH"))
                }}>
                <IconFlip /> Flip
              </button>
              <button class="tool-btn" onClick={() => {
                  change((d) => turnDoc(d, "flipV"))
                  setDraftCrop(turnCrop(draftCrop(), "flipV"))
                }}>
                <IconFlip /> Flip vertical
              </button>
            </div>
            <div class="tool-actions">
              <button
                class="button primary"
                onClick={() => {
                  change((d) => ({ ...d, crop: draftCrop(), marks: [] }))
                  setTab("adjust")
                }}
              >
                <IconCrop /> Apply crop
              </button>
              <button class="button ghost" onClick={() => setDraftCrop(FULL)}>
                Reset
              </button>
            </div>
            <p class="muted small-text">Drag the box to move it, or its corners to resize. Applying a crop clears drawings and text.</p>
          </Show>
          <Show when={tab() === "draw" || tab() === "text"}>
            <Show when={tab() === "text"}>
              <input class="text-input" placeholder="Type text, then tap the photo to place it" value={textValue()} onInput={(e) => setTextValue(e.currentTarget.value)} />
            </Show>
            <div class="tool-actions pen-row">
              <For each={["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#007aff", "#af52de", "#ffffff", "#000000"]}>
                {(c) => <button class={`swatch ${penColor() === c ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setPenColor(c)} />}
              </For>
              <label class="slider small">
                <span>Size</span>
                <input type="range" min="0.3" max="5" step="0.1" value={penSize()} onInput={(e) => setPenSize(Number(e.currentTarget.value))} />
              </label>
            </div>
            <div class="tool-actions">
              <span class="muted small-text">{tab() === "draw" ? "Draw on the photo with your finger or mouse." : ""}</span>
              <Show when={doc()!.marks.length}>
                <button class="button ghost" onClick={() => change((d) => ({ ...d, marks: d.marks.slice(0, -1) }))}>
                  {tab() === "draw" ? <IconPen /> : <IconText />} Remove last
                </button>
                <button class="button ghost" onClick={() => change((d) => ({ ...d, marks: [] }))}>
                  Clear all
                </button>
              </Show>
            </div>
          </Show>
          <Show when={tab() === "ai"}>
            <section class="ai-box">
              <h3>Tell the AI what you want</h3>
              <div class="ai-row">
                <input
                  class="text-input"
                  placeholder='e.g. "brighter and warmer, like golden hour"'
                  value={instruction()}
                  onInput={(e) => setInstruction(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && void aiAdjust()}
                />
                <button class="button primary" disabled={!instruction().trim() || !!busy()} onClick={() => void aiAdjust()}>
                  <IconSparkle /> Apply
                </button>
              </div>
              <button class="button ghost" disabled={!!busy()} onClick={() => void describe()}>
                Describe this photo
              </button>
              <Show when={description()}>
                <div class="transcript">
                  <p>{description()}</p>
                </div>
              </Show>
            </section>
            <section class="ai-box">
              <h3>AI image edit & create</h3>
              <Show
                when={hasGateway()}
                fallback={<p class="muted small-text">Editing a photo with AI and creating new images use your OmniRoute gateway. Choose it in Settings → AI provider, with an image model connected there.</p>}
              >
                <select class="text-input" value={imageModel()} onChange={(e) => setImageModel(e.currentTarget.value)} aria-label="Image model">
                  <For each={models()?.image ?? []} fallback={<option value="">{models() ? "No image models in OmniRoute" : "Loading…"}</option>}>
                    {(id) => <option value={id}>{id}</option>}
                  </For>
                </select>
                <textarea class="text-input" rows={2} placeholder='e.g. "remove the people in the background" or "a cat astronaut, watercolour"' value={aiPrompt()} onInput={(e) => setAiPrompt(e.currentTarget.value)} />
                <div class="ai-row">
                  <button class="button primary" disabled={!aiPrompt().trim() || !imageModel() || !!busy()} onClick={() => void aiImage("edit")}>
                    Edit this photo
                  </button>
                  <button class="button ghost" disabled={!aiPrompt().trim() || !imageModel() || !!busy()} onClick={() => void aiImage("generate")}>
                    Create new image
                  </button>
                </div>
              </Show>
            </section>
          </Show>
          <div class="tool-actions">
            <button class="button ghost" onClick={() => picker.click()}>
              Open another photo
            </button>
            <button
              class="button ghost"
              onClick={async () => {
                if (!confirm("Close this photo? Export it first if you want to keep it.")) return
                setDoc(undefined)
                setPast([])
                setFuture([])
                await del(SAVE_KEY).catch(() => {})
              }}
            >
              Close
            </button>
          </div>
        </Show>
        <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => e.currentTarget.files?.[0] && (open(e.currentTarget.files[0], e.currentTarget.files[0].name), (picker.value = ""))} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.currentTarget.files?.[0] && (open(e.currentTarget.files[0], "camera"), (camera.value = ""))} />
      </div>
    </div>
  )
}
