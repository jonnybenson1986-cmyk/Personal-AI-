import { createSignal } from "solid-js"

export type View = "chat" | "code"

function initial(): View {
  try {
    return localStorage.getItem("personal-ai:view") === "code" ? "code" : "chat"
  } catch {
    return "chat"
  }
}

const [view, setViewSignal] = createSignal<View>(initial())
export { view }

export function setView(next: View) {
  setViewSignal(next)
  try {
    localStorage.setItem("personal-ai:view", next)
  } catch {
    // Storage unavailable: the choice lasts for this session.
  }
}
