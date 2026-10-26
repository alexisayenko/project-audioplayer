import { createHash } from "node:crypto";

export function normalise(name) {
  let s = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replaceAll("&", " and ").replace(/[-_/,.]/g, " ").replace(/['’`]/g, "");
  s = s.replace(/\s+/g, " ").trim().replace(/ music$/, "");
  return s.replace(/[^a-z0-9]/g, "");
}

export function flattenApple(doc, rootId = "34") {
  const out = [];
  const walk = (node, depth, path) => {
    for (const sub of Object.values(node.subgenres || {})) {
      const p = [...path, sub.name];
      out.push({ id: String(sub.id), name: sub.name, depth, path: p });
      walk(sub, depth + 1, p);
    }
  };
  const root = doc[rootId];
  if (root) walk(root, 1, [root.name]);
  return out;
}

export function indexByNorm(items, nameOf) {
  const idx = new Map();
  for (const it of items) {
    const k = normalise(nameOf(it));
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(it);
  }
  return idx;
}

function uniqueBy(list, idOf) {
  const seen = new Map();
  for (const it of list) if (!seen.has(idOf(it))) seen.set(idOf(it), it);
  return [...seen.values()];
}

function best(items, rank) {
  if (!rank || items.length < 2) return items;
  const min = Math.min(...items.map(rank));
  return items.filter((it) => rank(it) === min);
}

export function candidatesFor(genre, idx, idOf, rank) {
  const byName = best(uniqueBy(idx.get(normalise(genre.name)) || [], idOf), rank);
  if (byName.length) return { tier: "name", items: byName };
  const found = [];
  for (const s of genre.synonyms) found.push(...(idx.get(normalise(s)) || []));
  return { tier: "synonym", items: best(uniqueBy(found, idOf), rank) };
}

function collectProposals(genres, idx, idOf, describe, rank) {
  const review = [];
  const proposals = [];
  for (const g of genres) {
    const { tier, items } = candidatesFor(g, idx, idOf, rank);
    if (items.length > 1) review.push(...items.map((it) => ({ genre: g.name, candidate: describe(it), reason: `several ${tier} candidates` })));
    else if (items.length) proposals.push({ genre: g.name, item: items[0], match: tier });
  }
  return { review, proposals };
}

function groupClaims(proposals, idOf) {
  const claims = new Map();
  for (const p of proposals) {
    const id = idOf(p.item);
    if (!claims.has(id)) claims.set(id, []);
    claims.get(id).push(p);
  }
  return claims;
}

function resolveClaim(list, describe, matches, review) {
  if (list.length === 1) {
    matches[list[0].genre] = { item: list[0].item, match: list[0].match };
    return;
  }
  const named = list.filter((p) => p.match === "name");
  const winner = named.length === 1 ? named[0] : null;
  if (winner) matches[winner.genre] = { item: winner.item, match: "name" };
  const reason = winner ? `already matched by name to "${winner.genre}"` : `claimed by ${list.length} genres: ${list.map((x) => x.genre).join(", ")}`;
  for (const p of list.filter((x) => x !== winner)) review.push({ genre: p.genre, candidate: describe(p.item), reason });
}

/**
 * genres: [{name, synonyms}]; idx: Map normalised name -> items; idOf(item) -> unique id.
 * One candidate on the name tier (else on the synonym tier) matches; several candidates, or a target that two
 * genres claim without exactly one of them owning it by name, go to `review` and are not matched.
 */
export function matchSource(genres, idx, idOf, describe = (it) => String(idOf(it)), rank = null) {
  const { review, proposals } = collectProposals(genres, idx, idOf, describe, rank);
  const matches = {};
  for (const list of groupClaims(proposals, idOf).values()) resolveClaim(list, describe, matches, review);
  return { matches, review };
}

export function cacheKey(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}
