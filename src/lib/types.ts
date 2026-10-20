export type ProviderId = "anthropic" | "openai"

export interface ModelRef {
  provider: ProviderId
  id: string
}

export interface ModelInfo extends ModelRef {
  label: string
  hint?: string
}

export interface Attachment {
  id: string
  name: string
  mediaType: string
  /** Base64 without the data: prefix. */
  data: string
}

export interface Source {
  url: string
  title?: string
}

export type ReplyStatus = "streaming" | "done" | "stopped" | "error"

export type TurnMode = "chat" | "image" | "video"

export interface MediaResult {
  kind: "image" | "video"
  prompt: string
  /** Key in the media store once the image or video is ready. */
  id?: string
  /** Video render progress, 0-100. */
  progress?: number
}

export interface Reply {
  id: string
  model: ModelRef
  text: string
  thinking: string
  sources: Source[]
  status: ReplyStatus
  /** Short live status, e.g. "Searching the web". */
  activity?: string
  error?: string
  /**
   * Claude's response content blocks exactly as returned (thinking signatures, search
   * results, fallbacks). They are sent back unchanged on later turns so Claude keeps its
   * reasoning; only complete responses keep them.
   */
  raw?: unknown[]
  media?: MediaResult
  createdAt: number
}

export interface Turn {
  id: string
  /** Missing on chats saved before image and video modes existed. */
  mode?: TurnMode
  text: string
  attachments: Attachment[]
  replies: Reply[]
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  /** Fixed when the chat starts, so the conversation history the models see never changes. */
  system: string
  webSearch: boolean
  /** One model for a normal chat, two for side-by-side compare. */
  models: ModelRef[]
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

export type Effort = "low" | "medium" | "high"

export interface Settings {
  /** Server passcode (APP_PASSCODE); only needed to use keys stored on Netlify. */
  passcode: string
  /** Keys entered in the app. Stored on this device only. */
  anthropicKey: string
  openaiKey: string
  /** SHA-256 of the app lock passcode; unset means the default. */
  pinHash?: string
  system: string
  effort: Effort
  webSearch: boolean
  theme: "system" | "light" | "dark"
  models: ModelRef[]
  imageModel: string
  videoModel: string
  shape: "square" | "portrait" | "landscape"
  videoSeconds: "4" | "8" | "12"
}

export interface StreamEvents {
  text(delta: string): void
  thinking(delta: string): void
  activity(label: string | undefined): void
  source(source: Source): void
}

export interface StreamResult {
  raw?: unknown[]
  /** Set when the model declined; shown in place of an error. */
  notice?: string
}
