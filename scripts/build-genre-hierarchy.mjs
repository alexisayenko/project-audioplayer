#!/usr/bin/env node
// Review-only hierarchy evidence: server/data/genre_hierarchy_evidence.json (not loaded by the server).
// Usage (WSL): node scripts/build-genre-hierarchy.mjs [--cache DIR] [--refresh]
// Needs server/data/genre_sources.json (run build-genre-sources.mjs first). Resumable: every response is cached in DIR.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheKey } from "./genre-sources-lib.mjs";
import { buildResolver, parseInfobox, parseLead } from "./genre-hierarchy-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "server", "data");
const args = process.argv.slice(2);
const argVal = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const CACHE = argVal("--cache") || process.env.GENRE_SOURCES_CACHE || join(tmpdir(), "genre-sources-cache");
const REFRESH = args.includes("--refresh");
const UA = "ElectrophoneGenreSources/1.0 (https://electrophone.cc; alex.isayenko@gmail.com)";
const GAP_MS = 1100;
const GENERIC_CLASSES = new Set(["Q188451"]);

mkdirSync(CACHE, { recursive: true });
let lastCall = 0;
let network = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const file = join(CACHE, cacheKey(url) + ".json");
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      network++;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      writeFileSync(file, JSON.stringify(body));
      return body;
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error(`${url}: ${lastErr.message}`);
}

const readJson = (name) => JSON.parse(readFileSync(join(DATA, name), "utf8"));

function loadVocabulary() {
  const discogs = readJson("genre_discogs.json");
  const extras = readJson("genre_extras.json");
  const levels = readJson("genre_levels.json");
  const names = new Map();
  for (const f of discogs.families) names.set(f.toLowerCase(), { name: f.toLowerCase(), synonyms: [...(levels.families?.[f]?.synonyms || [])] });
  const add = (n) => {
    const lv = levels[n] || {};
    const syn = [...(lv.synonyms || [])];
    if (lv.display && lv.display.toLowerCase() !== n) syn.push(lv.display);
    names.set(n, { name: n, synonyms: syn });
  };
  for (const n of Object.keys(discogs.genres)) add(n);
  for (const n of Object.keys(extras.extras)) add(n);
  return [...names.values()];
}

async function entities(ids, props) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const body = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join("|")}&props=${props}&languages=en&format=json`);
    Object.assign(out, body.entities || {});
  }
  return out;
}

const claimIds = (e, p) => (e?.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

async function main() {
  const vocab = loadVocabulary();
  const sources = readJson("genre_sources.json");
  const resolver = buildResolver(vocab, sources);
  const matched = vocab.filter((g) => sources[g.name]?.wikipedia);

  const ents = await entities(matched.map((g) => sources[g.name].wikipedia.wikidata), "claims|labels");
  const parentIds = new Set();
  for (const e of Object.values(ents)) for (const p of ["P279", "P31"]) for (const q of claimIds(e, p)) if (!GENERIC_CLASSES.has(q)) parentIds.add(q);
  const labels = await entities([...parentIds], "labels");
  const labelOf = (q) => labels[q]?.labels?.en?.value || null;
  const asRef = (q, self) => {
    const label = labelOf(q);
    const key = resolver.qid(q) || (label ? resolver.label(label) : null);
    return { q, label, key: key === self ? null : key };
  };

  const out = {};
  let withWd = 0;
  let withLead = 0;
  let withOrigins = 0;
  for (const g of matched) {
    const wp = sources[g.name].wikipedia;
    const e = ents[wp.wikidata];
    const entry = { wikidata: wp.wikidata, wikipedia: wp.title };
    entry.subclass_of = claimIds(e, "P279").map((q) => asRef(q, g.name));
    entry.instance_of = claimIds(e, "P31").filter((q) => !GENERIC_CLASSES.has(q)).map((q) => asRef(q, g.name));
    entry.lead_parents = [];
    entry.origins = [];
    entry.derivatives = [];
    try {
      const body = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(wp.title)}&prop=wikitext&section=0&redirects=1&format=json&formatversion=2`);
      const text = body.parse?.wikitext || "";
      const ref = (label) => { const key = resolver.label(label); return { label, key: key === g.name ? null : key }; };
      entry.lead_parents = parseLead(text).map((x) => ({ ...ref(x.label), phrase_kind: x.phrase_kind }));
      const box = parseInfobox(text);
      entry.origins = box.origins.map(ref);
      entry.derivatives = box.derivatives.map(ref);
    } catch (err) {
      failures.push(`${g.name}: ${err.message}`);
      entry.error = "wikipedia fetch failed";
    }
    if (entry.subclass_of.length || entry.instance_of.length) withWd++;
    if (entry.lead_parents.length) withLead++;
    if (entry.origins.length) withOrigins++;
    out[g.name] = entry;
  }
  const meta = {
    generated_at: new Date().toISOString(),
    review_only: "Not loaded by the server and not in the payload. Compare with scripts/hierarchy-diff.mjs.",
    genres_with_wikipedia_match: matched.length,
    with_wikidata_parents: withWd,
    with_lead_parents: withLead,
    with_origins: withOrigins,
    fetch_failures: failures,
    how: "subclass_of / instance_of: Wikidata P279 / P31 of the matched item (instance of 'music genre' left out), labels in English. lead_parents: links in the first sentence after 'subgenre of', 'genre/style/form of', 'fusion of', 'offshoot/derivative of', 'derived/evolved/emerged from' (phrase_kind subgenre, genre_of, fusion, offshoot). origins / derivatives: links of the infobox fields stylistic_origins and derivatives. key: the vocabulary key the label maps to through the Wikipedia title, then the name, then a synonym (null: not in our vocabulary or ambiguous).",
  };
  writeFileSync(join(DATA, "genre_hierarchy_evidence.json"), JSON.stringify({ _meta: meta, ...out }, null, 1) + "\n");
  console.log(JSON.stringify({ ...meta, how: undefined, networkCalls: network }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
