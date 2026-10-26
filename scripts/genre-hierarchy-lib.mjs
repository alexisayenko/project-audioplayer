import { normalise } from "./genre-sources-lib.mjs";
import { anyLink, infoboxFields, labelledLink, replaceLinks, scanLinks, targetLink } from "./wikitext-scan.mjs";

const GENERIC = new Set(["musicgenre", "music", "genre", "subgenre", "style", "form", "popularmusic", "musicalstyle", "musicalgenre", "list", "type"]);
const NAMESPACE = /^(?:file|image|category|wikt|wiktionary|help|wikipedia|template|talk|special|portal|draft):/i;

/** Remove comments, refs and (nested) templates from wikitext. */
export function stripWikitext(text) {
  let s = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<ref\b[^>]*\/>/gi, "").replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/<\/?(?:small|sup|sub|br|nowiki|span|div|big)\b[^>]*>/gi, " ");
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  } while (s !== prev);
  return s;
}

/** Article titles linked in a piece of wikitext, in order, without namespaces, anchors or generic names. */
export function linkTargets(text) {
  const out = [];
  for (const link of scanLinks(text, targetLink)) {
    const t = link.title.replaceAll("_", " ").trim();
    if (!t || NAMESPACE.test(t) || GENERIC.has(normalise(t))) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

const PHRASES = [
  { re: /\b(?:sub-?genre|sub-?style|sub-?category)\s+of\b/gi, kind: "subgenre" },
  { re: /\b(?:fusion|blend|combination|mix|mixture|hybrid)\s+of\b/gi, kind: "fusion" },
  { re: /\b(?:offshoot|off-shoot|derivative|spin-?off|outgrowth|development|evolution)\s+(?:of|from)\b/gi, kind: "offshoot" },
  { re: /\b(?:derived|derives|evolved|developed|emerged|originated|grew|stemmed|branched)\s+(?:directly\s+)?from\b/gi, kind: "offshoot" },
  { re: /\b(?:genre|style|form|type|kind|category|variety|branch|variant)\s+of\b/gi, kind: "genre_of" },
];
const STOP_WORDS = [
  /\b(?:that|which|who|whose|characterized|characterised|originating|originated|emerged|developed|popular)\b/i,
  /\b(?:typically|featuring|associated|primarily|mainly|mostly|often|where|while|in|during|around)\b/i,
  /\b(?:from|since|with|within|by|as|into|using|incorporating)\b/i,
];
const STOP_PUNCT = /[;:()]|\.\s|$/;

function stopIndex(text) {
  let first = text.search(STOP_PUNCT);
  for (const re of STOP_WORDS) {
    const at = text.search(re);
    if (at >= 0 && at < first) first = at;
  }
  return first;
}

/** The first paragraph of an article's wikitext as one cleaned sentence (links kept as [[...]]). */
export function leadSentence(wikitext) {
  const clean = stripWikitext(wikitext);
  const para = clean.split(/\n/).map((l) => l.trim()).find((l) => l && !/^(?:\[\[(?:file|image):|[=*#:|!{]|<)/i.test(l) && /[A-Za-z]{3}/.test(replaceLinks(l, anyLink, () => "x")));
  if (!para) return "";
  const squashed = para.replace(/'{2,}/g, "").replace(/\s+/g, " ");
  const text = replaceLinks(squashed, labelledLink, (link) => (GENERIC.has(normalise(link.title)) ? link.label || link.title : link.raw));
  const hidden = replaceLinks(text, anyLink, (link) => link.raw.replaceAll(".", "\u0001"));
  const end = hidden.search(/\.\s+(?=[A-Z"'[])/);
  const sentence = end < 0 ? hidden : hidden.slice(0, end + 1);
  return sentence.replaceAll("\u0001", ".");
}

/** Parents named by the lead sentence: [{label, phrase_kind}] (subgenre, genre_of, fusion, offshoot). */
export function parseLead(wikitext) {
  const sentence = leadSentence(wikitext);
  const out = [];
  const seen = new Set();
  for (const { re, kind } of PHRASES) {
    re.lastIndex = 0;
    for (const m of sentence.matchAll(re)) {
      const rest = sentence.slice(m.index + m[0].length);
      const hiddenRest = replaceLinks(rest, anyLink, (link) => "X".repeat(link.raw.length));
      const span = rest.slice(0, stopIndex(hiddenRest));
      for (const label of linkTargets(span)) {
        const k = `${label}|${kind}`;
        if (!seen.has(k) && !out.some((o) => o.label === label)) {
          seen.add(k);
          out.push({ label, phrase_kind: kind });
        }
      }
    }
  }
  return out;
}

function infoboxBlock(wikitext) {
  const start = wikitext.search(/\{\{\s*Infobox\s+music\s+genre/i);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext.startsWith("{{", i)) { depth++; i++; }
    else if (wikitext.startsWith("}}", i)) { depth--; i++; if (depth === 0) return wikitext.slice(start, i + 1); }
  }
  return wikitext.slice(start);
}

/** Infobox fields `stylistic_origins` and `derivatives` as linked article titles. */
export function parseInfobox(wikitext) {
  const block = infoboxBlock(wikitext);
  const fields = infoboxFields(block);
  const links = (v) => linkTargets((v || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<ref\b[^>]*\/>/gi, "").replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ""));
  return { origins: links(fields.stylistic_origins), derivatives: links(fields.derivatives) };
}

function grade(a, b) {
  if (a && b) return "STRONG";
  return a || b ? "MEDIUM" : "WEAK";
}

/**
 * Maps a label (an article title, a Wikidata label) or a Wikidata id back to a vocabulary key.
 * vocab: [{name, synonyms}], sources: genre_sources.json rows (wikipedia.title and wikidata give exact hits).
 * Order: exact Wikipedia title, then the normalised key or display, then a normalised synonym; several keys at the first tier that hits means null.
 */
export function buildResolver(vocab, sources) {
  const add = (m, k, key) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(key);
  };
  const byQ = new Map();
  const byTitle = new Map();
  const byName = new Map();
  const bySyn = new Map();
  for (const g of vocab) {
    add(byName, normalise(g.name), g.name);
    for (const s of g.synonyms) add(bySyn, normalise(s), g.name);
    const wp = sources[g.name]?.wikipedia;
    if (wp) {
      add(byTitle, normalise(wp.title), g.name);
      add(byQ, wp.wikidata, g.name);
    }
  }
  const one = (m, k) => { const s = m.get(k); return s?.size === 1 ? [...s][0] : undefined; };
  const hit = (m, k) => m.has(k);
  const byLabel = (label) => {
    for (const k of new Set([normalise(label), normalise(label.replace(/\((?:music|genre|music genre|musical genre)\)\s*$/i, ""))])) {
      for (const m of [byTitle, byName, bySyn]) if (hit(m, k)) return one(m, k) ?? null;
    }
    return null;
  };
  return {
    qid: (q) => one(byQ, q) ?? null,
    label: byLabel,
    resolve(label, q) {
      return (q && one(byQ, q)) || byLabel(label);
    },
  };
}

export function ancestorsOf(key, parentsOf) {
  const seen = new Set();
  const walk = (k) => { for (const p of parentsOf(k)) if (!seen.has(p)) { seen.add(p); walk(p); } };
  walk(key);
  return seen;
}

const keysOf = (list, key) => new Set((list || []).map((x) => x.key).filter((k) => k && k !== key));

function additionOf(p, wd, lead, orig) {
  const via = [wd.has(p) && "wikidata", lead.has(p) && "lead", orig.has(p) && "origins"].filter(Boolean);
  return { key: p, strength: grade(wd.has(p), lead.has(p)), via };
}

function unsupportedParents(parents, all, parentsOf) {
  const supported = new Set(all);
  for (const q of all) for (const a of ancestorsOf(q, parentsOf)) supported.add(a);
  return parents.filter((p) => !supported.has(p));
}

/**
 * Compares the evidence of one genre with its parents (vocabulary keys).
 * Returns {additions: [{key, strength, via}], removals: [{key, strength}], contradictions: [{key}], noEvidence}.
 * Strength for additions: STRONG (Wikidata and lead), MEDIUM (one of them), WEAK (infobox origins only).
 * Removals are our parents named by no evidence and not an ancestor of an evidence parent; strength = how many parent sources had data.
 */
export function diffGenre(key, ev, parents, parentsOf) {
  const wd = keysOf([...(ev.subclass_of || []), ...(ev.instance_of || [])], key);
  const lead = keysOf(ev.lead_parents, key);
  const orig = keysOf(ev.origins, key);
  const wdAny = (ev.subclass_of || []).length > 0;
  const leadAny = (ev.lead_parents || []).length > 0;
  const own = new Set(parents);
  const anc = ancestorsOf(key, parentsOf);
  const all = new Set([...wd, ...lead, ...orig]);
  const additions = [];
  const contradictions = [];
  for (const p of all) {
    if (own.has(p) || anc.has(p)) continue;
    if (ancestorsOf(p, parentsOf).has(key)) contradictions.push({ key: p });
    else additions.push(additionOf(p, wd, lead, orig));
  }
  const noEvidence = !wdAny && !leadAny && !orig.size;
  const strength = grade(wdAny, leadAny);
  const removals = noEvidence ? [] : unsupportedParents(parents, all, parentsOf).map((p) => ({ key: p, strength }));
  return { additions, removals, contradictions, noEvidence };
}
