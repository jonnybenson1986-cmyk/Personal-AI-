// AI image and audio features. Image generation/editing, transcription and AI voices come
// from the user's OmniRoute gateway (OpenRouter's free models can't do them). Describing a
// photo and turning plain-English instructions into edits work with any chat model.
import { toFile } from "openai"
import { gatewayMediaModels } from "./models"
import { client, lastGatewayModels, listModels, streamChat } from "./providers"
import { gatewayReady } from "./route"
import { settings } from "./store"

export const hasGateway = () => settings.provider === "omniroute" && gatewayReady(settings.omnirouteUrl, settings.omnirouteKey)

/** OmniRoute's image/speech/transcription models; loads the model list if it hasn't been. */
export async function mediaModels() {
  if (!hasGateway()) return { image: [], speech: [], transcription: [] }
  // listModels keeps the full list; load it now if the picker hasn't yet.
  if (!lastGatewayModels.length) await listModels(settings).catch(() => undefined)
  return gatewayMediaModels(lastGatewayModels)
}

function needGateway() {
  if (!hasGateway()) throw new Error("This needs your OmniRoute gateway. Choose it in Settings → AI provider.")
}

async function imageResult(data: { b64_json?: string | null; url?: string | null }[] | undefined) {
  const first = data?.[0]
  if (first?.b64_json) return new Blob([Uint8Array.from(atob(first.b64_json), (c) => c.charCodeAt(0))], { type: "image/png" })
  if (first?.url) return (await fetch(first.url)).blob()
  throw new Error("The image model returned no image.")
}

export async function generateImage(prompt: string, model: string, size = "1024x1024") {
  needGateway()
  const res = await client(settings).images.generate({ model, prompt, size: size as "1024x1024", response_format: "b64_json" } as never)
  return imageResult((res as { data?: { b64_json?: string; url?: string }[] }).data)
}

export async function editImage(image: Blob, prompt: string, model: string) {
  needGateway()
  const res = await client(settings).images.edit({ model, prompt, image: await toFile(image, "image.png", { type: image.type || "image/png" }), response_format: "b64_json" } as never)
  return imageResult((res as { data?: { b64_json?: string; url?: string }[] }).data)
}

export async function transcribe(audio: Blob, model: string) {
  needGateway()
  const res = await client(settings).audio.transcriptions.create({ model, file: await toFile(audio, "audio.wav", { type: audio.type || "audio/wav" }) })
  return (res as { text: string }).text
}

export async function speak(text: string, model: string, voice = "alloy") {
  needGateway()
  const res = await client(settings).audio.speech.create({ model, input: text, voice: voice as "alloy" })
  return new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") ?? "audio/mpeg" })
}

/** One complete answer from the current chat model (no streaming UI needed). */
export async function ask(system: string, user: string | { type: string; [k: string]: unknown }[], signal?: AbortSignal) {
  let text = ""
  await streamChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user as string },
    ],
    model: settings.models[0],
    credentials: settings,
    signal: signal ?? new AbortController().signal,
    events: { text: (d) => (text += d), thinking: () => {}, servedBy: () => {} },
  })
  return text
}
