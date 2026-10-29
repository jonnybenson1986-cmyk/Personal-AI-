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
  /** The server job generating this reply, so it can be picked up again after the app closes. */
  job?: string
  /** Set once this reply's file changes were pushed to GitHub. */
  pushed?: { commitUrl: string; branchUrl: string; branch: string; pullRequestUrl?: string }
  createdAt: number
}

export interface RepoTarget {
  owner: string
  repo: string
  /** Branch the files were read from. */
  ref?: string
}

export interface Turn {
  id: string
  /** The GitHub repo this message is about; the AI is asked to give pushable files. */
  repo?: RepoTarget
  /** AI tool from the + menu, e.g. "summarize". */
  tool?: string
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
  /** The GitHub repo connected to this chat, if any. */
  repo?: RepoTarget
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

export type Provider = "openrouter" | "omniroute"

export interface Settings {
  /** Where chats go: OpenRouter's free models, or the user's own OmniRoute gateway. */
  provider: Provider
  /** OmniRoute's address, e.g. https://abc.trycloudflare.com or http://localhost:20128. */
  omnirouteUrl: string
  /** An OmniRoute API key (Dashboard → Endpoints). Stored on this device only. */
  omnirouteKey: string
  /** The user's OpenRouter key. Stored on this device only. */
  openrouterKey: string
  /** Optional GitHub token for private repos. Stored on this device only. */
  githubToken: string
  /** Repos added recently, newest first ("owner/repo"). */
  recentRepos: string[]
  system: string
  theme: "system" | "light" | "dark"
  models: ModelRef[]
  /** Generate replies on the site's server, so they finish even if the app is closed. */
  background: boolean
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
