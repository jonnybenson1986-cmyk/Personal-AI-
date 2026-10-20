import { createSignal, Show } from "solid-js"
import { canvas, download, previewDocument, setCanvas } from "../lib/canvas"
import { canPreview, fileExtension } from "../lib/markdown"
import { IconCopy, IconDownload, IconExternal, IconX } from "./icons"

/** Side panel that runs HTML/SVG from a reply in a sandboxed frame, or shows the code. */
export function Canvas() {
  const [tab, setTab] = createSignal<"preview" | "code">("preview")
  const doc = () => canvas()!
  const previewable = () => canPreview(doc().lang, doc().code)
  const filename = () => `${doc().title.replace(/[^\w-]+/g, "-").toLowerCase() || "code"}.${fileExtension(doc().lang)}`
  return (
    <Show when={canvas()}>
      <aside class="canvas" aria-label="Canvas">
        <div class="canvas-head">
          <div class="segmented">
            <Show when={previewable()}>
              <button class={tab() === "preview" ? "on" : ""} onClick={() => setTab("preview")}>
                Preview
              </button>
            </Show>
            <button class={tab() === "code" || !previewable() ? "on" : ""} onClick={() => setTab("code")}>
              Code
            </button>
          </div>
          <span class="spacer" />
          <Show when={previewable()}>
            <button
              class="icon-button"
              title="Open in new tab"
              aria-label="Open in new tab"
              onClick={() => window.open(URL.createObjectURL(new Blob([previewDocument(doc())], { type: "text/html" })), "_blank", "noopener")}
            >
              <IconExternal />
            </button>
          </Show>
          <button class="icon-button" title="Copy" aria-label="Copy code" onClick={() => navigator.clipboard.writeText(doc().code)}>
            <IconCopy />
          </button>
          <button class="icon-button" title="Download" aria-label="Download" onClick={() => download(filename(), doc().code)}>
            <IconDownload />
          </button>
          <button class="icon-button" aria-label="Close canvas" onClick={() => setCanvas(undefined)}>
            <IconX />
          </button>
        </div>
        <Show
          when={previewable() && tab() === "preview"}
          fallback={
            <pre class="canvas-code">
              <code>{doc().code}</code>
            </pre>
          }
        >
          {/* No allow-same-origin: the page can run scripts but can't touch this app or its storage. */}
          <iframe class="canvas-frame" title="Preview" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcdoc={previewDocument(doc())} />
        </Show>
      </aside>
    </Show>
  )
}
