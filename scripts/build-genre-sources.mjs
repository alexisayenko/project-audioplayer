#!/usr/bin/env node
// One-off builder of server/data/genre_sources.json and genre_sources_review.json.
// Usage (WSL): node scripts/build-genre-sources.mjs [--cache DIR] [--refresh]
// Raw downloads are cached in DIR (default: $GENRE_SOURCES_CACHE or the OS temp dir), never in the repo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheKey, flattenApple, indexByNorm, matchSource, normalise } from "./genre-sources-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "server", "data");
const args = process.argv.slice(2);
const argVal = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const CACHE = argVal("--cache") || process.env.GENRE_SOURCES_CACHE || join(tmpdir(), "genre-sources-cache");
const REFRESH = args.includes("--refresh");
const UA = "ElectrophoneGenreSources/1.0 (https://electrophone.cc; alex.isayenko@gmail.com)";
const GAP_MS = 1100;
const MUSIC_GENRE_CLASSES = new Set(["Q188451"]);
const SOURCES = ["musicbrainz", "wikipedia", "apple_music"];

mkdirSync(CACHE, { recursive: true });
let lastCall = 0;
let network = 0;
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
  const spell = discogs.discogs_names || {};
  for (const f of discogs.families) {
    const syn = [...(levels.families?.[f]?.synonyms || [])];
    names.set(f.toLowerCase(), { name: f.toLowerCase(), synonyms: syn, discogs: true, discogsName: f });
  }
  const add = (n) => {
    const lv = levels[n] || {};
    const syn = [...(lv.synonyms || [])];
    if (lv.display && lv.display.toLowerCase() !== n) syn.push(lv.display);
    names.set(n, { name: n, synonyms: syn, discogs: levels[n] ? lv.discogs === true : null, discogsName: spell[n] || n });
  };
  for (const n of Object.keys(discogs.genres)) add(n);
  for (const n of Object.keys(extras.extras)) add(n);
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function musicbrainz() {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const page = await getJson(`https://musicbrainz.org/ws/2/genre/all?fmt=json&limit=100&offset=${offset}`);
    all.push(...page.genres);
    if (all.length >= page["genre-count"] || !page.genres.length) break;
  }
  return all;
}

async function appleGenres() {
  const doc = await getJson("https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres");
  return flattenApple(doc);
}

async function wikidata(vocab, notes) {
  const api = "https://www.wikidata.org/w/api.php";
  const hits = new Map();
  const searched = new Set();
  const entities = new Map();
  const search = async (q) => {
    if (searched.has(q)) return;
    searched.add(q);
    const body = await getJson(`${api}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&uselang=en&type=item&limit=50&format=json`);
    for (const r of body.search || []) hits.set(r.id, r);
  };
  const loadEntities = async () => {
    const need = [...hits.keys()].filter((q) => !entities.has(q));
    for (let i = 0; i < need.length; i += 50) {
      const ids = need.slice(i, i + 50).join("|");
      const body = await getJson(`${api}?action=wbgetentities&ids=${ids}&props=labels|aliases|claims|sitelinks&languages=en&sitefilter=enwiki&format=json`);
      for (const [id, e] of Object.entries(body.entities || {})) entities.set(id, e);
    }
  };
  const norms = (e) => {
    const out = new Set();
    const l = e.labels?.en?.value;
    if (l) out.add(normalise(l));
    for (const a of e.aliases?.en || []) out.add(normalise(a.value));
    return out;
  };
  for (const g of vocab) await search(g.name);
  await loadEntities();
  const hasName = (g) => [...entities.values()].some((e) => norms(e).has(normalise(g.name)));
  for (const g of vocab) if (!hasName(g)) for (const s of g.synonyms.slice(0, 4)) await search(s);
  await loadEntities();
  const classStats = {};
  const items = [];
  const nonGenre = [];
  for (const [id, e] of entities) {
    const title = e.sitelinks?.enwiki?.title;
    const claimIds = (p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const p31 = claimIds("P31");
    const isGenre = [...p31, ...claimIds("P279")].some((c) => MUSIC_GENRE_CLASSES.has(c));
    for (const c of p31) classStats[c] = (classStats[c] || 0) + 1;
    if (!title) continue;
    const label = e.labels?.en?.value;
    const it = { qid: id, title, norms: norms(e), labelNorm: label ? normalise(label) : null, p31 };
    (isGenre ? items : nonGenre).push(it);
  }
  notes.wikidata_classes = classStats;
  const idx = new Map();
  const labelIdx = new Map();
  for (const it of items) {
    for (const k of it.norms) {
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(it);
    }
    if (it.labelNorm) {
      if (!labelIdx.has(it.labelNorm)) labelIdx.set(it.labelNorm, []);
      labelIdx.get(it.labelNorm).push(it);
    }
  }
  return { idx, labelIdx, items, nonGenre };
}

const tagged = (source, list) => list.map((r) => ({ source, ...r }));

async function main() {
  const vocab = loadVocabulary();
  const sources = {};
  const review = [];
  const unreachable = [];
  const notes = {};
  const out = {};
  for (const g of vocab) {
    out[g.name] = { discogs: g.discogs };
    if (g.discogsName.toLowerCase() !== g.name) out[g.name].discogs_name = g.discogsName;
  }

  try {
    const mb = await musicbrainz();
    const r = matchSource(vocab, indexByNorm(mb, (x) => x.name), (x) => x.id, (x) => `${x.name} (${x.id})`);
    for (const [g, m] of Object.entries(r.matches)) out[g].musicbrainz = { id: m.item.id, name: m.item.name, match: m.match };
    review.push(...tagged("musicbrainz", r.review));
    sources.musicbrainz = mb.length;
  } catch (e) {
    unreachable.push(`musicbrainz: ${e.message}`);
  }

  try {
    const apple = await appleGenres();
    const r = matchSource(vocab, indexByNorm(apple, (x) => x.name), (x) => x.id, (x) => `${x.path.join(" > ")} (${x.id})`, (x) => x.depth);
    for (const [g, m] of Object.entries(r.matches)) out[g].apple_music = { id: m.item.id, name: m.item.name, match: m.match };
    review.push(...tagged("apple_music", r.review));
    sources.apple_music = apple.length;
  } catch (e) {
    unreachable.push(`apple_music: ${e.message}`);
  }

  try {
    const { idx, labelIdx, items, nonGenre } = await wikidata(vocab, notes);
    const desc = (x) => `${x.title} (${x.qid})`;
    const byLabel = matchSource(vocab, labelIdx, (x) => x.qid, desc);
    const rest = vocab.filter((g) => !byLabel.matches[g.name] && !byLabel.review.some((x) => x.genre === g.name));
    const byAlias = matchSource(rest, idx, (x) => x.qid, desc);
    const taken = new Set(Object.values(byLabel.matches).map((m) => m.item.qid));
    const r = { matches: { ...byLabel.matches }, review: [...byLabel.review] };
    for (const [g, m] of Object.entries(byAlias.matches)) {
      if (taken.has(m.item.qid)) r.review.push({ genre: g, candidate: desc(m.item), reason: "alias of an item already matched by label to another genre" });
      else r.matches[g] = m;
    }
    r.review.push(...byAlias.review);
    for (const [g, m] of Object.entries(r.matches)) out[g].wikipedia = { title: m.item.title, wikidata: m.item.qid, match: m.match };
    review.push(...tagged("wikipedia", r.review));
    const seen = new Set(r.review.map((x) => x.genre));
    for (const g of vocab) {
      if (out[g.name].wikipedia || seen.has(g.name)) continue;
      const k = normalise(g.name);
      for (const c of nonGenre.filter((x) => x.labelNorm === k && normalise(x.title) === k && !x.title.includes("(")).slice(0, 3)) {
        review.push({ source: "wikipedia", genre: g.name, candidate: `${c.title} (${c.qid})`, reason: `label matches but the Wikidata item is not a music genre (instance of ${c.p31.join(", ") || "nothing"})` });
      }
    }
    sources.wikipedia = items.length;
  } catch (e) {
    unreachable.push(`wikipedia/wikidata: ${e.message}`);
  }

  const manualFile = join(DATA, "genre_sources_manual.json");
  if (existsSync(manualFile)) {
    const manual = readJson("genre_sources_manual.json");
    for (const [g, per] of Object.entries(manual)) {
      if (g.startsWith("_") || !out[g]) continue;
      for (const [src, val] of Object.entries(per)) {
        out[g][src] = { ...val, match: "manual" };
        for (let i = review.length - 1; i >= 0; i--) if (review[i].genre === g && review[i].source === src) review.splice(i, 1);
      }
    }
  }

  const counts = { genres: vocab.length, discogs_true: 0, discogs_false: 0, musicbrainz: 0, wikipedia: 0, apple_music: 0 };
  const byMatch = {};
  for (const v of Object.values(out)) {
    if (v.discogs === true) counts.discogs_true++;
    if (v.discogs === false) counts.discogs_false++;
    for (const s of SOURCES) {
      if (!v[s]) continue;
      counts[s]++;
      byMatch[s] = byMatch[s] || {};
      byMatch[s][v[s].match] = (byMatch[s][v[s].match] || 0) + 1;
    }
  }
  const meta = {
    generated_at: new Date().toISOString(),
    counts,
    matches_by_kind: byMatch,
    catalogue_sizes: sources,
    unreachable,
    link_rules: {
      note: "URLs are never stored; server/app/genre_sources.py genre_source_links builds them (GET /genres/vocabulary source_links). Order: wikipedia, apple_music, spotify, discogs, rym, musicbrainz. Rate Your Music: only the curated URL in `genre_rym.json` ({genre: url}, empty for now, Alex supplies the URLs), kind page; none for a genre without an entry.",
      wikipedia: "page https://en.wikipedia.org/wiki/<title> when matched, else search https://en.wikipedia.org/w/index.php?search=<key> music genre",
      apple_music: "search https://music.apple.com/us/search?term=<matched Apple name or key> (Apple genre pages no longer resolve: they redirect to the search page)",
      spotify: "not stored (Spotify has no genre catalogue); always search https://open.spotify.com/search/genre%3A%22<key>%22",
      discogs: "search https://www.discogs.com/search/?style=<name>&type=release (genre= for a family) when the genre is in Discogs, else search https://www.discogs.com/search/?q=<key>&type=release",
      musicbrainz: "page https://musicbrainz.org/genre/<id> when matched, else none",
    },
    how: "A genre matches a catalogue entry when the normalised name is equal (match: name), else when a normalised listed synonym or display name is equal (match: synonym); entries from genre_sources_manual.json are match: manual. Normalisation: lowercase, accents folded, '&' read as 'and', hyphens, spaces and punctuation ignored, a trailing 'music' word dropped. Wikipedia: Wikidata items found by label search that are an instance or subclass of 'music genre' (Q188451) and have an English Wikipedia article. Several candidates, or a target claimed by two genres without exactly one name match, go to genre_sources_review.json and are not stored. Discogs is the genre_levels.json flag (true for the 11 families); discogs_name is Discogs's own spelling where it differs from the key.",
  };
  writeFileSync(join(DATA, "genre_sources.json"), JSON.stringify({ _meta: meta, ...out }, null, 1) + "\n");
  const rv = review.sort((a, b) => a.source.localeCompare(b.source) || a.genre.localeCompare(b.genre) || a.candidate.localeCompare(b.candidate));
  writeFileSync(join(DATA, "genre_sources_review.json"), JSON.stringify({ _meta: { generated_at: meta.generated_at, note: "Candidates that were not stored. To accept one, add it to server/data/genre_sources_manual.json and rebuild." }, review: rv }, null, 1) + "\n");
  console.log(JSON.stringify({ counts, byMatch, review: rv.length, unreachable, networkCalls: network, wikidataClasses: notes.wikidata_classes }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
