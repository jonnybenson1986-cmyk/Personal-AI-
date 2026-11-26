// What the site has set up on Netlify, from /api/status.
import { createSignal } from "solid-js"

/** Whether the site has its own OpenRouter key (OPENROUTER_API_KEY), so the AI works with none in the app. */
export const [siteOpenRouter, setSiteOpenRouter] = createSignal(false)
/** Whether the site has a passcode (PAID_PASSCODE) that unlocks paid models on its key. */
export const [sitePasscode, setSitePasscode] = createSignal(false)
