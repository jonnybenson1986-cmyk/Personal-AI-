import { uid } from "./store"
import type { Attachment } from "./types"

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|log|html|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql)$/i
const MAX_BYTES = 20 * 1024 * 1024
// Larger images cost more tokens without helping either model; this is Claude's sweet spot.
const MAX_SIDE = 1568

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function shrinkImage(file: File): Promise<{ mediaType: string; data: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 3 * 1024 * 1024 && file.type !== "image/gif") {
    return { mediaType: file.type, data: toBase64(await file.arrayBuffer()) }
  }
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.88))
  return { mediaType: "image/jpeg", data: toBase64(await blob.arrayBuffer()) }
}

export async function readFile(file: File): Promise<Attachment> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 20 MB.`)
  if (IMAGE_TYPES.includes(file.type) || file.type.startsWith("image/")) {
    return { id: uid(), name: file.name || "image", ...(await shrinkImage(file)) }
  }
  if (file.type === "application/pdf") {
    return { id: uid(), name: file.name, mediaType: file.type, data: toBase64(await file.arrayBuffer()) }
  }
  if (file.type.startsWith("text/") || TEXT_EXT.test(file.name) || file.type === "application/json") {
    return { id: uid(), name: file.name, mediaType: "text/plain", data: toBase64(await file.arrayBuffer()) }
  }
  throw new Error(`${file.name}: only images, PDFs and text files can be attached.`)
}

export const ACCEPT = "image/*,application/pdf,text/*,.md,.csv,.json,.yaml,.yml,.toml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.sql,.log"
