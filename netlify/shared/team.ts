// Agents from The Agency (github.com/msitarzewski/agency-agents, MIT) working on a task for
// the user: one specialist, or a team that works in order, each building on the reports
// before. Shared by the background job (which runs teams on the server) and the app (which
// runs them itself when the server can't). Pure functions, unit tested.

export interface TeamMember {
  /** The agent's name, e.g. "Code Reviewer". */
  name: string
  /** The agent's brief (its markdown file without the front matter): who it is and how it works. */
  brief: string
}

export const MAX_MEMBERS = 6
export const MAX_BRIEF = 80_000
export const MAX_TASK = 400_000

export const REPORT_FORMAT = `When you're done, report back in exactly this shape:

## Summary
Two or three sentences: what you did and what came out of it.

## Work
The deliverable itself, complete and ready to use: the copy, plan, design spec, code, analysis or review the task asked for. Not a description of it.

## Next steps
What should happen next, and which kind of specialist should do it.

When the work includes documents or code, give each one as a complete file in its own fenced code block with the language and a file name on the opening line, like \`\`\`md path=launch-plan.md, so it can be saved.`

/** How a member works inside Jonny's AI, added after its own brief. */
export function workingRules(members: TeamMember[], index: number) {
  const me = members[index]
  const team =
    members.length > 1
      ? `You're step ${index + 1} of ${members.length} in a team working in this order: ${members.map((m) => m.name).join(" → ")}. ${
          index > 0 ? "Your teammates' reports so far are included with the task: build on them, keep what works, and don't repeat their work. " : ""
        }${index < members.length - 1 ? `${members[index + 1].name} takes over from your report, so make it something they can build on.` : "You're the last step: bring the team's work together into the final result."}`
      : ""
  return [
    `You're working as ${me.name} for the user of Jonny's AI project, an AI agency where specialists are given tasks and report back.`,
    "You can't browse the web, run commands or open files yourself here. Work from the task, any files, web pages or search results included with it, and your expertise. If something essential is missing, say what it is, make sensible assumptions, and carry on.",
    team,
    REPORT_FORMAT,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** The chat messages for one member: its brief and rules, then the task and earlier reports. */
export function teamMessages(task: string, members: TeamMember[], index: number, reports: string[]) {
  const me = members[index]
  const earlier = reports
    .slice(0, index)
    .map((r, i) => `<report from="${members[i].name}">\n${r.trim()}\n</report>`)
    .join("\n\n")
  return [
    { role: "system" as const, content: `${me.brief.trim()}\n\n---\n\n${workingRules(members, index)}` },
    { role: "user" as const, content: earlier ? `${task}\n\nReports from your teammates so far:\n\n${earlier}` : task },
  ]
}

/** A team from untrusted input, or why it isn't one. */
export function readTeam(raw: unknown): { task: string; members: TeamMember[] } | string {
  const t = raw as { task?: unknown; members?: unknown }
  if (!t || typeof t.task !== "string" || !t.task.trim()) return "Missing task."
  if (t.task.length > MAX_TASK) return "The task is too long."
  if (!Array.isArray(t.members) || !t.members.length || t.members.length > MAX_MEMBERS) return `A team has 1 to ${MAX_MEMBERS} agents.`
  const members: TeamMember[] = []
  for (const m of t.members as { name?: unknown; brief?: unknown }[]) {
    if (!m || typeof m.name !== "string" || !m.name.trim() || m.name.length > 120) return "An agent is missing its name."
    if (typeof m.brief !== "string" || !m.brief.trim() || m.brief.length > MAX_BRIEF) return `${m.name}'s brief is missing or too long.`
    members.push({ name: m.name.trim(), brief: m.brief })
  }
  return { task: t.task, members }
}
