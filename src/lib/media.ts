// Image and video generation through OpenAI, plus a blob store for the results. Media is
// kept apart from chats so conversations stay small enough to save on every keystroke.
import { createStore, del, get, set } from "idb-keyval"
import { toFile } from "openai"
import { type Credentials, openaiClient } from "./clients"
import type { Attachment } from "./types"

const store = createStore("personal-ai-media", "media")
const urls = new Map<string, string>()

export async function saveMedia(id: string, blob: Blob) {
  await set(id, blob, store)
}

export async function loadMedia(id: string) {
  return get<Blob>(id, store)
}

export async function deleteMedia(id: string) {
  urls.delete(id)
  await del(id, store)
}

/** An object URL for stored media, created once per session. */
export async function mediaUrl(id: string) {
  const cached = urls.get(id)
  if (cached) return cached
  const blob = await loadMedia(id)
  if (!blob) return undefined
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  return url
}

export function base64ToBlob(data: string, type: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type })
}

export const IMAGE_MODELS = [
  { id: "gpt-image-2", label: "GPT Image 2" },
  { id: "gpt-image-1.5", label: "GPT Image 1.5" },
  { id: "gpt-image-1-mini", label: "GPT Image 1 mini (cheapest)" },
]

export const VIDEO_MODELS = [
  { id: "sora-2", label: "Sora 2" },
  { id: "sora-2-pro", label: "Sora 2 Pro (higher quality, slower)" },
]

export type ImageShape = "square" | "portrait" | "landscape"
const IMAGE_SIZE: Record<ImageShape, "1024x1024" | "1024x1536" | "1536x1024"> = {
  square: "1024x1024",
  portrait: "1024x1536",
  landscape: "1536x1024",
}
const VIDEO_SIZE: Record<ImageShape, "720x1280" | "1280x720"> = {
  square: "1280x720",
  portrait: "720x1280",
  landscape: "1280x720",
}

export interface ImageRequest {
  credentials: Credentials
  model: string
  prompt: string
  shape: ImageShape
  /** Images to edit or use as references; when present the edits endpoint is used. */
  references?: Attachment[]
  signal?: AbortSignal
  onPartial?: (blob: Blob) => void
}

/**
 * Generates one PNG. Streams partial previews, which also keeps the connection busy so the
 * edge proxy never waits long for the first byte.
 */
export async function generateImage(req: ImageRequest): Promise<Blob> {
  const client = openaiClient(req.credentials)
  const common = { model: req.model, prompt: req.prompt, size: IMAGE_SIZE[req.shape], stream: true as const, partial_images: 2 }
  const stream = req.references?.length
    ? await client.images.edit(
        {
          ...common,
          image: await Promise.all(req.references.map((a) => toFile(base64ToBlob(a.data, a.mediaType), a.name, { type: a.mediaType }))),
        },
        { signal: req.signal },
      )
    : await client.images.generate(common, { signal: req.signal })

  for await (const event of stream) {
    if (event.type === "image_generation.partial_image" || event.type === "image_edit.partial_image")
      req.onPartial?.(base64ToBlob(event.b64_json, "image/png"))
    if (event.type === "image_generation.completed" || event.type === "image_edit.completed") return base64ToBlob(event.b64_json, "image/png")
  }
  throw new Error("The image service ended without returning an image.")
}

export interface VideoRequest {
  credentials: Credentials
  model: string
  prompt: string
  shape: ImageShape
  seconds: "4" | "8" | "12"
  /** Optional first frame. */
  reference?: Attachment
  signal?: AbortSignal
  onProgress?: (percent: number, status: string) => void
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    })
  })

/** Sora needs the first frame at exactly the video's size, so crop the reference to fit. */
async function fitFrame(a: Attachment, size: string) {
  const [width, height] = size.split("x").map(Number)
  const bitmap = await createImageBitmap(base64ToBlob(a.data, a.mediaType))
  const scale = Math.max(width / bitmap.width, height / bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  canvas.getContext("2d")!.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92))
  return toFile(blob, "frame.jpg", { type: "image/jpeg" })
}

/** Starts a Sora render, polls until it's done, then downloads the MP4. */
export async function generateVideo(req: VideoRequest): Promise<Blob> {
  const client = openaiClient(req.credentials)
  let video = await client.videos.create(
    {
      model: req.model,
      prompt: req.prompt,
      seconds: req.seconds,
      size: VIDEO_SIZE[req.shape],
      input_reference: req.reference ? await fitFrame(req.reference, VIDEO_SIZE[req.shape]) : undefined,
    },
    { signal: req.signal },
  )
  while (video.status === "queued" || video.status === "in_progress") {
    req.onProgress?.(video.progress ?? 0, video.status)
    await sleep(4000, req.signal)
    video = await client.videos.retrieve(video.id, { signal: req.signal })
  }
  if (video.status !== "completed") throw new Error(video.error?.message ?? "The video failed to render.")
  req.onProgress?.(100, "downloading")
  const res = await client.videos.downloadContent(video.id, { signal: req.signal })
  return new Blob([await res.arrayBuffer()], { type: "video/mp4" })
}
