// Pure helpers for the image and audio AI features (media-ai.ts): which OpenRouter models can
// make images, speak or transcribe; reading an image model's answer; and wrapping streamed
// voice audio as a .wav. Unit tested.
import type { OpenRouterModel } from "./models"

const isFree = (m: OpenRouterModel) => m.pricing?.prompt === "0" && m.pricing?.completion === "0"
const ins = (m: OpenRouterModel) => m.architecture?.input_modalities ?? ["text"]
const outs = (m: OpenRouterModel) => m.architecture?.output_modalities ?? ["text"]

/**
 * OpenRouter's image, voice and transcription models this device can use: free ones always,
 * paid ones once unlocked. `locked` says paid ones exist but aren't unlocked here.
 */
export function mediaModelsFrom(list: OpenRouterModel[], paid: boolean) {
  const usable = (m: OpenRouterModel) => paid || (isFree(m) && (m.id.endsWith(":free") || m.id === "openrouter/free"))
  const ids = (fn: (m: OpenRouterModel) => boolean) =>
    list
      .filter((m) => fn(m) && usable(m))
      .map((m) => m.id)
      .sort((a, b) => Number(b.endsWith(":free")) - Number(a.endsWith(":free")) || a.localeCompare(b))
  return {
    image: ids((m) => outs(m).includes("image")),
    // Music models (Lyria) also output audio but don't speak text.
    speech: ids((m) => outs(m).includes("audio") && !/lyria|music/i.test(m.id)),
    transcription: ids((m) => ins(m).includes("audio") && outs(m).includes("text")),
    locked: !paid,
  }
}

/** The first picture in an OpenRouter answer (message.images[].image_url.url, a data: URL). */
export async function imageFrom(message: unknown) {
  const url = (message as { images?: { image_url?: { url?: string } }[] } | undefined)?.images?.[0]?.image_url?.url
  if (!url) throw new Error("The image model answered without an image. Try rewording it, or another image model.")
  return (await fetch(url)).blob()
}

/** 16-bit mono PCM (what OpenRouter's voice models stream) as a .wav file. */
export function pcmToWav(pcm: Uint8Array, rate = 24_000) {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  text(0, "RIFF")
  v.setUint32(4, 36 + pcm.length, true)
  text(8, "WAVE")
  text(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, "data")
  v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return new Blob([out], { type: "audio/wav" })
}

