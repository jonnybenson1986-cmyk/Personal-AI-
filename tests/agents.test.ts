import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { type AgentIndex, agentInfo, parseAgentFile, searchAgents, TEAMS, toolNotes } from "../src/lib/agents.ts"
import { MAX_MEMBERS, readTeam, REPORT_FORMAT, teamMessages, workingRules } from "../netlify/shared/team.ts"

test("agent files: front matter with plain, quoted and block values, then the brief", () => {
  const file = `﻿---\nname: Code Reviewer\ndescription: >\n  Reviews code\n  like a mentor.\ncolor: "purple"\nemoji: 👁️\nnotes: |\n  line one\n  line two\ntools: WebFetch, WebSearch,  Read\n---\n\n# Code Reviewer\n\nYou are **Code Reviewer**.\n`
  const parsed = parseAgentFile(file)!
  assert.equal(parsed.meta.name, "Code Reviewer")
  assert.equal(parsed.meta.description, "Reviews code like a mentor.")
  assert.equal(parsed.meta.color, "purple")
  assert.equal(parsed.meta.notes, "line one\nline two")
  assert.equal(parsed.body, "# Code Reviewer\n\nYou are **Code Reviewer**.")
  const { info } = agentInfo("engineering-code-reviewer", "engineering", file)!
  assert.deepEqual(info.tools, ["WebFetch", "WebSearch", "Read"])
  assert.equal(info.emoji, "👁️")
  assert.equal(parseAgentFile("# No front matter"), undefined)
  assert.equal(agentInfo("x", "y", "---\nname: Only a name\n---\nBody"), undefined)
})

const agents = [
  { slug: "engineering-code-reviewer", division: "engineering", name: "Code Reviewer", description: "Reviews code for security and correctness" },
  { slug: "security-appsec-engineer", division: "security", name: "AppSec Engineer", description: "Finds security holes in apps" },
  { slug: "marketing-seo-specialist", division: "marketing", name: "SEO Specialist", description: "Search rankings and content", vibe: "Gets you found" },
]

test("searching the roster: every word must match, names rank first, divisions filter", () => {
  // Ties sort by name; a word in the name ranks higher.
  assert.deepEqual(searchAgents(agents, "security").map((a) => a.slug), ["security-appsec-engineer", "engineering-code-reviewer"])
  assert.deepEqual(searchAgents(agents, "engineer").map((a) => a.slug), ["security-appsec-engineer", "engineering-code-reviewer"])
  assert.deepEqual(searchAgents(agents, "seo").map((a) => a.slug), ["marketing-seo-specialist"])
  assert.deepEqual(searchAgents(agents, "code security").map((a) => a.slug), ["engineering-code-reviewer"])
  assert.deepEqual(searchAgents(agents, "", "security").map((a) => a.slug), ["security-appsec-engineer"])
  assert.deepEqual(searchAgents(agents, "found").map((a) => a.slug), ["marketing-seo-specialist"])
  assert.equal(searchAgents(agents, "").length, 3)
})

test("the imported roster is complete: every agent has its brief, and ready-made teams exist", () => {
  const index = JSON.parse(readFileSync("public/agents/index.json", "utf8")) as AgentIndex
  assert.ok(index.agents.length > 250)
  assert.equal(index.source.license, "MIT")
  assert.ok(existsSync("public/agents/LICENSE.md"))
  assert.equal(new Set(index.agents.map((a) => a.slug)).size, index.agents.length)
  for (const a of index.agents) {
    assert.ok(index.divisions[a.division], a.slug)
    assert.ok(existsSync(`public/agents/${a.slug}.md`), a.slug)
  }
  for (const t of TEAMS) {
    assert.ok(t.slugs.length <= MAX_MEMBERS)
    for (const s of t.slugs) assert.ok(index.agents.some((a) => a.slug === s), `${t.name}: ${s}`)
  }
})

test("tools an agent lists are explained in terms of what Jonny's AI can do", () => {
  const notes = toolNotes(["WebFetch", "WebSearch", "Read", "Write", "Edit", "Bash"])
  assert.equal(notes.length, 5)
  assert.ok(notes.some((n) => n.startsWith("Commands")))
  assert.deepEqual(toolNotes(), [])
})

test("each team member gets its brief, its place in the team and the reports before it", () => {
  const members = [
    { name: "Content Creator", brief: "You write copy." },
    { name: "UI Designer", brief: "You design." },
    { name: "Frontend Developer", brief: "You build." },
  ]
  const first = teamMessages("Make a landing page", members, 0, [])
  assert.equal(first[0].role, "system")
  assert.ok(first[0].content.startsWith("You write copy."))
  assert.match(first[0].content, /step 1 of 3 .*Content Creator → UI Designer → Frontend Developer/)
  assert.match(first[0].content, /UI Designer takes over from your report/)
  assert.ok(first[0].content.includes(REPORT_FORMAT))
  assert.equal(first[1].content, "Make a landing page")
  const last = teamMessages("Make a landing page", members, 2, ["Copy here", "Design here"])
  assert.match(last[0].content, /You're the last step/)
  assert.match(last[1].content, /<report from="Content Creator">\nCopy here\n<\/report>/)
  assert.match(last[1].content, /<report from="UI Designer">\nDesign here\n<\/report>/)
  // A single agent isn't told about a team.
  assert.doesNotMatch(workingRules([members[0]], 0), /step 1/)
})

test("teams from requests are checked", () => {
  assert.equal(typeof readTeam({ task: "x", members: [] }), "string")
  assert.equal(typeof readTeam({ task: "", members: [{ name: "A", brief: "b" }] }), "string")
  assert.equal(typeof readTeam({ task: "x", members: Array(MAX_MEMBERS + 1).fill({ name: "A", brief: "b" }) }), "string")
  assert.equal(typeof readTeam({ task: "x", members: [{ name: "A", brief: "" }] }), "string")
  assert.deepEqual(readTeam({ task: "x", members: [{ name: " A ", brief: "b", extra: 1 }] }), { task: "x", members: [{ name: "A", brief: "b" }] })
})
