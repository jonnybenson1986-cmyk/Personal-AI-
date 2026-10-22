// AI tools from the + menu. Each adds an instruction in front of the message (kept with the
// turn, so the history the model sees never changes) and can ask the model to think longer.
export interface AiTool {
  id: string
  label: string
  /** Shown in the menu under the label. */
  hint: string
  instruction?: string
  /** Ask reasoning models to spend more effort. */
  reasoning?: boolean
}

/** How the AI should write file changes so the app can push them to GitHub. */
export const EDIT_FORMAT =
  "When you create or change files, give each one in full (never a partial snippet or a diff) in its own fenced code block, with the language and the file's path from the repository root on the opening line, like ```ts path=src/app.ts. Only include files you changed or created. After the files, give a one-line summary of the change that could serve as a commit message."

export const AI_TOOLS: AiTool[] = [
  { id: "think", label: "Think longer", hint: "More careful answers to hard questions", reasoning: true },
  {
    id: "code",
    label: "Write code",
    hint: "Working code with short explanations",
    instruction:
      "Act as an expert programmer. Write complete, working code in fenced code blocks with the language named. For a web page, give one self-contained HTML file. Explain briefly after the code.",
  },
  {
    id: "repo",
    label: "Edit a GitHub repo",
    hint: "Changes you can push to GitHub",
    instruction: "Act as an expert programmer working on the user's code. " + EDIT_FORMAT,
  },
  { id: "summarize", label: "Summarize", hint: "Key points of text, a page or files", instruction: "Summarize the following clearly: start with a one-sentence overview, then the key points as bullets." },
  {
    id: "translate",
    label: "Translate",
    hint: "Into English, or the language you name",
    instruction: "Translate the following. If I name a target language, use it; otherwise translate into English, or into Spanish if it's already English. Reply with only the translation.",
  },
  { id: "explain", label: "Explain simply", hint: "Plain words, no jargon", instruction: "Explain the following in plain, simple words, as if to a smart 12-year-old. Use a short example." },
  { id: "brainstorm", label: "Brainstorm", hint: "Lots of varied ideas", instruction: "Brainstorm at least 10 varied, specific ideas for the following, grouped where it helps. Mark your top 3." },
  {
    id: "improve",
    label: "Improve writing",
    hint: "Clearer, tighter, same meaning",
    instruction: "Rewrite the following to be clearer and more natural while keeping its meaning and tone. Give the improved version, then a short list of the main changes.",
  },
]

export function findTool(id: string | undefined) {
  return AI_TOOLS.find((t) => t.id === id)
}
