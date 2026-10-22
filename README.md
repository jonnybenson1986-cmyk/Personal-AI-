# Jonny's AI project

A personal AI chat, coding and research app that runs on **free open models** (Google Gemma, NVIDIA Nemotron, MiniMax and more) through [OpenRouter](https://openrouter.ai). Deploy it to Netlify and install it on your phone or computer.

- **Auto (free)** picks an available free model for each message, or you can choose a specific one. The model list is live, so new free models appear on their own.
- **Compare side by side:** send one message to two models at once.
- **The + menu** adds context and tools to a message:
  - **Photos & files** or **Take a photo**: images and text files.
  - **GitHub repo**: connect any repo, browse its files, and add the ones you want, plus an outline of the whole project. Private repos work with an optional GitHub token in Settings.
  - **Web page**: paste a link and the page's text is added for the AI to read.
  - **AI tools**: Think longer, Write code, Edit a GitHub repo, Summarize, Translate, Explain simply, Brainstorm, Improve writing.
- **Edit and push to GitHub:** connect a repo (or pick "Edit a GitHub repo"), ask for a change, and the AI writes complete files. A card under the reply shows each file as new or changed (+/− lines). One tap pushes them to GitHub in a single commit: on a new branch with a pull request (the default), or straight to `main`. Pushing never force-pushes, so if the branch changed meanwhile it stops instead of overwriting.
- **Code workspace** (Chat / Code switch in the sidebar): open any GitHub repo and work on it like a small IDE:
  - **Files:** the repo as a folder tree; changed files are marked.
  - **Editor:** syntax-highlighted editing (CodeMirror) for JS/TS, HTML, CSS, JSON, Markdown, Python and more.
  - **AI:** ask for a change and the AI, which sees the file list, the open file, your edits and any file you name, writes complete files; tap **Apply** to put them in your working copy.
  - **Terminal:** `ls`, `cd`, `cat`, `grep`, `touch`, `rm`, `mv`, `echo > file`, `preview`, plus git: `git status`, `git diff`, `git commit -m`, `git push`, `git checkout -b`, `git pull`, `git restore`, `git log`, `git branch`, and `gh pr create`. `ai "…"` sends a request to the AI.
  - **Commit & push** button: the same thing in one tap, onto a new branch with a pull request (default) or the current branch.
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
