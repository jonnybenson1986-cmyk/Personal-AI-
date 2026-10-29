import assert from "node:assert/strict"
import { test } from "node:test"
import { designDocument, designRequest, designSummary, designSystem, extractDesign, findKind } from "../src/lib/design.ts"

test("instructions fit the design type", () => {
  assert.match(designSystem(findKind("social")), /fixed 1080×1080 pixel canvas/)
  assert.match(designSystem(findKind("landing")), /responsive web page/)
  assert.match(designSystem(findKind("logo")), /```svg/)
  assert.doesNotMatch(designSystem(findKind("logo")), /```html/)
  assert.equal(findKind("nope").id, "landing")
})

test("edits send the current design back", () => {
  assert.equal(designRequest(findKind("poster"), "jazz night"), "Design this poster: jazz night")
  const edit = designRequest(findKind("poster"), "make it blue", "<!doctype html><p>x</p>")
  assert.match(edit, /```html\n<!doctype html><p>x<\/p>\n```/)
  assert.match(edit, /Change it: make it blue/)
})

test("the design is read from fenced or bare replies, even mid-stream", () => {
  const html = "<!doctype html><html><body>Hi</body></html>"
  assert.equal(extractDesign("Here you go:\n```html\n" + html + "\n```\nA bold page.", "html"), html)
  assert.equal(extractDesign("```\n" + html + "\n```", "html"), html)
  assert.equal(extractDesign(html, "html"), html)
  assert.equal(extractDesign("```html\n<!doctype html><html><body><h1>Hal", "html"), "<!doctype html><html><body><h1>Hal")
  assert.equal(extractDesign("Sorry, I can't.", "html"), undefined)
  const svg = '<svg viewBox="0 0 512 512"><circle r="9"/></svg>'
  assert.equal(extractDesign("```svg\n" + svg + "\n```", "svg"), svg)
  assert.equal(extractDesign("```xml\n<?xml version='1.0'?>\n" + svg + "\n```", "svg"), svg)
})

test("summary and SVG preview page", () => {
  assert.equal(designSummary("```html\nx\n```\nA warm, minimal page.\nMore"), "A warm, minimal page.")
  assert.equal(designSummary("no code"), undefined)
  assert.match(designDocument("<svg/>", "svg"), /<body><svg\/><\/body>/)
  assert.equal(designDocument("<p/>", "html"), "<p/>")
})
