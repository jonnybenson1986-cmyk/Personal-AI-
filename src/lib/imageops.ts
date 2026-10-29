// Photo edits as plain functions over RGBA pixels and simple geometry, so they behave the
// same in every browser (older Safari has no canvas filters) and can be tested in Node.

export interface Adjust {
  /** Percent, 100 = unchanged. */
  brightness: number
  contrast: number
  saturation: number
  /** -100 (cool/blue) to 100 (warm/orange). */
  warmth: number
  /** Degrees, -180 to 180. */
  hue: number
  /** Percent mixes, 0 = none. */
  grayscale: number
  sepia: number
  /** 0 to 100: darkens the corners. */
  vignette: number
  /** Pixels at preview scale, 0 to 20. */
  blur: number
}

export const NEUTRAL: Adjust = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, hue: 0, grayscale: 0, sepia: 0, vignette: 0, blur: 0 }

export const RANGES: Record<keyof Adjust, [number, number]> = {
  brightness: [0, 200],
  contrast: [0, 200],
  saturation: [0, 200],
  warmth: [-100, 100],
  hue: [-180, 180],
  grayscale: [0, 100],
  sepia: [0, 100],
  vignette: [0, 100],
  blur: [0, 20],
}

export const PRESETS: { name: string; adjust: Partial<Adjust> }[] = [
  { name: "Original", adjust: {} },
  { name: "Vivid", adjust: { contrast: 115, saturation: 140, brightness: 104 } },
  { name: "Warm", adjust: { warmth: 35, saturation: 110 } },
  { name: "Cool", adjust: { warmth: -35, contrast: 105 } },
  { name: "Mono", adjust: { grayscale: 100, contrast: 110 } },
  { name: "Noir", adjust: { grayscale: 100, contrast: 150, brightness: 90, vignette: 45 } },
  { name: "Sepia", adjust: { sepia: 85, contrast: 95 } },
  { name: "Fade", adjust: { contrast: 80, saturation: 75, brightness: 110 } },
  { name: "Dramatic", adjust: { contrast: 135, saturation: 85, vignette: 55 } },
]

export const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v))

/** Brightness, contrast, saturation, hue, warmth, grayscale and sepia, in place. */
export function applyColor(data: Uint8ClampedArray, a: Adjust) {
  const b = a.brightness / 100
  const c = a.contrast / 100
  const s = a.saturation / 100
  const g = a.grayscale / 100
  const sp = a.sepia / 100
  const warm = a.warmth * 0.35
  // Hue rotation matrix (luminance-preserving).
  const rad = (a.hue * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ]
  const hue = a.hue !== 0
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let gr = data[i + 1]
    let bl = data[i + 2]
    if (hue) {
      const r2 = r * m[0] + gr * m[1] + bl * m[2]
      const g2 = r * m[3] + gr * m[4] + bl * m[5]
      const b2 = r * m[6] + gr * m[7] + bl * m[8]
      r = r2
      gr = g2
      bl = b2
    }
    r = (r * b - 128) * c + 128
    gr = (gr * b - 128) * c + 128
    bl = (bl * b - 128) * c + 128
    const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * bl
    r = lum + (r - lum) * s
    gr = lum + (gr - lum) * s
    bl = lum + (bl - lum) * s
    if (g) {
      r += (lum - r) * g
      gr += (lum - gr) * g
      bl += (lum - bl) * g
    }
    if (sp) {
      const sr = 0.393 * r + 0.769 * gr + 0.189 * bl
      const sg = 0.349 * r + 0.686 * gr + 0.168 * bl
      const sb = 0.272 * r + 0.534 * gr + 0.131 * bl
      r += (sr - r) * sp
      gr += (sg - gr) * sp
      bl += (sb - bl) * sp
    }
    data[i] = r + warm
    data[i + 1] = gr + warm * 0.25
    data[i + 2] = bl - warm
  }
}

/** Darkens towards the corners, in place. */
export function applyVignette(data: Uint8ClampedArray, width: number, height: number, amount: number) {
  if (!amount) return
  const cx = width / 2
  const cy = height / 2
  const maxD = Math.hypot(cx, cy)
  const k = amount / 100
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD
      const f = 1 - k * Math.max(0, (d - 0.45) / 0.55) ** 1.6
      const i = (y * width + x) * 4
      data[i] *= f
      data[i + 1] *= f
      data[i + 2] *= f
    }
}

/** Box blur (two passes), returns a new buffer. */
export function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  const r = Math.round(radius)
  if (r < 1) return data
  const pass = (src: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(src.length)
    const lines = horizontal ? height : width
    const len = horizontal ? width : height
    for (let line = 0; line < lines; line++)
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0
        const at = (p: number) => (horizontal ? (line * width + p) * 4 : (p * width + line) * 4) + ch
        for (let p = -r; p <= r; p++) sum += src[at(Math.min(len - 1, Math.max(0, p)))]
        for (let p = 0; p < len; p++) {
          out[at(p)] = sum / (2 * r + 1)
          sum += src[at(Math.min(len - 1, p + r + 1))] - src[at(Math.max(0, p - r))]
        }
      }
    return out
  }
  return pass(pass(data, true), false)
}

export interface Crop {
  /** Fractions of the rotated image, 0 to 1. */
  x: number
  y: number
  w: number
  h: number
}

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 }

/** Size of the final image for a source size, rotation, crop and longest-side limit. */
export function outputSize(width: number, height: number, rotate: number, crop: Crop, maxSide = Infinity) {
  const [rw, rh] = rotate % 180 === 0 ? [width, height] : [height, width]
  let w = Math.max(1, Math.round(rw * crop.w))
  let h = Math.max(1, Math.round(rh * crop.h))
  const scale = Math.min(1, maxSide / Math.max(w, h))
  w = Math.max(1, Math.round(w * scale))
  h = Math.max(1, Math.round(h * scale))
  return { width: w, height: h, rotatedWidth: rw, rotatedHeight: rh }
}

/** The largest crop with an aspect ratio (w/h in pixels), centred, inside the rotated image. */
export function aspectCrop(rotatedWidth: number, rotatedHeight: number, ratio: number | undefined): Crop {
  if (!ratio) return FULL
  const imageRatio = rotatedWidth / rotatedHeight
  if (ratio > imageRatio) {
    const h = imageRatio / ratio
    return { x: 0, y: (1 - h) / 2, w: 1, h }
  }
  const w = ratio / imageRatio
  return { x: (1 - w) / 2, y: 0, w, h: 1 }
}

/** Keeps a crop inside the image and at least 2% in each direction. */
export function clampCrop(c: Crop): Crop {
  const w = Math.min(1, Math.max(0.02, c.w))
  const h = Math.min(1, Math.max(0.02, c.h))
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h }
}

/**
 * Reads the adjustments an AI was asked for as JSON, e.g. {"brightness":115,"warmth":20}.
 * Unknown keys are ignored and values are kept in range.
 */
export function parseAdjust(text: string): Partial<Adjust> | undefined {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return undefined
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0])
  } catch {
    return undefined
  }
  const out: Partial<Adjust> = {}
  for (const key of Object.keys(RANGES) as (keyof Adjust)[]) {
    const v = raw[key]
    if (typeof v === "number" && Number.isFinite(v)) out[key] = clamp(v, RANGES[key])
  }
  return Object.keys(out).length ? out : undefined
}

export const AI_ADJUST_PROMPT = `You edit photos by choosing adjustment values. Reply with only a JSON object using any of these keys:
brightness (0-200, 100 = unchanged), contrast (0-200, 100 = unchanged), saturation (0-200, 100 = unchanged),
warmth (-100 cool to 100 warm, 0 = unchanged), hue (-180 to 180 degrees), grayscale (0-100), sepia (0-100),
vignette (0-100), blur (0-20). Give the complete values the photo should have, starting from the current ones.`

export type Turn = "right" | "left" | "flipH" | "flipV"

/** Where a point (fractions of the visible image) ends up after turning or flipping it. */
export function turnPoint([x, y]: [number, number], turn: Turn): [number, number] {
  if (turn === "right") return [1 - y, x]
  if (turn === "left") return [y, 1 - x]
  if (turn === "flipH") return [1 - x, y]
  return [x, 1 - y]
}

/** The same region of the picture after turning or flipping it. */
export function turnCrop(c: Crop, turn: Turn): Crop {
  const [ax, ay] = turnPoint([c.x, c.y], turn)
  const [bx, by] = turnPoint([c.x + c.w, c.y + c.h], turn)
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

/**
 * Rotation and flips, with flips applied on screen after rotating. Turning a flipped
 * picture by 90° swaps which way it's flipped, so the result still looks right.
 */
export function turnGeometry(g: { rotate: number; flipH: boolean; flipV: boolean }, turn: Turn) {
  if (turn === "flipH") return { ...g, flipH: !g.flipH }
  if (turn === "flipV") return { ...g, flipV: !g.flipV }
  return { rotate: (g.rotate + (turn === "right" ? 90 : 270)) % 360, flipH: g.flipV, flipV: g.flipH }
}
