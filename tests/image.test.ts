import assert from "node:assert/strict"
import { test } from "node:test"
import { applyColor, applyVignette, aspectCrop, boxBlur, clampCrop, NEUTRAL, outputSize, parseAdjust } from "../src/lib/imageops.ts"

const px = (...rgb: number[]) => Uint8ClampedArray.from(rgb.flatMap((v, i) => (i % 3 === 2 ? [v, 255] : [v])))
const run = (data: Uint8ClampedArray, patch = {}) => (applyColor(data, { ...NEUTRAL, ...patch }), Array.from(data))

test("neutral settings leave pixels unchanged", () => {
  assert.deepEqual(run(px(10, 128, 250, 0, 0, 0)), [10, 128, 250, 255, 0, 0, 0, 255])
})

test("brightness, contrast, saturation and grayscale", () => {
  assert.deepEqual(run(px(100, 100, 100), { brightness: 150 }), [150, 150, 150, 255])
  assert.deepEqual(run(px(150, 150, 150), { contrast: 200 }), [172, 172, 172, 255])
  const gray = run(px(200, 50, 50), { saturation: 0 })
  assert.equal(gray[0], gray[1])
  assert.equal(gray[1], gray[2])
  assert.deepEqual(run(px(200, 50, 50), { grayscale: 100 }), gray)
})

test("warmth pushes towards orange or blue; hue keeps grays gray", () => {
  const [r, , b] = run(px(128, 128, 128), { warmth: 50 })
  assert.ok(r > 128 && b < 128)
  const [r2, , b2] = run(px(128, 128, 128), { warmth: -50 })
  assert.ok(r2 < 128 && b2 > 128)
  const g = run(px(128, 128, 128), { hue: 90 })
  assert.ok(Math.abs(g[0] - 128) <= 1 && Math.abs(g[2] - 128) <= 1)
})

test("vignette darkens corners, not the centre", () => {
  const w = 21
  const h = 21
  const data = new Uint8ClampedArray(w * h * 4).fill(200)
  applyVignette(data, w, h, 100)
  assert.equal(data[(10 * w + 10) * 4], 200)
  assert.ok(data[0] < 60)
})

test("blur spreads a single bright pixel", () => {
  const w = 5
  const data = new Uint8ClampedArray(w * w * 4)
  data[(2 * w + 2) * 4] = 250
  const out = boxBlur(data, w, w, 1)
  assert.ok(out[(2 * w + 2) * 4] < 250)
  assert.ok(out[(2 * w + 1) * 4] > 0)
  assert.equal(boxBlur(data, w, w, 0), data)
})

test("crop and rotation geometry", () => {
  assert.deepEqual(outputSize(4000, 3000, 0, { x: 0, y: 0, w: 1, h: 1 }), { width: 4000, height: 3000, rotatedWidth: 4000, rotatedHeight: 3000 })
  assert.deepEqual(outputSize(4000, 3000, 90, { x: 0, y: 0, w: 0.5, h: 0.5 }, 1000), { width: 750, height: 1000, rotatedWidth: 3000, rotatedHeight: 4000 })
  const square = aspectCrop(4000, 3000, 1)
  assert.deepEqual(square, { x: 0.125, y: 0, w: 0.75, h: 1 })
  const wide = aspectCrop(3000, 3000, 16 / 9)
  assert.equal(Math.round(wide.h * 1000) / 1000, 0.563)
  assert.deepEqual(clampCrop({ x: 0.9, y: -1, w: 0.5, h: 0.001 }), { x: 0.5, y: 0, w: 0.5, h: 0.02 })
})

test("AI adjustment replies are parsed and kept in range", () => {
  assert.deepEqual(parseAdjust('Sure! {"brightness": 120, "warmth": 30, "contrast": 999, "nonsense": 5}'), { brightness: 120, contrast: 200, warmth: 30 })
  assert.equal(parseAdjust("no json here"), undefined)
  assert.equal(parseAdjust("{broken"), undefined)
  assert.equal(parseAdjust('{"foo": 1}'), undefined)
})

test("turning and flipping carry the crop and drawings along", async () => {
  const { turnCrop, turnGeometry, turnPoint } = await import("../src/lib/imageops.ts")
  const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
  const round = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))
  assert.deepEqual(round(turnCrop(crop, "right")), { x: 0.4, y: 0.1, w: 0.4, h: 0.3 })
  assert.deepEqual(round(turnCrop(turnCrop(crop, "right"), "left")), crop)
  assert.deepEqual(round(turnCrop(crop, "flipH")), { x: 0.6, y: 0.2, w: 0.3, h: 0.4 })
  assert.deepEqual(turnPoint([0, 0], "right"), [1, 0])
  assert.deepEqual(turnPoint([1, 0], "left"), [0, 0])
  assert.deepEqual(turnGeometry({ rotate: 0, flipH: true, flipV: false }, "right"), { rotate: 90, flipH: false, flipV: true })
  assert.deepEqual(turnGeometry({ rotate: 270, flipH: false, flipV: false }, "right"), { rotate: 0, flipH: false, flipV: false })
  assert.deepEqual(turnGeometry({ rotate: 90, flipH: false, flipV: false }, "flipV"), { rotate: 90, flipH: false, flipV: true })
})
