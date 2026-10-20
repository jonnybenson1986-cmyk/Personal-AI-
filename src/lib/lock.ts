import { settings, updateSettings } from "./store"

// The app lock is a device-level PIN: chats and keys live on this device, so it only has to
// keep someone holding the phone out. It never leaves the device.
const DEFAULT_PIN = "3280"

async function hash(pin: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`personal-ai:${pin}`)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function checkPin(pin: string) {
  return (await hash(pin)) === (settings.pinHash ?? (await hash(DEFAULT_PIN)))
}

export async function setPin(pin: string) {
  updateSettings({ pinHash: await hash(pin) })
}
