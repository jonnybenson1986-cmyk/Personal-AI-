// AI image and audio features, all through OpenRouter (the AI behind the site). Creating and
// editing images and AI voices use OpenRouter's paid image and audio models, so they need paid
// models unlocked (the passcode, or your own key with credit). Transcription has a free model,
// but OpenRouter only takes audio from accounts with at least $0.50 of credit.
// Describing a photo and turning plain-English instructions into edits work with any chat model.
import type OpenAI from "openai"
import { imageFrom, mediaModelsFrom, pcmToWav } from "./mediaops.ts"
import { client, lastOpenRouterModels, listModels, paidModels, streamChat } from "./providers"
import { settings } from "./store"

/** The image and audio models; loads OpenRouter's list if it hasn't been. */
export async function mediaModels() {
  if (!lastOpenRouterModels.length) await listModels(settings).catch(() => undefined)
  return mediaModelsFrom(lastOpenRouterModels, paidModels(settings))
}

async function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function imageRequest(model: string, content: OpenAI.Chat.ChatCompletionContentPart[]) {
  const res = await client(settings).chat.completions.create({
    model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  return imageFrom(res.choices[0]?.message)
}

export const generateImage = (prompt: string, model: string) => imageRequest(model, [{ type: "text", text: prompt }])

export async function editImage(image: Blob, prompt: string, model: string) {
  return imageRequest(model, [
    { type: "text", text: `Edit this image: ${prompt}. Return the edited image.` },
    { type: "image_url", image_url: { url: await dataUrl(image) } },
  ])
}

export async function transcribe(audio: Blob, model: string) {
  const data = (await dataUrl(audio)).split(",")[1]
  const res = await client(settings).chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this recording word for word. Reply with only the transcript, nothing else." },
          { type: "input_audio", input_audio: { data, format: "wav" } },
        ],
      },
    ],
  })
  return (res.choices[0]?.message?.content ?? "").trim()
}

export const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]

/** Speech from an OpenRouter voice model. Audio comes as a stream of base64 PCM pieces. */
export async function speak(text: string, model: string, voice = "alloy") {
  const stream = await client(settings).chat.completions.create({
    model,
    messages: [
      { role: "system", content: "Read the user's text aloud exactly as written. Don't add anything." },
      { role: "user", content: text },
    ],
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    stream: true,
  } as OpenAI.Chat.ChatCompletionCreateParamsStreaming)
  const parts: Uint8Array[] = []
  for await (const chunk of stream) {
    const data = (chunk.choices[0]?.delta as { audio?: { data?: string } } | undefined)?.audio?.data
    if (data) parts.push(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
  }
  const pcm = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) pcm.set(p, (at += p.length) - p.length)
  if (!pcm.length) throw new Error("The voice model answered without audio. Try another voice model.")
  return pcmToWav(pcm)
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
