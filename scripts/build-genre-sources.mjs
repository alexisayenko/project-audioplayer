#!/usr/bin/env node
// One-off builder of server/data/genre_sources.json and genre_sources_review.json.
// Usage (WSL): node scripts/build-genre-sources.mjs [--cache DIR] [--refresh]
// Raw downloads are cached in DIR (default: $GENRE_SOURCES_CACHE or the OS temp dir), never in the repo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheKey, flattenApple, indexByNorm, matchSource, normalise } from "./genre-sources-lib.mjs";
import { applyManual, buildIndexes, chunk, classifyEntities, entityNorms, mergeWikiMatches, nonGenreReview, runSequential, summarise } from "./genre-build-helpers.mjs";

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

async function fetchOnce(url, file, attempt) {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    network++;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    writeFileSync(file, JSON.stringify(body));
    return { body };
  } catch (e) {
    await sleep(3000 * (attempt + 1));
    return { error: e };
  }
}

async function fetchWithRetry(url, file, attempt = 0) {
  const { body, error } = await fetchOnce(url, file, attempt);
  if (!error) return body;
  if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
  return fetchWithRetry(url, file, attempt + 1);
}

async function getJson(url) {
  const file = join(CACHE, cacheKey(url) + ".json");
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return fetchWithRetry(url, file);
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
    await runSequential(chunk(need, 50), async (part) => {
      const body = await getJson(`${api}?action=wbgetentities&ids=${part.join("|")}&props=labels|aliases|claims|sitelinks&languages=en&sitefilter=enwiki&format=json`);
      for (const [id, e] of Object.entries(body.entities || {})) entities.set(id, e);
    });
  };
  await runSequential(vocab, (g) => search(g.name));
  await loadEntities();
  const hasName = (g) => [...entities.values()].some((e) => entityNorms(e).has(normalise(g.name)));
  await runSequential(vocab.filter((g) => !hasName(g)).flatMap((g) => g.synonyms.slice(0, 4)), search);
  await loadEntities();
  const { classStats, items, nonGenre } = classifyEntities(entities, MUSIC_GENRE_CLASSES);
  notes.wikidata_classes = classStats;
  return { ...buildIndexes(items), items, nonGenre };
}

const tagged = (source, list) => list.map((r) => ({ source, ...r }));

function recordCatalogue(st, key, items, describe, rank) {
  const r = matchSource(st.vocab, indexByNorm(items, (x) => x.name), (x) => x.id, describe, rank);
  for (const [g, m] of Object.entries(r.matches)) st.out[g][key] = { id: m.item.id, name: m.item.name, match: m.match };
  st.review.push(...tagged(key, r.review));
  st.sources[key] = items.length;
}

async function recordMusicbrainz(st) {
  const mb = await musicbrainz();
  recordCatalogue(st, "musicbrainz", mb, (x) => `${x.name} (${x.id})`);
}

async function recordApple(st) {
  const apple = await appleGenres();
  recordCatalogue(st, "apple_music", apple, (x) => `${x.path.join(" > ")} (${x.id})`, (x) => x.depth);
}

async function recordWikipedia(st) {
  const { idx, labelIdx, items, nonGenre } = await wikidata(st.vocab, st.notes);
  const desc = (x) => `${x.title} (${x.qid})`;
  const r = mergeWikiMatches(st.vocab, labelIdx, idx, desc);
  for (const [g, m] of Object.entries(r.matches)) st.out[g].wikipedia = { title: m.item.title, wikidata: m.item.qid, match: m.match };
  st.review.push(...tagged("wikipedia", r.review), ...nonGenreReview(st.vocab, st.out, r.review, nonGenre));
  st.sources.wikipedia = items.length;
}

async function guarded(label, unreachable, fn) {
  try {
    await fn();
  } catch (e) {
    unreachable.push(`${label}: ${e.message}`);
  }
}

function initialOut(vocab) {
  const out = {};
  for (const g of vocab) {
    out[g.name] = { discogs: g.discogs };
    if (g.discogsName.toLowerCase() !== g.name) out[g.name].discogs_name = g.discogsName;
  }
  return out;
}

async function main() {
  const vocab = loadVocabulary();
  const st = { vocab, sources: {}, review: [], notes: {}, out: initialOut(vocab) };
  const unreachable = [];
  const { sources, review, notes, out } = st;

  await guarded("musicbrainz", unreachable, () => recordMusicbrainz(st));
  await guarded("apple_music", unreachable, () => recordApple(st));
  await guarded("wikipedia/wikidata", unreachable, () => recordWikipedia(st));

  if (existsSync(join(DATA, "genre_sources_manual.json"))) applyManual(out, review, readJson("genre_sources_manual.json"));

  const { counts, byMatch } = summarise(out, vocab.length, SOURCES);
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
  const rv = review.toSorted((a, b) => a.source.localeCompare(b.source) || a.genre.localeCompare(b.genre) || a.candidate.localeCompare(b.candidate));
  writeFileSync(join(DATA, "genre_sources_review.json"), JSON.stringify({ _meta: { generated_at: meta.generated_at, note: "Candidates that were not stored. To accept one, add it to server/data/genre_sources_manual.json and rebuild." }, review: rv }, null, 1) + "\n");
  console.log(JSON.stringify({ counts, byMatch, review: rv.length, unreachable, networkCalls: network, wikidataClasses: notes.wikidata_classes }, null, 1));
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
