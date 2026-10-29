// Audio edits as plain functions over channel data (one Float32Array per channel), so they
// can be tested without a browser. Selections are in samples: [start, end).

export interface Clip {
  rate: number
  channels: Float32Array[]
}

export const clipLength = (c: Clip) => c.channels[0]?.length ?? 0
export const duration = (c: Clip) => clipLength(c) / c.rate

function clampRange(c: Clip, start: number, end: number): [number, number] {
  const n = clipLength(c)
  const a = Math.max(0, Math.min(n, Math.round(Math.min(start, end))))
  const b = Math.max(0, Math.min(n, Math.round(Math.max(start, end))))
  return [a, b]
}

const map = (c: Clip, fn: (data: Float32Array) => Float32Array): Clip => ({ rate: c.rate, channels: c.channels.map(fn) })

/** Keeps only the selection. */
export function trim(c: Clip, start: number, end: number): Clip {
  const [a, b] = clampRange(c, start, end)
  return map(c, (d) => d.slice(a, b))
}

/** Removes the selection and joins what's either side. */
export function cut(c: Clip, start: number, end: number): Clip {
  const [a, b] = clampRange(c, start, end)
  return map(c, (d) => {
    const out = new Float32Array(d.length - (b - a))
    out.set(d.subarray(0, a), 0)
    out.set(d.subarray(b), a)
    return out
  })
}

export function insertSilence(c: Clip, at: number, seconds: number): Clip {
  const [a] = clampRange(c, at, at)
  const gap = Math.round(seconds * c.rate)
  return map(c, (d) => {
    const out = new Float32Array(d.length + gap)
    out.set(d.subarray(0, a), 0)
    out.set(d.subarray(a), a + gap)
    return out
  })
}

/** Linear fade over the range: "in" rises from silence, "out" falls to it. */
export function fade(c: Clip, start: number, end: number, direction: "in" | "out"): Clip {
  const [a, b] = clampRange(c, start, end)
  const span = Math.max(1, b - a)
  return map(c, (d) => {
    const out = d.slice()
    for (let i = a; i < b; i++) {
      const t = (i - a) / span
      out[i] *= direction === "in" ? t : 1 - t
    }
    return out
  })
}

/** Changes volume over the range by `db` decibels (clipped to ±1). */
export function gain(c: Clip, start: number, end: number, db: number): Clip {
  const [a, b] = clampRange(c, start, end)
  const k = Math.pow(10, db / 20)
  return map(c, (d) => {
    const out = d.slice()
    for (let i = a; i < b; i++) out[i] = Math.max(-1, Math.min(1, out[i] * k))
    return out
  })
}

export function peak(c: Clip, start = 0, end = clipLength(c)) {
  const [a, b] = clampRange(c, start, end)
  let max = 0
  for (const d of c.channels) for (let i = a; i < b; i++) max = Math.max(max, Math.abs(d[i]))
  return max
}

/** Scales the range so its loudest sample reaches `target` (0.98 ≈ -0.2 dBFS). */
export function normalize(c: Clip, start: number, end: number, target = 0.98): Clip {
  const p = peak(c, start, end)
  if (p === 0) return c
  return gain(c, start, end, 20 * Math.log10(target / p))
}

export function reverse(c: Clip, start: number, end: number): Clip {
  const [a, b] = clampRange(c, start, end)
  return map(c, (d) => {
    const out = d.slice()
    out.subarray(a, b).reverse()
    return out
  })
}

/** Plays faster (factor > 1) or slower, like changing tape speed (pitch moves with it). */
export function changeSpeed(c: Clip, factor: number): Clip {
  const n = clipLength(c)
  const length = Math.max(1, Math.round(n / factor))
  return map(c, (d) => {
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const x = i * factor
      const j = Math.floor(x)
      const f = x - j
      out[i] = (d[j] ?? 0) * (1 - f) + (d[j + 1] ?? d[j] ?? 0) * f
    }
    return out
  })
}

/** Mixes down to one channel. */
export function toMono(c: Clip): Clip {
  if (c.channels.length < 2) return c
  const n = clipLength(c)
  const out = new Float32Array(n)
  for (const d of c.channels) for (let i = 0; i < n; i++) out[i] += d[i] / c.channels.length
  return { rate: c.rate, channels: [out] }
}

/** Joins clips one after another (all must share the sample rate). */
export function append(a: Clip, b: Clip): Clip {
  const count = Math.max(a.channels.length, b.channels.length)
  const pick = (c: Clip, i: number) => c.channels[Math.min(i, c.channels.length - 1)]
  return {
    rate: a.rate,
    channels: Array.from({ length: count }, (_, i) => {
      const x = pick(a, i)
      const y = pick(b, i)
      const out = new Float32Array(x.length + y.length)
      out.set(x, 0)
      out.set(y, x.length)
      return out
    }),
  }
}

/** 16-bit PCM WAV, interleaved. */
export function encodeWav(c: Clip): Uint8Array {
  const channels = c.channels.length
  const frames = clipLength(c)
  const bytes = 44 + frames * channels * 2
  const buf = new ArrayBuffer(bytes)
  const v = new DataView(buf)
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)))
  text(0, "RIFF")
  v.setUint32(4, bytes - 8, true)
  text(8, "WAVE")
  text(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, channels, true)
  v.setUint32(24, c.rate, true)
  v.setUint32(28, c.rate * channels * 2, true)
  v.setUint16(32, channels * 2, true)
  v.setUint16(34, 16, true)
  text(36, "data")
  v.setUint32(40, frames * channels * 2, true)
  let at = 44
  for (let i = 0; i < frames; i++)
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, c.channels[ch][i]))
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      at += 2
    }
  return new Uint8Array(buf)
}

/** Min/max pairs per pixel column, for drawing the waveform. */
export function waveform(c: Clip, columns: number, start = 0, end = clipLength(c)) {
  const out: [number, number][] = []
  const d = toMono(c).channels[0] ?? new Float32Array()
  const span = Math.max(1, end - start)
  for (let x = 0; x < columns; x++) {
    const a = start + Math.floor((x * span) / columns)
    const b = Math.max(a + 1, start + Math.floor(((x + 1) * span) / columns))
    let lo = 0
    let hi = 0
    for (let i = a; i < b && i < d.length; i++) {
      if (d[i] < lo) lo = d[i]
      if (d[i] > hi) hi = d[i]
    }
    out.push([lo, hi])
  }
  return out
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(2).padStart(5, "0")}`
}
