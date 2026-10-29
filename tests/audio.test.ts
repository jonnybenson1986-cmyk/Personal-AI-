import assert from "node:assert/strict"
import { test } from "node:test"
import { append, changeSpeed, clipLength, cut, encodeWav, fade, formatTime, gain, insertSilence, normalize, peak, reverse, toMono, trim, waveform, type Clip } from "../src/lib/audioops.ts"

const clip = (...values: number[]): Clip => ({ rate: 4, channels: [Float32Array.from(values)] })
const arr = (c: Clip, ch = 0) => Array.from(c.channels[ch], (x) => Math.round(x * 1000) / 1000)

test("trim, cut and silence edit the timeline", () => {
  const c = clip(1, 2, 3, 4, 5, 6).channels[0].map((x) => x / 10)
  const base: Clip = { rate: 4, channels: [c] }
  assert.deepEqual(arr(trim(base, 1, 4)), [0.2, 0.3, 0.4])
  assert.deepEqual(arr(cut(base, 1, 4)), [0.1, 0.5, 0.6])
  assert.deepEqual(arr(trim(base, 4, 1)), [0.2, 0.3, 0.4], "a backwards selection works")
  assert.deepEqual(arr(insertSilence(base, 2, 0.5)), [0.1, 0.2, 0, 0, 0.3, 0.4, 0.5, 0.6])
  assert.equal(clipLength(cut(base, -5, 99)), 0)
})

test("fades, gain and normalize change volume", () => {
  const c = clip(1, 1, 1, 1)
  assert.deepEqual(arr(fade(c, 0, 4, "in")), [0, 0.25, 0.5, 0.75])
  assert.deepEqual(arr(fade(c, 0, 4, "out")), [1, 0.75, 0.5, 0.25])
  assert.deepEqual(arr(gain(clip(0.5, 0.5), 0, 2, -6.0206)), [0.25, 0.25])
  assert.deepEqual(arr(gain(clip(0.9), 0, 1, 12)), [1], "clipped to full scale")
  const n = normalize(clip(0.1, -0.25, 0.2), 0, 3)
  assert.equal(Math.round(peak(n) * 100) / 100, 0.98)
  assert.deepEqual(normalize(clip(0, 0), 0, 2), clip(0, 0))
})

test("reverse, speed, mono and append", () => {
  assert.deepEqual(arr(reverse(clip(1, 2, 3, 4), 1, 3)), [1, 3, 2, 4])
  assert.equal(clipLength(changeSpeed(clip(...Array(100).fill(0.5)), 2)), 50)
  assert.equal(clipLength(changeSpeed(clip(...Array(100).fill(0.5)), 0.5)), 200)
  const stereo: Clip = { rate: 4, channels: [Float32Array.from([1, 0]), Float32Array.from([0, 1])] }
  assert.deepEqual(arr(toMono(stereo)), [0.5, 0.5])
  const joined = append(clip(1, 2), stereo)
  assert.equal(joined.channels.length, 2)
  assert.deepEqual(arr(joined, 1), [1, 2, 0, 1])
})

test("WAV export has a correct header and samples", () => {
  const wav = encodeWav({ rate: 8000, channels: [Float32Array.from([0, 1, -1])] })
  const v = new DataView(wav.buffer)
  const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n))
  assert.equal(text(0, 4), "RIFF")
  assert.equal(text(8, 4), "WAVE")
  assert.equal(v.getUint32(24, true), 8000)
  assert.equal(v.getUint16(22, true), 1)
  assert.equal(v.getUint32(40, true), 6)
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32768])
  assert.equal(wav.length, 50)
})

test("waveform columns and time labels", () => {
  assert.deepEqual(waveform(clip(-0.5, 0.5, 0.2, -0.1), 2).map((p) => p.map((x) => Math.round(x * 100) / 100)), [[-0.5, 0.5], [-0.1, 0.2]])
  assert.equal(formatTime(75.5), "1:15.50")
  assert.equal(formatTime(3.25), "0:03.25")
})
