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
      return `<div class="code"><div class="code-bar"><span>${label || "code"}</span><button type="button" class="copy-code">Copy</button></div><pre><code class="hljs">${html}</code></pre></div>`
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

export function renderMarkdown(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), { ADD_ATTR: ["target"] })
}
