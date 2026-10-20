import type { JSX } from "solid-js"

const base = (path: JSX.Element, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {path}
  </svg>
)

export const IconPlus = () => base(<path d="M12 5v14M5 12h14" />)
export const IconSend = () => base(<path d="M12 19V5M5 12l7-7 7 7" />)
export const IconStop = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
)
export const IconMenu = () => base(<path d="M4 7h16M4 12h16M4 17h10" />)
export const IconEdit = () => base(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />, 16)
export const IconCompose = () => base(<><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L13 14l-4 1 1-4z" /></>)
export const IconTrash = () => base(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />, 16)
export const IconCopy = () => base(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h9" /></>, 16)
export const IconCheck = () => base(<path d="M5 12l5 5 9-10" />, 16)
export const IconRefresh = () => base(<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />, 16)
export const IconSettings = () => base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)
export const IconGlobe = () => base(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>, 16)
export const IconChevron = () => base(<path d="M6 9l6 6 6-6" />, 16)
export const IconDownload = () => base(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />)
export const IconFile = () => base(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>, 16)
export const IconX = () => base(<path d="M6 6l12 12M18 6L6 18" />, 14)
export const IconColumns = () => base(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>, 16)
export const IconImage = () => base(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-9 9" /></>, 16)
export const IconVideo = () => base(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></>, 16)
export const IconPaperclip = () => base(<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />, 16)
export const IconCode = () => base(<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />, 16)
export const IconFolder = () => base(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const IconBot = () => base(<><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></>)
export const IconChat = () => base(<path d="M20 12a8 8 0 0 1-11.8 7l-4.2 1 1-4A8 8 0 1 1 20 12z" />)
export const IconPlay = () => base(<path d="M7 5l12 7-12 7z" />, 16)
export const IconExternal = () => base(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />, 16)
