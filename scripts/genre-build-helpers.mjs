import { matchSource, normalise } from "./genre-sources-lib.mjs";

export const runSequential = (items, fn) => items.reduce((chain, item, i) => chain.then(() => fn(item, i)), Promise.resolve());

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const claimIdsOf = (e, p) => (e?.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

export function entityNorms(e) {
  const out = new Set();
  const l = e.labels?.en?.value;
  if (l) out.add(normalise(l));
  for (const a of e.aliases?.en || []) out.add(normalise(a.value));
  return out;
}

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function describeEntity(id, e, p31) {
  const label = e.labels?.en?.value;
  return { qid: id, title: e.sitelinks?.enwiki?.title, norms: entityNorms(e), labelNorm: label ? normalise(label) : null, p31 };
}

export function classifyEntities(entities, genreClasses) {
  const classStats = {};
  const items = [];
  const nonGenre = [];
  for (const [id, e] of entities) {
    const p31 = claimIdsOf(e, "P31");
    for (const c of p31) classStats[c] = (classStats[c] || 0) + 1;
    if (!e.sitelinks?.enwiki?.title) continue;
    const isGenre = [...p31, ...claimIdsOf(e, "P279")].some((c) => genreClasses.has(c));
    (isGenre ? items : nonGenre).push(describeEntity(id, e, p31));
  }
  return { classStats, items, nonGenre };
}

export function buildIndexes(items) {
  const idx = new Map();
  const labelIdx = new Map();
  for (const it of items) {
    for (const k of it.norms) pushTo(idx, k, it);
    if (it.labelNorm) pushTo(labelIdx, it.labelNorm, it);
  }
  return { idx, labelIdx };
}

export function mergeWikiMatches(vocab, labelIdx, idx, desc) {
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
  return r;
}

const sameName = (x, k) => x.labelNorm === k && normalise(x.title) === k && !x.title.includes("(");

export function nonGenreReview(vocab, out, reviewed, nonGenre) {
  const seen = new Set(reviewed.map((x) => x.genre));
  const res = [];
  for (const g of vocab) {
    if (out[g.name].wikipedia || seen.has(g.name)) continue;
    const k = normalise(g.name);
    for (const c of nonGenre.filter((x) => sameName(x, k)).slice(0, 3)) {
      res.push({ source: "wikipedia", genre: g.name, candidate: `${c.title} (${c.qid})`, reason: `label matches but the Wikidata item is not a music genre (instance of ${c.p31.join(", ") || "nothing"})` });
    }
  }
  return res;
}

export function applyManual(out, review, manual) {
  for (const [g, per] of Object.entries(manual)) {
    if (g.startsWith("_") || !out[g]) continue;
    for (const [src, val] of Object.entries(per)) {
      out[g][src] = { ...val, match: "manual" };
      for (let i = review.length - 1; i >= 0; i--) if (review[i].genre === g && review[i].source === src) review.splice(i, 1);
    }
  }
}

function tally(byMatch, source, kind) {
  byMatch[source] = byMatch[source] || {};
  byMatch[source][kind] = (byMatch[source][kind] || 0) + 1;
}

export function summarise(out, genreCount, sourceNames) {
  const counts = { genres: genreCount, discogs_true: 0, discogs_false: 0, musicbrainz: 0, wikipedia: 0, apple_music: 0 };
  const byMatch = {};
  for (const v of Object.values(out)) {
    if (v.discogs === true) counts.discogs_true++;
    if (v.discogs === false) counts.discogs_false++;
    for (const s of sourceNames.filter((n) => v[n])) {
      counts[s]++;
      tally(byMatch, s, v[s].match);
    }
  }
  return { counts, byMatch };
}
