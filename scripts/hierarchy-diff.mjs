#!/usr/bin/env node
// Compares server/data/genre_hierarchy_evidence.json with the parents[] of the working-tree genre_levels.json.
// Usage: node scripts/hierarchy-diff.mjs [--out DIR] [--family NAME]
// Writes hierarchy-diff-<family>.md per family into DIR (default: the OS temp dir) and prints the counts per family.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffGenre } from "./genre-hierarchy-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "server", "data");
const args = process.argv.slice(2);
const argVal = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const OUT = argVal("--out") || tmpdir();
const ONLY = argVal("--family");
const readJson = (n) => JSON.parse(readFileSync(join(DATA, n), "utf8"));

const levels = readJson("genre_levels.json");
const evidence = readJson("genre_hierarchy_evidence.json");
const familyNames = Object.keys(levels.families);
const familyKey = new Map(familyNames.map((f) => [f.toLowerCase(), f]));
const skip = new Set(["_meta", "families", "flavours", "subfamilies"]);
const genres = Object.keys(levels).filter((k) => !skip.has(k));

const parentsOf = (k) => (levels[k]?.parents || []).map((p) => p.toLowerCase());
const familyOf = (k) => {
  if (levels[k]?.family) return levels[k].family;
  let cur = k;
  for (let i = 0; i < 5; i++) {
    const first = (levels[cur]?.parents || [])[0];
    if (!first) return "?";
    if (familyKey.has(first.toLowerCase())) return familyKey.get(first.toLowerCase());
    cur = first.toLowerCase();
  }
  return "?";
};

const rank = { STRONG: 0, MEDIUM: 1, WEAK: 2 };
const byFamily = new Map(familyNames.map((f) => [f, { rows: [], counts: { genres: 0, with_evidence: 0, additions: { STRONG: 0, MEDIUM: 0, WEAK: 0 }, removals: { STRONG: 0, MEDIUM: 0, WEAK: 0 }, contradictions: 0, no_wikipedia: 0 } }]));
for (const g of genres) {
  const fam = byFamily.get(familyOf(g));
  if (!fam) continue;
  fam.counts.genres++;
  const ev = evidence[g];
  if (!ev) { fam.counts.no_wikipedia++; continue; }
  const d = diffGenre(g, ev, parentsOf(g), parentsOf);
  if (d.noEvidence) continue;
  fam.counts.with_evidence++;
  for (const a of d.additions) fam.counts.additions[a.strength]++;
  for (const r of d.removals) fam.counts.removals[r.strength]++;
  fam.counts.contradictions += d.contradictions.length;
  if (d.additions.length || d.removals.length || d.contradictions.length) fam.rows.push({ g, d });
}

mkdirSync(OUT, { recursive: true });
const summary = {};
for (const [name, { rows, counts }] of byFamily) {
  if (ONLY && ONLY.toLowerCase() !== name.toLowerCase()) continue;
  summary[name] = counts;
  const lines = [`# Hierarchy evidence vs parents[]: ${name}`, "", `Genres ${counts.genres}, with evidence ${counts.with_evidence}, without a Wikipedia match ${counts.no_wikipedia}. Additions STRONG/MEDIUM/WEAK ${counts.additions.STRONG}/${counts.additions.MEDIUM}/${counts.additions.WEAK}; removals ${counts.removals.STRONG}/${counts.removals.MEDIUM}/${counts.removals.WEAK}; contradictions ${counts.contradictions}.`, "", "STRONG = Wikidata and the lead sentence agree, MEDIUM = one of them, WEAK = infobox origins only. Review only: nothing here changes genre_levels.json.", ""];
  const section = (title, pick) => {
    const items = rows.flatMap(({ g, d }) => pick(g, d)).sort((a, b) => rank[a.s] - rank[b.s] || a.g.localeCompare(b.g));
    lines.push(`## ${title} (${items.length})`, "");
    for (const i of items) lines.push(`- ${i.s} ${i.g}: ${i.text}`);
    if (!items.length) lines.push("- none");
    lines.push("");
  };
  section("Candidate additions: evidence parent not in our parents[]", (g, d) => d.additions.map((a) => ({ g, s: a.strength, text: `${a.key} (via ${a.via.join(", ")}); ours: ${parentsOf(g).join(", ")}` })));
  section("Candidate removals: our parent with no evidence", (g, d) => d.removals.map((r) => ({ g, s: r.strength, text: `${r.key}; ours: ${parentsOf(g).join(", ")}` })));
  lines.push(`## Contradictions (${rows.reduce((n, r) => n + r.d.contradictions.length, 0)})`, "", "Evidence names a genre we have below it.", "");
  for (const { g, d } of rows) for (const c of d.contradictions) lines.push(`- ${g}: evidence parent ${c.key} is our descendant`);
  lines.push("");
  writeFileSync(join(OUT, `hierarchy-diff-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`), lines.join("\n"));
}
console.log(JSON.stringify(summary, null, 1));
