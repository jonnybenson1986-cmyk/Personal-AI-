// The Agency's agents (github.com/msitarzewski/agency-agents, MIT): reading their files and
// finding them in the roster. Pure functions, used by scripts/import-agents.ts and the app,
// unit tested.

export interface AgentInfo {
  /** File name without .md, unique across the roster, e.g. "engineering-code-reviewer". */
  slug: string
  division: string
  name: string
  description: string
  emoji?: string
  color?: string
  vibe?: string
  /** Tools the agent expects in coding assistants (WebSearch, Read…), as its file lists them. */
  tools?: string[]
}

export interface Division {
  label: string
  color: string
}

export interface AgentIndex {
  source: { repo: string; commit: string; license: string }
  divisions: Record<string, Division>
  agents: AgentInfo[]
}

/**
 * Splits an agent file into its front matter (simple YAML: `key: value`, quoted values, and
 * `>` or `|` blocks) and the brief after it. Undefined when there's no front matter.
 */
export function parseAgentFile(text: string): { meta: Record<string, string>; body: string } | undefined {
  const match = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return undefined
  const meta: Record<string, string> = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if (/^[>|][+-]?$/.test(value)) {
      // A block: the indented lines after it, folded into one line (>) or kept as lines (|).
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim())
      value = value.startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n").trim()
    } else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"')
    meta[m[1]] = value
  }
  return { meta, body: match[2].trim() }
}

/** The roster entry for an agent file, or undefined if it isn't one (no name or description). */
export function agentInfo(slug: string, division: string, text: string): { info: AgentInfo; body: string } | undefined {
  const parsed = parseAgentFile(text)
  if (!parsed) return undefined
  const { meta } = parsed
  if (!meta.name || !meta.description || !parsed.body) return undefined
  const tools = meta.tools
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    info: {
      slug,
      division,
      name: meta.name,
      description: meta.description,
      ...(meta.emoji ? { emoji: meta.emoji } : {}),
      ...(meta.color ? { color: meta.color } : {}),
      ...(meta.vibe ? { vibe: meta.vibe } : {}),
      ...(tools?.length ? { tools } : {}),
    },
    body: parsed.body,
  }
}

/** Agents matching a search (every word somewhere in the name, description, vibe or division), best first. */
export function searchAgents(agents: AgentInfo[], query: string, division?: string, divisions: Record<string, Division> = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const scored: { a: AgentInfo; score: number }[] = []
  for (const a of agents) {
    if (division && a.division !== division) continue
    const name = a.name.toLowerCase()
    const all = `${name} ${a.description} ${a.vibe ?? ""} ${divisions[a.division]?.label ?? a.division}`.toLowerCase()
    if (!words.every((w) => all.includes(w))) continue
    const score = words.reduce((s, w) => s + (name.startsWith(w) ? 3 : name.includes(w) ? 2 : 0), 0)
    scored.push({ a, score })
  }
  return scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name)).map((x) => x.a)
}

/** Ready-made teams for common jobs, from The Agency's own example workflows. */
export const TEAMS: { name: string; hint: string; slugs: string[] }[] = [
  { name: "Landing page sprint", hint: "Copy → design → build → conversion", slugs: ["marketing-content-creator", "design-ui-designer", "engineering-frontend-developer", "marketing-growth-hacker"] },
  { name: "Code review", hint: "Quality, then security", slugs: ["engineering-code-reviewer", "security-appsec-engineer"] },
  { name: "Idea to plan", hint: "Research → product plan → priorities", slugs: ["product-trend-researcher", "product-manager", "product-sprint-prioritizer"] },
  { name: "Social campaign", hint: "Strategy → posts → on-brand check", slugs: ["marketing-social-media-strategist", "marketing-content-creator", "design-brand-guardian"] },
]

/** What an agent's listed tools mean in Jonny's AI. */
export function toolNotes(tools: string[] = []) {
  const notes: string[] = []
  const has = (t: string) => tools.includes(t)
  if (has("WebFetch")) notes.push("Web pages: links in your task are read for it")
  if (has("WebSearch")) notes.push("Web search: through OmniRoute's search, when connected")
  if (has("Read") || has("Edit")) notes.push("Files: your Cowork files can go with the task")
  if (has("Write") || has("Edit")) notes.push("Deliverables: files it writes can be saved to Cowork")
  if (has("Bash")) notes.push("Commands: can't run here, so it works without them")
  return notes
}
