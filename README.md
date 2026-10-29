# Jonny's AI project

A personal AI chat, coding, design and media app that runs on **free open models** (Google Gemma, NVIDIA Nemotron, MiniMax and more) through [OpenRouter](https://openrouter.ai). Deploy it to Netlify and install it on your phone or computer.

- **Two AI providers** (Settings → AI provider): OpenRouter's free models, or your own **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** gateway, which puts 300+ providers (150+ with free tiers) behind one endpoint with automatic fallback.
- **Auto (free)** picks an available free model for each message, or you can choose a specific one. The model list is live, so new free models appear on their own.
- **Compare side by side:** send one message to two models at once.
- **The + menu** adds context and tools to a message:
  - **Photos & files** or **Take a photo**: images and text files.
  - **GitHub repo**: connect any repo, browse its files, and add the ones you want, plus an outline of the whole project. Private repos work with an optional GitHub token in Settings.
  - **Web page**: paste a link and the page's text is added for the AI to read.
  - **AI tools**: Think longer, Write code, Edit a GitHub repo, Summarize, Translate, Explain simply, Brainstorm, Improve writing.
- **Edit and push to GitHub:** connect a repo (or pick "Edit a GitHub repo"), ask for a change, and the AI writes complete files. A card under the reply shows each file as new or changed (+/− lines). One tap pushes them to GitHub in a single commit: on a new branch with a pull request (the default), or straight to `main`. Pushing never force-pushes, so if the branch changed meanwhile it stops instead of overwriting.
- **Code workspace** (Code in the sidebar, next to Chat, Design, Cowork, Photo and Audio): open any GitHub repo and work on it like a small IDE:
  - **Files:** the repo as a folder tree; changed files are marked.
  - **Editor:** syntax-highlighted editing (CodeMirror) for JS/TS, HTML, CSS, JSON, Markdown, Python and more.
  - **AI:** ask for a change and the AI, which sees the file list, the open file, your edits and any file you name, writes complete files; tap **Apply** to put them in your working copy.
  - **Terminal:** `ls`, `cd`, `cat`, `grep`, `touch`, `rm`, `mv`, `echo > file`, `preview`, plus git: `git status`, `git diff`, `git commit -m`, `git push`, `git checkout -b`, `git pull`, `git restore`, `git log`, `git branch`, and `gh pr create`. `ai "…"` sends a request to the AI.
  - **Commit & push** button: the same thing in one tap, onto a new branch with a pull request (default) or the current branch.
- **Design** studio: describe a landing page, social post, story, poster, logo, business card, app screen or slide and the AI designs it as HTML (or SVG for logos), shown live as it's written. Ask for changes to get new versions and go back to any of them. Download as PNG, HTML or SVG, or copy the code. Designs are saved on your device.
- **Cowork:** bring files and work on them with the AI. Add documents, spreadsheets (CSV), PDFs, Word files, images or code, or drop them in; on Chrome and Edge on a computer you can **open a whole folder** and save changes back to it. The AI reads them (text inside PDFs and Word files too; tick images to let it see them), answers questions and writes new or improved files that you **Save** with one tap. Edit files yourself, revert to the original, download one file or everything as a zip. Quick asks: summarize, compare, pull out action items, make a table, proofread, write a report.
- **Photo** editor: brightness, contrast, saturation, warmth, hue, vignette and blur sliders; filters (Vivid, Warm, Mono, Noir, Sepia…); crop with aspect ratios, rotate and flip; draw and add text; undo/redo; export JPEG or PNG at full size or smaller. AI: **AI adjust** (describe the look you want), **Describe** the photo, and with OmniRoute, **AI edit** and **generate** images.
- **Audio** editor: open a file or record from the microphone, select on the waveform, then keep or delete the selection, fade in/out, change volume, normalize, mute, reverse, speed up or slow down, insert silence, make mono, and append recordings; undo/redo; export WAV. With OmniRoute: **transcribe** speech to text and turn text into **speech** with a choice of voices.
- **Keeps working when the app is closed:** replies in Chat, Code, Cowork and Design are written on the site's server, so closing the app, switching apps or locking your phone doesn't stop them. When you open the app again the finished reply is there (or it carries on live if it's still being written). Stop still stops it. It can be turned off in **Settings → Keep working when the app is closed**.
- Streaming answers, the model's thought process where it shares one, Markdown and code highlighting.
- **Code canvas:** preview HTML/SVG the AI writes, then copy or download it.
- Edit a past message, regenerate an answer, or stop a reply mid-stream.
- Chat history is searchable, grouped by date, and stored only on your device.
- Installable app with offline access to past chats, dark/light themes, and a mobile layout.

## Getting started

The app needs a free OpenRouter key. No card or payment is required.

1. Sign up at [openrouter.ai](https://openrouter.ai), open **Settings → API Keys**, and create a key.
2. Open the app and paste the key under **Settings → OpenRouter key**.

The key is saved only on your device.

**Optional: put the key on Netlify instead,** so the app works on every device without pasting it. Add `OPENROUTER_API_KEY` under **Site configuration → Environment variables**, then redeploy. The site's key only ever reaches free models, because the proxy blocks paid models and paid plugins, so it can't cost you money. Anyone who opens the site can use its free daily messages.

### How the Code terminal works

The terminal runs inside your browser. It reads and changes files and talks to GitHub, so `git commit` creates a real commit on GitHub and `git push` moves the branch to it. It can't run programs like `npm`, `node` or `python`, because a Netlify site has no computer behind it to run them on. Push your changes instead: Netlify builds and deploys the site, and GitHub Actions can run tests. To try an HTML page, use `preview page.html`.

Your edits and unpushed commits are saved on the device, so closing the app doesn't lose them. Pushes are never forced: if GitHub has newer commits on the branch, the push stops so nothing is overwritten.

### Pushing to GitHub

Pushing needs a GitHub token, saved only on your device:

1. Go to github.com → **Settings → Developer settings → Fine-grained tokens → Generate new token**.
2. Under **Repository access**, choose the repos the app may change.
3. Under **Permissions**, set **Contents** and **Pull requests** to **Read and write**.
4. Paste the token in the app under **Settings → GitHub token**.

If the repo is this site's own repo, anything pushed to `main` goes live on Netlify, so the default is a branch plus pull request: review it on GitHub, then merge.

### Using your own OmniRoute gateway

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT) is a free AI gateway you run yourself. It connects many providers' free tiers and your own accounts behind one OpenAI-compatible endpoint, and falls back between them automatically. It's a server, so it runs on your computer, an Android phone (Termux), Docker or a cloud host, not on Netlify. Jonny's AI connects to it.

1. Install and start it: `npm install -g omniroute`, then `omniroute`. The dashboard opens at http://localhost:20128.
2. In its dashboard, connect a few providers under **Providers**, then copy an API key from **Endpoints**.
3. In Jonny's AI, open **Settings → AI provider → OmniRoute** and enter the address and key, then tap **Test connection**:
   - **From your phone or anywhere:** turn on the **Cloudflare tunnel** in OmniRoute's Dashboard → Endpoints and use its `https://…` address. Requests go through this site's server, so OmniRoute needs no extra settings.
   - **On the computer running OmniRoute:** use `http://localhost:20128`. The browser talks to it directly, so start OmniRoute with `CORS_ALLOWED_ORIGINS=https://your-site.netlify.app`.

The model picker then lists OmniRoute's models and combos, with **Auto** first. Chat, the AI tools, Code, Design and Cowork all use it. OmniRoute also unlocks the media features that OpenRouter's free tier doesn't have: image generation and AI photo edits, speech-to-text and text-to-speech, using whichever image and audio models your gateway offers. The site's proxy only forwards the model list, chat, images and audio, only to public `https://` addresses, and only with your own OmniRoute key.

### How replies keep going when the app is closed

A web app stops running when it's closed, so the work happens on Netlify instead:

1. The app sends the request to `/api/jobs` (an edge function). It saves the request in [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) and starts the `run-job` [background function](https://docs.netlify.com/build/functions/background-functions/), which can run for up to 15 minutes whether or not anyone is watching.
2. That function streams the reply from OpenRouter (or your OmniRoute gateway) and saves it as it arrives.
3. The app reads the progress about once a second, so you still see the reply being written. If the app was closed, it picks the reply up when it opens again.

Your keys go only with the request that starts a reply and are never stored. The saved request is deleted as soon as the reply starts, a finished reply is deleted once the app has it, and anything left over is cleaned up after a day. Background functions and Blobs are included in Netlify's free plan. When the server can't run a reply (when running locally with `npm run dev`, or with an OmniRoute address only your computer can reach, like `http://localhost:20128`), the app streams it directly as before, and it only finishes while the app is open. Edits in the Photo and Audio editors happen on your device and are instant.

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
| `src/lib/github.ts` | Reads repos; pushes files as one commit (branch, pull request) |
| `src/lib/changes.ts` | Finds complete files in a reply (unit tested) |
| `src/lib/workspace.ts` | Code workspace: working copy, local commits, push (unit tested) |
| `src/lib/terminal.ts` | Terminal commands (unit tested against a simulated GitHub) |
| `src/lib/diff.ts` | Line diffs for `git diff` and change counts |
| `src/lib/codeai.ts` | The Code workspace's AI assistant |
| `src/components/code/` | Code view: file tree, editor, AI panel, terminal, commit sheet |
| `src/lib/web.ts`, `src/lib/tools.ts` | Web page reader, AI tools |
| `netlify/edge-functions/` | `openrouter` proxy, `read` (web pages) and `status` |
| `netlify/shared/proxy.ts` | Path allowlist and free-model guard for the site key |
| `netlify/shared/read.ts` | Fetches public web pages and turns them into text |
| `netlify/shared/gateway.ts` | Proxy to your OmniRoute gateway (public https only, unit tested) |
| `netlify/shared/jobs.ts`, `netlify/functions/run-job.mts` | Replies that run on the server and keep going when the app is closed (unit tested) |
| `src/lib/jobs.ts` | Starts server replies and follows their progress |
| `src/lib/route.ts` | Decides whether OmniRoute is reached through the proxy or directly |
| `src/lib/design.ts`, `src/components/design/` | Design studio: design types, prompts, reading designs out of replies (unit tested) |
| `src/lib/cowork.ts`, `src/lib/coworkspace.ts`, `src/components/cowork/` | Cowork: file types, CSV, Word text, what the AI sees (unit tested); files, folders, zip, AI |
| `src/lib/imageops.ts`, `src/components/media/ImageEditor.tsx` | Photo editor: pixel adjustments, crop and rotation maths (unit tested) |
| `src/lib/audioops.ts`, `src/components/media/AudioEditor.tsx` | Audio editor: cut, fade, gain, speed, WAV encoding (unit tested) |
| `src/lib/media-ai.ts` | Image generation and edits, transcription and speech through OmniRoute |

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
