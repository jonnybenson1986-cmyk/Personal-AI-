export interface ModelRef {
  id: string
}

export interface ModelInfo extends ModelRef {
  label: string
  hint?: string
  /** Accepts images in messages. */
  vision?: boolean
}

export interface Attachment {
  id: string
  name: string
  mediaType: string
  /** Base64 without the data: prefix. */
  data: string
}

export type ReplyStatus = "streaming" | "done" | "stopped" | "error"

export interface Reply {
  id: string
  model: ModelRef
  /** The model that actually answered, when a router such as openrouter/free picked one. */
  servedBy?: string
  text: string
  thinking: string
  status: ReplyStatus
  error?: string
  createdAt: number
}

export interface Turn {
  id: string
  text: string
  attachments: Attachment[]
  replies: Reply[]
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  /** Fixed when the chat starts. */
  system: string
  /** One model for a normal chat, two for side-by-side compare. */
  models: ModelRef[]
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

export interface Settings {
  /** Optional server passcode (APP_PASSCODE), only needed if the site's key is protected. */
  passcode: string
  /** The user's OpenRouter key. Stored on this device only. */
  openrouterKey: string
  /** SHA-256 of the app lock passcode; unset means the default. */
  pinHash?: string
  system: string
  theme: "system" | "light" | "dark"
  models: ModelRef[]
}

export interface StreamEvents {
  text(delta: string): void
  thinking(delta: string): void
  servedBy(model: string): void
}

export interface StreamResult {
  /** Set when the reply ended early; shown under it. */
  notice?: string
}
