import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { EditorState, type Extension } from "@codemirror/state"
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { createEffect, on, onCleanup, onMount } from "solid-js"

function language(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (["js", "mjs", "cjs"].includes(ext)) return javascript()
  if (ext === "jsx") return javascript({ jsx: true })
  if (ext === "ts" || ext === "mts") return javascript({ typescript: true })
  if (ext === "tsx") return javascript({ jsx: true, typescript: true })
  if (["css", "scss", "less"].includes(ext)) return css()
  if (["html", "htm", "svg", "xml", "vue", "svelte"].includes(ext)) return html()
  if (["json", "jsonc"].includes(ext)) return json()
  if (["md", "markdown", "mdx"].includes(ext)) return markdown()
  if (ext === "py") return python()
  return []
}

// Colors come from the app's theme variables, so the editor follows light and dark mode.
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--hl-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--hl-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--hl-number)" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className, tags.typeName, tags.heading], color: "var(--hl-title)" },
  { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.variableName)], color: "var(--hl-attr)" },
  { tag: [tags.tagName, tags.angleBracket], color: "var(--hl-keyword)" },
  { tag: tags.link, color: "#2f7fd8", textDecoration: "underline" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
])

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--text)", padding: "8px 0" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--text-3)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(100, 103, 242, 0.25) !important" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)" },
})

/** A code editor for one file. Calls onChange with the full text as it's edited. */
export function Editor(props: { path: string; text: string; onChange: (text: string) => void }) {
  let host!: HTMLDivElement
  let view: EditorView | undefined
  let shownPath = ""

  const create = (path: string, text: string) => {
    view?.destroy()
    shownPath = path
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(highlight),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          language(path),
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => u.docChanged && props.onChange(u.state.doc.toString())),
        ],
      }),
    })
  }

  onMount(() => create(props.path, props.text))
  // A different file, or the same file changed from outside (AI, terminal): reload it.
  // Edits typed here come back as the same text, so they don't.
  createEffect(
    on(
      () => [props.path, props.text] as const,
      ([path, text]) => {
        if (!view || (path === shownPath && view.state.doc.toString() === text)) return
        create(path, text)
      },
      { defer: true },
    ),
  )
  onCleanup(() => view?.destroy())
  return <div class="editor" ref={host} />
}
