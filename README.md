# Personal AI

A private chat app for **Claude** and **ChatGPT** in one place. You deploy it to Netlify and install it as an app on your phone or computer.

- Chat with Claude (Opus, Sonnet, Haiku, Fable) or ChatGPT (GPT‑5 family) and switch models at any time.
- **Compare side by side**: send one message to a Claude model and a ChatGPT model at once.
- Streaming answers, Claude's visible thought process, web search with sources, image/PDF/text attachments, Markdown and code highlighting with copy buttons.
- Edit a past message to branch the chat, regenerate answers, and stop a reply mid-stream.
- Chat history is searchable, grouped by date, and stored only on your device in IndexedDB.
- Installable PWA with offline access to past chats, dark/light themes, and a mobile layout.
- Your API keys stay on Netlify. The browser never sees them, and a passcode locks the app.

## How it's built

The app uses the same front-end stack as [opencode](https://github.com/anomalyco/opencode/tree/v2)'s web app (`packages/app`): **SolidJS + Vite** with a `vite-plugin-pwa` service worker. Its provider layer is split per API the way opencode's `packages/ai` splits its protocols. opencode itself is a coding agent that needs a local server, so it can't run on Netlify. This repo keeps the parts that make sense for a hosted chat app.

```
Browser (SolidJS PWA)
  ├─ @anthropic-ai/sdk ──▶ /api/anthropic/*  ─┐
  └─ openai SDK        ──▶ /api/openai/*     ─┤  Netlify Edge Functions
                                              │  check passcode, add the API key,
                                              └─ stream the response back
```

The browser uses the official SDKs pointed at the edge proxy. The proxy only forwards the endpoints the app needs (`/v1/messages`, `/v1/responses`, `/v1/models`). Edge Functions have no time limit on a streamed response, so long answers don't get cut off.

| Path | What it is |
| --- | --- |
| `src/lib/providers.ts` | Claude (Messages API) and ChatGPT (Responses API) adapters |
| `src/lib/history.ts` | Builds each provider's conversation history (unit tested) |
| `src/lib/store.ts` | Chats, streaming state, IndexedDB persistence |
| `src/components/` | Sidebar, model picker, thread, composer, settings |
| `netlify/edge-functions/` | `anthropic`, `openai` and `status` proxies |
| `netlify/shared/proxy.ts` | Passcode check, path allowlist, header handling |

## Deploy to Netlify

1. **Get API keys.** Get an Anthropic key from [console.anthropic.com](https://console.anthropic.com/settings/keys), an OpenAI key from [platform.openai.com](https://platform.openai.com/api-keys), or both. Either one works on its own.
2. **Create the site.** In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo. The build settings come from `netlify.toml` (`npm run build`, publish `dist`), so leave them as they are.
3. **Set environment variables** under **Site configuration → Environment variables**:

   | Variable | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `OPENAI_API_KEY` | your OpenAI key |
   | `APP_PASSCODE` | a long passphrase that only you know |

   `APP_PASSCODE` is required. The API refuses every request without it, because anyone with your site URL and the passcode can spend your API credit.
4. **Deploy**, or trigger a redeploy after adding the variables. Then open the site and enter your passcode.

## Install it as an app

- **Chrome / Edge (Windows, Mac, Linux, ChromeOS):** click **Install app** in the sidebar, or the install icon in the address bar.
- **Android:** use the browser menu (⋮) → **Install app**.
- **iPhone / iPad:** open the site in Safari → **Share** → **Add to Home Screen**.
- **Safari on Mac:** **File → Add to Dock**.

The installed app opens in its own window and updates itself. When a new version is deployed, it shows a "Reload" prompt.

## Run locally

```bash
npm install
cp .env.example .env      # fill in your keys and a passcode
npx netlify-cli dev       # app + edge functions on http://localhost:8888
```

`npm run dev` starts the front end on its own, but chats need the edge functions, so use `netlify dev`.

```bash
npm test          # history + proxy unit tests
npm run build     # typecheck + production build
```

## Notes

- **Costs** are billed to your own API accounts at standard API rates. A ChatGPT Plus or Claude Pro subscription doesn't cover API usage. Settings → **Thinking effort** sets how hard the models think; lower is cheaper and faster.
- **Model lists** load live from each API, so new models show up without code changes. The defaults are in `src/lib/models.ts`.
- **Custom instructions** and **web search** are fixed for each chat when it starts. That keeps the history Claude sees unchanged from turn to turn, so it keeps its earlier reasoning and prompt caching keeps working.
- Claude requests opt into server-side refusal fallbacks (`fallbacks: "default"`) on models that support them. If Claude Opus 5.5 declines a request, a fallback model can still answer.
- Chats live in your browser's storage. Clearing site data, or using another device, starts with an empty history.

## License

MIT
