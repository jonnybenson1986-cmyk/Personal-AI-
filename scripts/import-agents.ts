// Imports The Agency's agents (github.com/msitarzewski/agency-agents, MIT) into public/agents:
// index.json (the roster), one <slug>.md brief per agent, and the license. Reads the files as
// data only; nothing from the repository is run.
//
//   git clone --depth 1 https://github.com/msitarzewski/agency-agents /tmp/agency-agents
//   node --experimental-strip-types scripts/import-agents.ts /tmp/agency-agents
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { type AgentIndex, type AgentInfo, agentInfo, type Division } from "../src/lib/agents.ts"

const source = process.argv[2]
if (!source) throw new Error("Usage: node --experimental-strip-types scripts/import-agents.ts <path to agency-agents clone>")
const out = join(import.meta.dirname, "..", "public", "agents")

const divisions = (JSON.parse(readFileSync(join(source, "divisions.json"), "utf8")) as { divisions: Record<string, { label: string; color: string }> }).divisions

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return markdownFiles(path)
    return name.endsWith(".md") && !/^readme/i.test(name) ? [path] : []
  })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const agents: AgentInfo[] = []
const kept: Record<string, Division> = {}
for (const [division, d] of Object.entries(divisions)) {
  for (const file of markdownFiles(join(source, division)).sort()) {
    const slug = basename(file, ".md")
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Unexpected file name: ${file}`)
    if (agents.some((a) => a.slug === slug)) throw new Error(`Two agents are called ${slug}`)
    const parsed = agentInfo(slug, division, readFileSync(file, "utf8"))
    if (!parsed) continue
    agents.push(parsed.info)
    kept[division] = { label: d.label, color: d.color }
    writeFileSync(join(out, `${slug}.md`), parsed.body + "\n")
  }
}

const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const index: AgentIndex = {
  source: { repo: "https://github.com/msitarzewski/agency-agents", commit, license: "MIT" },
  divisions: kept,
  agents,
}
writeFileSync(join(out, "index.json"), JSON.stringify(index))
writeFileSync(
  join(out, "LICENSE.md"),
  `The agents in this folder come from The Agency (https://github.com/msitarzewski/agency-agents),\ncommit ${commit}, under the MIT License:\n\n${readFileSync(join(source, "LICENSE"), "utf8")}`,
)
console.log(`Imported ${agents.length} agents in ${Object.keys(kept).length} divisions from ${commit.slice(0, 7)}.`)
