# Personal AI

A private AI chat app that runs on **free open models** (Google Gemma, NVIDIA Nemotron, MiniMax and more) through [OpenRouter](https://openrouter.ai). Deploy it to Netlify and install it on your phone or computer.

- **Auto (free)** picks an available free model for each message, or you can choose a specific one. The model list is live, so new free models appear on their own.
- **Compare side by side:** send one message to two models at once.
- Streaming answers, the model's thought process where it shares one, image and text-file attachments, Markdown and code highlighting.
- **Code canvas:** preview HTML/SVG the AI writes, then copy or download it.
- Edit a past message, regenerate an answer, or stop a reply mid-stream.
- Chat history is searchable, grouped by date, and stored only on your device.
- Installable app with offline access to past chats, dark/light themes, and a mobile layout.
- A passcode locks the app on your device (default **3280**, changeable in Settings).

## Getting started

The app needs a free OpenRouter key. No card or payment is required.

1. Sign up at [openrouter.ai](https://openrouter.ai), open **Settings → API Keys**, and create a key.
2. Open the app, enter passcode **3280**, then paste the key under **Settings → OpenRouter key**.

The key is saved only on your device.

**Optional: put the key on Netlify instead,** so the app works on every device without pasting it. Add `OPENROUTER_API_KEY` under **Site configuration → Environment variables**, then redeploy. The site's key only ever reaches free models, because the proxy blocks paid models and paid plugins, so it can't cost you money. To stop strangers using up its free daily quota, also set `APP_PASSCODE` and enter it in Settings under "Site has its own key with a passcode?".

### Free model limits

- **Without credits:** about 20 messages a minute and 50 a day across free models.
- **With credits:** buying $10 of OpenRouter credits once raises the daily limit to 1,000. Free models still cost nothing.
- **Privacy setting:** some free models are only available if your OpenRouter privacy settings allow free-model providers. Change it at [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy). The app tells you when this is the problem.

## How it's built

The app uses the same front-end stack as [opencode](https://github.com/anomalyco/opencode/tree/v2)'s web app: **SolidJS + Vite** with a `vite-plugin-pwa` service worker. Using OpenRouter's free tier was inspired by [zebbern/knowledge-assistant](https://github.com/zebbern/knowledge-assistant), the repo under GitHub's `project-ai-chatbot` topic. That repo has no license, so none of its code is copied here.

```
Browser (SolidJS PWA)
  └─ openai SDK ──▶ /api/openrouter/*  ──  Netlify Edge Function
                                           uses your key, or the site's key for free models only,
                                           and streams the response back from openrouter.ai
```

| Path | What it is |
| --- | --- |
| `src/lib/providers.ts` | Streams chat completions from OpenRouter, lists free models |
| `src/lib/history.ts` | Builds the message history (unit tested) |
| `src/lib/models.ts` | Picks the free chat models out of OpenRouter's list |
| `src/lib/store.ts` | Chats, streaming state, IndexedDB persistence |
| `src/components/` | Sidebar, model picker, thread, composer, canvas, settings |
| `netlify/edge-functions/` | `openrouter` proxy and `status` |
| `netlify/shared/proxy.ts` | Path allowlist, free-model guard for the site key, optional passcode |

## Deploy to Netlify

In Netlify, choose **Add new site → Import an existing project** and pick this repo. The build settings come from `netlify.toml` (`npm run build`, publish `dist`).

## Install it as an app

- **Chrome / Edge:** click **Install app** in the sidebar, or the install icon in the address bar.
- **Android:** browser menu (⋮) → **Install app**.
- **iPhone / iPad:** in Safari, tap **Share** → **Add to Home Screen**.
- **Safari on Mac:** **File → Add to Dock**.

## Run locally

```bash
npm install
npx netlify-cli dev       # app + edge functions on http://localhost:8888
npm test                  # unit tests
npm run build             # typecheck + production build
```

## License

MIT
