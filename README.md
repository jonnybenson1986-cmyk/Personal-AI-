# Personal AI

A private chat app for **Claude** and **ChatGPT** in one place. You deploy it to Netlify and install it as an app on your phone or computer.

- Chat with Claude (Opus, Sonnet, Haiku, Fable) or ChatGPT (GPT‑5 family) and switch models at any time.
- **Compare side by side**: send one message to a Claude model and a ChatGPT model at once.
- Streaming answers, Claude's visible thought process, web search with sources, image/PDF/text attachments, Markdown and code highlighting with copy buttons.
- Edit a past message to branch the chat, regenerate answers, and stop a reply mid-stream.
- Chat history is searchable, grouped by date, and stored only on your device in IndexedDB.
- Installable PWA with offline access to past chats, dark/light themes, and a mobile layout.
- A passcode locks the app on your device (default **3280**, changeable in Settings).
- Paste your API keys into Settings (saved only on your device), or keep them on Netlify behind a server passcode.

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

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo. The build settings come from `netlify.toml`, so leave them as they are.
2. Deploy, open the site and enter the app passcode: **3280** to start. Change it under Settings → App passcode.
3. Open **Settings → API keys** and paste an Anthropic key ([console.anthropic.com](https://console.anthropic.com/settings/keys)), an OpenAI key ([platform.openai.com](https://platform.openai.com/api-keys)), or both. They're saved on that device only and passed straight through to Anthropic or OpenAI.

That's all you need. The app passcode only locks the app on your device. Your keys and chats never leave it, so someone who opens the site elsewhere gets an empty app with no keys.

**Optional: use Netlify's keys instead of your own.** Netlify AI Gateway gives every site Claude and ChatGPT access billed to your Netlify credits, so you don't need any API keys. Turn it on with one variable:

1. In Netlify, open **Project configuration → Environment variables → Add a variable** and add `APP_PASSCODE` with a long passphrase of your own. Anyone who knows it can spend your credits through the site.
2. Redeploy (**Deploys → Trigger deploy**).
3. In the app, open Settings → "Using keys stored on Netlify instead?" and enter that passcode.

If you also set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` on Netlify, those keys are used for that provider instead of the gateway. The server's keys only work with the correct `APP_PASSCODE`. Keys entered in Settings always go straight to Anthropic or OpenAI. Through the gateway, Sora video and GPT Image 1 mini aren't available. Use your own OpenAI key for those.

## Install it as an app

- **Chrome / Edge (Windows, Mac, Linux, ChromeOS):** click **Install app** in the sidebar, or the install icon in the address bar.
- **Android:** use the browser menu (⋮) → **Install app**.
- **iPhone / iPad:** open the site in Safari → **Share** → **Add to Home Screen**.
- **Safari on Mac:** **File → Add to Dock**.

The installed app opens in its own window and updates itself. When a new version is deployed, it shows a "Reload" prompt.

## Run locally

```bash
npm install
cp .env.example .env      # optional: server-side keys and passcode
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
