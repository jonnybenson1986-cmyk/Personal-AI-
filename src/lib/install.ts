import { createSignal } from "solid-js"

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const [deferred, setDeferred] = createSignal<InstallPrompt>()
export const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault()
  setDeferred(e as InstallPrompt)
})
window.addEventListener("appinstalled", () => setDeferred(undefined))

export const canInstall = () => !!deferred()

export async function install() {
  const prompt = deferred()
  if (!prompt) return false
  await prompt.prompt()
  await prompt.userChoice
  setDeferred(undefined)
  return true
}
