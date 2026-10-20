import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/common"
import { Marked } from "marked"

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined
      const html = language ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value
      const label = (lang ?? "").replace(/[^\w+#.-]/g, "")
      const preview = canPreview(label, text) ? `<button type="button" class="code-action" data-action="preview">Preview</button>` : ""
      return `<div class="code" data-lang="${label}"><div class="code-bar"><span>${label || "code"}</span><span class="code-actions">${preview}<button type="button" class="code-action" data-action="download">Download</button><button type="button" class="code-action" data-action="copy">Copy</button></span></div><pre><code class="hljs">${html}</code></pre></div>`
    },
    link({ href, text }) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
})

/** HTML and SVG can run in the canvas preview. */
export function canPreview(lang: string, code: string) {
  return /^(html|svg|xml)$/i.test(lang) || /^\s*(<!doctype html|<html|<svg)/i.test(code)
}

const EXTENSIONS: Record<string, string> = {
  javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", python: "py", py: "py", html: "html", css: "css",
  json: "json", markdown: "md", md: "md", bash: "sh", sh: "sh", shell: "sh", svg: "svg", xml: "xml", yaml: "yml", yml: "yml",
  sql: "sql", go: "go", rust: "rs", java: "java", kotlin: "kt", swift: "swift", c: "c", cpp: "cpp", csharp: "cs", cs: "cs",
  php: "php", ruby: "rb", rb: "rb", toml: "toml",
}

export function fileExtension(lang: string) {
  return EXTENSIONS[lang.toLowerCase()] ?? "txt"
}

export function renderMarkdown(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), { ADD_ATTR: ["target"] })
}
