import { createSignal } from "solid-js"

export type View = "chat" | "code" | "design" | "cowork" | "agents" | "image" | "audio" | "omni"

export const VIEWS: { id: View; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "code", label: "Code" },
  { id: "design", label: "Design" },
  { id: "cowork", label: "Cowork" },
  { id: "agents", label: "Agents" },
  { id: "image", label: "Photo" },
  { id: "audio", label: "Audio" },
  { id: "omni", label: "Omni" },
]

function initial(): View {
  try {
    const saved = localStorage.getItem("personal-ai:view")
    return VIEWS.some((v) => v.id === saved) ? (saved as View) : "chat"
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
