import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { MAX_MEMBERS } from "../../../netlify/shared/team.ts"
import { agency, type AgentTask, assign, loadBrief, loadIndex, markSeen, removeTask, stopTask } from "../../lib/agency"
import { type AgentInfo, searchAgents, TEAMS, toolNotes } from "../../lib/agents"
import { download } from "../../lib/canvas"
import { parseFileChanges } from "../../lib/changes"
import { renderMarkdown } from "../../lib/markdown"
import { omniConfigured } from "../../lib/omniapi"
import { chatWith } from "../../lib/store"
import { setView } from "../../lib/view"
import { Modal } from "../Dialogs"
import { IconBot, IconChat, IconCopy, IconDownload, IconMenu, IconStop, IconTrash, IconX } from "../icons"

type Tab = "agency" | "tasks"
const PAGE = 60

export default function AgentsView(props: { onMenu: () => void }) {
  const [tab, setTab] = createSignal<Tab>(agency.tasks.length && !agency.tasks.some((t) => t.status === "preparing") ? "tasks" : "agency")
  const [index] = createResource(loadIndex)
  const [query, setQuery] = createSignal("")
  const [division, setDivision] = createSignal<string>()
  const [shown, setShown] = createSignal(PAGE)
  const [open, setOpen] = createSignal<AgentInfo>()
  const [team, setTeam] = createSignal<AgentInfo[]>([])
  const results = createMemo(() => (index() ? searchAgents(index()!.agents, query(), division(), index()!.divisions) : []))
  const inTeam = (a: AgentInfo) => team().some((t) => t.slug === a.slug)
  const toggle = (a: AgentInfo) => setTeam((t) => (inTeam(a) ? t.filter((x) => x.slug !== a.slug) : t.length < MAX_MEMBERS ? [...t, a] : t))
  const divisionOf = (a: AgentInfo) => index()?.divisions[a.division]

  // Opening the reports counts as seeing them.
  createEffect(() => tab() === "tasks" && agency.tasks.length && markSeen())

  return (
    <div class="tool-view agents-view">
      <header class="topbar tool-top">
        <button class="icon-button mobile-only" aria-label="Open sidebar" onClick={props.onMenu}>
          <IconMenu />
        </button>
        <strong class="tool-title">Agents</strong>
        <span class="small-text muted agents-count">
          <Show when={index()}>{(i) => `${i().agents.length} specialists`}</Show>
        </span>
      </header>
      <div class="tabs-row omni-tabs" role="tablist">
        <button role="tab" aria-selected={tab() === "agency"} classList={{ on: tab() === "agency" }} onClick={() => setTab("agency")}>
          The Agency
        </button>
        <button role="tab" aria-selected={tab() === "tasks"} classList={{ on: tab() === "tasks" }} onClick={() => setTab("tasks")}>
          Tasks & reports{agency.tasks.length ? ` (${agency.tasks.length})` : ""}
        </button>
      </div>
      <div class="tool-body agents-body" classList={{ "with-tray": tab() === "agency" && team().length > 0 }}>
        <Show when={tab() === "agency"}>
          <p class="small-text muted">
            Specialist AI agents from{" "}
            <a href="https://github.com/msitarzewski/agency-agents" target="_blank" rel="noopener">
              The Agency
            </a>{" "}
            (MIT). Pick one, or a team of up to {MAX_MEMBERS} who work in order, give them a task, and they report back. Tasks keep running on the server when you
            close the app.
          </p>
          <Show when={index.error}>
            <p class="notice error small-text">Couldn't load the agents. Check your connection and reopen this screen.</p>
          </Show>
          <input class="text-input agents-search" type="search" placeholder="Search agents: SEO, React, pricing, security…" value={query()} onInput={(e) => (setQuery(e.currentTarget.value), setShown(PAGE))} />
          <div class="chips agents-divisions">
            <button class="chip" classList={{ on: !division() }} onClick={() => (setDivision(undefined), setShown(PAGE))}>
              All
            </button>
            <For each={Object.entries(index()?.divisions ?? {})}>
              {([id, d]) => (
                <button class="chip" classList={{ on: division() === id }} onClick={() => (setDivision(division() === id ? undefined : id), setShown(PAGE))}>
                  <span class="division-dot" style={{ background: d.color }} />
                  {d.label}
                </button>
              )}
            </For>
          </div>
          <Show when={!query() && !division() && index()}>
            <h3 class="omni-h">Ready-made teams</h3>
            <div class="team-presets">
              <For each={TEAMS}>
                {(preset) => {
                  const members = () => preset.slugs.map((s) => index()!.agents.find((a) => a.slug === s)).filter((a): a is AgentInfo => !!a)
                  return (
                    <button class="team-preset" onClick={() => setTeam(members())}>
                      <strong>{preset.name}</strong>
                      <span class="small-text muted">{preset.hint}</span>
                      <span class="team-emojis">{members().map((a) => a.emoji ?? "🤖").join(" ")}</span>
                    </button>
                  )
                }}
              </For>
            </div>
            <h3 class="omni-h">All agents</h3>
          </Show>
          <div class="agent-grid">
            <For each={results().slice(0, shown())}>
              {(a) => (
                <div class="agent-card" classList={{ picked: inTeam(a) }}>
                  <button class="agent-open" onClick={() => setOpen(a)}>
                    <span class="agent-emoji">{a.emoji ?? "🤖"}</span>
                    <span class="agent-text">
                      <strong>{a.name}</strong>
                      <span class="small-text agent-division" style={{ color: divisionOf(a)?.color }}>
                        {divisionOf(a)?.label}
                      </span>
                      <span class="small-text muted agent-desc">{a.vibe ?? a.description}</span>
                    </span>
                  </button>
                  <button class="small-button button agent-add" aria-pressed={inTeam(a)} onClick={() => toggle(a)} disabled={!inTeam(a) && team().length >= MAX_MEMBERS}>
                    {inTeam(a) ? "✓ In team" : "+ Add"}
                  </button>
                </div>
              )}
            </For>
          </div>
          <Show when={index() && !results().length}>
            <p class="muted">No agents match that.</p>
          </Show>
          <Show when={results().length > shown()}>
            <button class="button" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({results().length - shown()} left)
            </button>
          </Show>
        </Show>
        <Show when={tab() === "tasks"}>
          <Tasks onAgency={() => setTab("agency")} />
        </Show>
      </div>
      <Show when={tab() === "agency" && team().length > 0}>
        <AssignTray
          team={team()}
          onRemove={(a) => setTeam((t) => t.filter((x) => x.slug !== a.slug))}
          onAssigned={() => {
            setTeam([])
            setTab("tasks")
          }}
        />
      </Show>
      <Show when={open()}>
        {(a) => <AgentSheet agent={a()} division={divisionOf(a())?.label} inTeam={inTeam(a())} onToggle={() => toggle(a())} onClose={() => setOpen(undefined)} />}
      </Show>
    </div>
  )
}

function AgentSheet(props: { agent: AgentInfo; division?: string; inTeam: boolean; onToggle: () => void; onClose: () => void }) {
  const [showBrief, setShowBrief] = createSignal(false)
  const [brief] = createResource(() => props.agent.slug, loadBrief)
  const notes = () => toolNotes(props.agent.tools)
  return (
    <Modal title={`${props.agent.emoji ?? "🤖"} ${props.agent.name}`} onClose={props.onClose}>
      <p class="small-text muted">{props.division}</p>
      <Show when={props.agent.vibe}>
        <p>
          <em>{props.agent.vibe}</em>
        </p>
      </Show>
      <p class="small-text">{props.agent.description}</p>
      <Show when={notes().length}>
        <p class="small-text muted">Its tools in Jonny's AI:</p>
        <ul class="small-text omni-list">
          <For each={notes()}>{(n) => <li>{n}</li>}</For>
        </ul>
      </Show>
      <div class="ai-row">
        <button class="button primary" onClick={props.onToggle}>
          {props.inTeam ? "Remove from team" : "Give it a task"}
        </button>
        <button
          class="button"
          disabled={!brief()}
          onClick={() => {
            chatWith(props.agent.name, brief()!)
            setView("chat")
          }}
        >
          <IconChat /> Chat with {props.agent.name}
        </button>
      </div>
      <button class="link-button" onClick={() => setShowBrief(!showBrief())}>
        {showBrief() ? "Hide the full brief" : "Read the full brief"}
      </button>
      <Show when={showBrief()}>
        <Show when={brief()} fallback={<p class="small-text muted">Loading…</p>}>
          {(b) => <div class="markdown agent-brief" innerHTML={renderMarkdown(b())} />}
        </Show>
      </Show>
    </Modal>
  )
}

function AssignTray(props: { team: AgentInfo[]; onRemove: (a: AgentInfo) => void; onAssigned: () => void }) {
  const [task, setTask] = createSignal("")
  const [cowork, setCowork] = createSignal(false)
  const [search, setSearch] = createSignal(false)
  const go = () => {
    const text = task().trim()
    if (!text) return
    void assign(text, props.team, { cowork: cowork(), search: search() && omniConfigured() })
    setTask("")
    props.onAssigned()
  }
  return (
    <div class="assign-tray">
      <div class="tray-team">
        <For each={props.team}>
          {(a, i) => (
            <span class="tray-chip">
              {i() > 0 ? <span class="muted">→</span> : null}
              {a.emoji ?? "🤖"} {a.name}
              <button class="icon-button small" aria-label={`Remove ${a.name}`} onClick={() => props.onRemove(a)}>
                <IconX />
              </button>
            </span>
          )}
        </For>
      </div>
      <textarea
        class="text-input"
        rows={3}
        placeholder={props.team.length > 1 ? "What should the team do? They work in this order, each building on the last." : `What should ${props.team[0].name} do?`}
        value={task()}
        onInput={(e) => setTask(e.currentTarget.value)}
      />
      <div class="ai-row">
        <label class="small-text">
          <input type="checkbox" checked={cowork()} onChange={(e) => setCowork(e.currentTarget.checked)} /> Include Cowork files
        </label>
        <label class="small-text" title={omniConfigured() ? "" : "Needs OmniRoute with a search provider (Omni screen)"}>
          <input type="checkbox" checked={search()} disabled={!omniConfigured()} onChange={(e) => setSearch(e.currentTarget.checked)} /> Search the web first
        </label>
        <span class="spacer" />
        <button class="button primary" disabled={!task().trim()} onClick={go}>
          Assign{props.team.length > 1 ? " to team" : ""}
        </button>
      </div>
      <p class="small-text muted">Links in the task are read for the agents.</p>
    </div>
  )
}

const STATUS: Record<AgentTask["status"], string> = { preparing: "Getting ready…", running: "Working…", done: "Reported back", error: "Stopped with an error", stopped: "Stopped" }

function reportOf(t: AgentTask) {
  return [`# ${t.task.split("\n")[0].slice(0, 120)}`, ...t.steps.filter((s) => s.text).map((s) => `## ${s.emoji ?? ""} ${s.name}\n\n${s.text.trim()}`)].join("\n\n")
}

function Tasks(props: { onAgency: () => void }) {
  const [permission, setPermission] = createSignal(typeof Notification === "undefined" ? "unsupported" : Notification.permission)
  return (
    <>
      <Show when={permission() === "default"}>
        <div class="ai-row">
          <button class="button small-button" onClick={() => void Notification.requestPermission().then(setPermission)}>
            Notify me when reports are ready
          </button>
        </div>
      </Show>
      <Show when={!agency.tasks.length}>
        <div class="cw-empty">
          <IconBot />
          <h3>No tasks yet</h3>
          <p class="muted">Pick an agent or a team in The Agency, give them a task, and their reports appear here.</p>
          <button class="button primary" onClick={props.onAgency}>
            Browse agents
          </button>
        </div>
      </Show>
      <For each={agency.tasks}>{(t) => <TaskCard task={t} />}</For>
    </>
  )
}

function TaskCard(props: { task: AgentTask }) {
  const t = () => props.task
  const [saved, setSaved] = createSignal<string>()
  const active = () => t().status === "preparing" || t().status === "running"
  const files = createMemo(() => t().steps.flatMap((s) => (s.status === "done" ? parseFileChanges(s.text) : [])))
  const saveFiles = async () => {
    const { writeText, restoreCowork } = await import("../../lib/coworkspace")
    await restoreCowork()
    for (const f of files()) writeText(f.path, f.content)
    setSaved(`Saved ${files().length} file${files().length === 1 ? "" : "s"} to Cowork.`)
  }
  const saveReport = async () => {
    const { writeText, restoreCowork, findFile } = await import("../../lib/coworkspace")
    await restoreCowork()
    const base = `report-${t().steps.map((s) => s.slug.split("-").pop()).join("-")}`.slice(0, 60)
    let path = `${base}.md`
    for (let n = 2; findFile(path); n++) path = `${base} (${n}).md`
    writeText(path, reportOf(t()))
    setSaved(`Saved to Cowork as ${path}.`)
  }
  return (
    <article class="omni-card task-card">
      <header class="omni-card-head">
        <span class="team-emojis">{t().steps.map((s) => s.emoji ?? "🤖").join("")}</span>
        <div class="omni-card-title">
          <strong>{t().steps.map((s) => s.name).join(" → ")}</strong>
          <span class="small-text muted">
            {STATUS[t().status]} · {new Date(t().at).toLocaleString()}
          </span>
        </div>
        <Show when={active()}>
          <button class="icon-button" aria-label="Stop" title="Stop" onClick={() => stopTask(t().id)}>
            <IconStop />
          </button>
        </Show>
        <button class="icon-button" aria-label="Remove task" title="Remove" onClick={() => removeTask(t().id)}>
          <IconTrash />
        </button>
      </header>
      <p class="task-text">{t().task}</p>
      <Show when={t().context.length}>
        <p class="small-text muted">With: {t().context.join(", ")}</p>
      </Show>
      <Show when={active() && t().job}>
        <p class="small-text muted">Running on the server: it keeps going if you close the app.</p>
      </Show>
      <For each={t().steps}>
        {(s, i) => (
          <details class="task-step" open={s.status === "running" || (t().status !== "running" && i() === t().steps.length - 1) || s.status === "error"}>
            <summary>
              <span class={`step-dot ${s.status}`} />
              {s.emoji ?? "🤖"} <strong>{s.name}</strong>
              <span class="small-text muted">
                {" "}
                · {s.status === "waiting" ? "waiting" : s.status === "running" ? "working…" : s.status === "done" ? "reported" : "failed"}
              </span>
            </summary>
            <Show when={s.text}>
              <div class="markdown step-report" innerHTML={renderMarkdown(s.text)} />
            </Show>
            <Show when={s.error}>
              <p class="notice error small-text">{s.error}</p>
            </Show>
            <Show when={s.notice}>
              <p class="notice small-text">{s.notice}</p>
            </Show>
          </details>
        )}
      </For>
      <Show when={t().error && !t().steps.some((s) => s.error === t().error)}>
        <p class="notice error small-text">{t().error}</p>
      </Show>
      <Show when={!active() && t().steps.some((s) => s.text)}>
        <div class="ai-row">
          <Show when={files().length}>
            <button class="button primary small-button" onClick={() => void saveFiles()}>
              Save {files().length} file{files().length === 1 ? "" : "s"} to Cowork
            </button>
          </Show>
          <button class="button small-button" onClick={() => void saveReport()}>
            Save report to Cowork
          </button>
          <button class="button small-button" onClick={() => void navigator.clipboard?.writeText(reportOf(t()))}>
            <IconCopy /> Copy
          </button>
          <button class="button small-button" onClick={() => download("agent-report.md", reportOf(t()), "text/markdown")}>
            <IconDownload /> Download
          </button>
        </div>
        <Show when={saved()}>
          <p class="small-text muted">{saved()}</p>
        </Show>
      </Show>
    </article>
  )
}
