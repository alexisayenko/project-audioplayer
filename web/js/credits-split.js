import { splitTokens } from './tokens.js';

const FEAT_KEY = /\b(?:featuring|feat\.?|ft\.?)\s/i;
const FEAT_STOPS = [' - ', ' – ', ' — ', ' | ', ' ●● ', ' • ', ')', ']', '(', '['];
const CLOSERS = { '(': ')', '[': ']' };
const SPLIT = /\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+vs\.?\s+/i;
const KIND_WORDS = [
  ['remix', /\bremix(?:ed)?\b|\bmashup\b|\bbootleg\b|\brework\b|\bvip\b/i],
  ['live', /\blive\b|\bunplugged\b|\bin concert\b/i],
  ['acoustic', /\bacoustic\b/i],
  ['extended', /\bextended\b/i],
  ['instrumental', /\binstrumental\b/i],
  ['remaster', /\bremaster(?:ed)?\b/i],
  ['edit', /\bedit\b/i],
  ['cover', /\bcover\b/i],
];
const BY_STRIP = /\b(?:remix(?:ed)?|mix(?:ed)?|edit|mashup|bootleg|rework|vip|dub|version|radio|club|extended|original|instrumental|vocal|chill|by)\b/gi;
const MIXED_BY = /\bmixed\s+by\b/i;
const MASHUP_WORD = /^mash[\s-]?up$/i;
const MASHUP_TAIL = /\s*[(\[]\s*(mash[\s-]?up)\s*[)\]]\s*$/i;
const SOURCE_SPLIT = /\s+(?:x|×|vs\.?)\s+/i;
const DASH = /\s[-–—]\s/;
const REMIX_OR_MASHUP = /\bremix\b|\bmashup\b/i;
const REMIX_WORD = /\bremix\b|\bmashup\b|\bmixed\s+by\b/i;
const BRACKET = /[([]([^)\]]*)[)\]]/g;
const SEGMENT_SPLIT = /( \| | - | – | — )/;
const PUNCT = new Set([' ', '-', '|']);

function stripSet(text, set) {
  let a = 0;
  let b = text.length;
  while (a < b && set.has(text[a])) a += 1;
  while (b > a && set.has(text[b - 1])) b -= 1;
  return text.slice(a, b);
}

const squash = (text) => stripSet(String(text ?? '').replace(/\s+/g, ' '), PUNCT);

function names(text) {
  const out = [];
  const seen = new Set();
  for (const part of squash(text).split(SPLIT)) {
    const name = stripSet(part ?? '', PUNCT);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

function featEnd(text, start) {
  const ends = FEAT_STOPS.map((s) => text.indexOf(s, start)).filter((i) => i >= 0);
  return ends.length ? Math.min(...ends) : text.length;
}

function cutFeat(input) {
  let text = input;
  const found = [];
  for (;;) {
    const m = FEAT_KEY.exec(text);
    if (!m) return [squash(text), found];
    const i = m.index;
    const end = i + m[0].length;
    const opener = i ? text[i - 1] : '';
    if (CLOSERS[opener]) {
      const close = text.indexOf(CLOSERS[opener], end);
      const stop = close < 0 ? text.length : close;
      found.push(...names(text.slice(end, stop)));
      text = `${text.slice(0, i - 1)} ${text.slice(stop + 1)}`;
    } else {
      const stop = featEnd(text, end);
      found.push(...names(text.slice(end, stop)));
      text = `${text.slice(0, i)} ${text.slice(stop)}`;
    }
  }
}

function kindOf(text) {
  if (MASHUP_WORD.test(text.trim())) return 'mashup';
  if (MIXED_BY.test(text) && !REMIX_OR_MASHUP.test(text)) return 'other';
  for (const [kind, rx] of KIND_WORDS) if (rx.test(text)) return kind;
  return 'remix';
}

const RELEASE_TAG = /\s*[(\[]\s*([^()\[\]]*?\brelease)\s*[)\]]\s*$/i;
const RELEASE_SKIP = /\bremix(?:ed)?\b|\bmashup\b|\bmixed\s+by\b/i;

function releaseTag(title) {
  const m = RELEASE_TAG.exec(title);
  if (!m || RELEASE_SKIP.test(m[1])) return null;
  return { start: m.index, cover: /\bcover\b/i.test(m[1]) };
}

const COVER_TAIL = /^(.*?)[\s,:-]*\bcover(?:\s+version)?\s*$/i;
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function coverVersion(text, credited, notes) {
  const m = COVER_TAIL.exec(text);
  const name = m ? squash(m[1]) : '';
  if (!name) return null;
  const ver = { kind: 'cover', name: text, by: [] };
  if (!credited.length) notes.push('cover_ambiguous');
  else if (credited.some((c) => fold(c) === fold(name))) notes.push('cover_performer');
  else ver.of = [name];
  return ver;
}

function coverDash(left, right, text, name, credited, featured, ctx, notes) {
  const aNames = names(left);
  const xNames = names(name);
  const title = squash(right);
  const reading = (artists, of) => ({ artists, featured, version: { kind: 'cover', name: text, by: [], of }, title });
  const r1 = reading(aNames, xNames);
  const r2 = reading(xNames, aNames);
  const pool = (list) => new Set((list ?? []).map(fold));
  const hit = (list, set) => list.some((n) => set.has(fold(n)));
  const original = pool(ctx.original);
  let chosen = null;
  if (hit(xNames, original)) chosen = r1;
  else if (hit(aNames, original)) chosen = r2;
  else {
    for (const set of [pool(credited), pool(ctx.uploader ? [ctx.uploader] : [])]) {
      if (hit(aNames, set)) chosen = r1;
      else if (hit(xNames, set)) chosen = r2;
      if (chosen) break;
    }
  }
  notes.push('cover_dash');
  if (chosen) return [title, chosen.artists, chosen.version, null];
  notes.push('cover_ambiguous');
  return [title, r2.artists, r2.version, [r2, r1]];
}

const byNames = (text, kind) => (kind === 'remix' || kind === 'other' ? names(text.replace(BY_STRIP, ' ')) : []);

function version(text) {
  const kind = kindOf(text);
  return { kind, name: text, by: byNames(text, kind) };
}

function cutRemixSegment(title) {
  const parts = title.split(SEGMENT_SPLIT);
  if (parts.length < 5) return [title, null];
  for (let i = 2; i < parts.length; i += 2) {
    const seg = parts[i].trim();
    if (seg && REMIX_WORD.test(seg)) return [[...parts.slice(0, i - 1), ...parts.slice(i + 1)].join('').trim(), seg];
  }
  return [title, null];
}

function cutRemix(title) {
  for (const m of title.matchAll(BRACKET)) {
    const inner = m[1].trim();
    if (inner && REMIX_WORD.test(inner)) {
      const rest = `${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ');
      return [stripSet(rest, PUNCT), inner];
    }
  }
  return cutRemixSegment(title);
}

function titleVersion(title) {
  const [rest, remix] = cutRemix(title);
  if (remix) return [squash(rest), remix];
  for (const m of title.matchAll(BRACKET)) {
    const inner = m[1].trim();
    if (inner && KIND_WORDS.some(([, rx]) => rx.test(inner))) return [squash(`${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`), inner];
  }
  return [title, null];
}

function sources(text) {
  const parts = squash(text).split(SOURCE_SPLIT).map(squash);
  return parts.length >= 2 && parts.every(Boolean) ? parts : [];
}

const MASHUP_BY = /^(?:mash[\s-]?up\s+by\s+(?<a>.+)|(?<b>.+?)\s+mash[\s-]?up)$/is;
const MAKERS = /\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+/i;
const MASH_SOURCES = /\s+(?:x|×|vs\.?|&|\+)\s+|\s*,\s*/i;

function splitNames(text, pattern) {
  const out = [];
  for (const part of squash(text).split(pattern)) {
    const name = stripSet(part ?? '', PUNCT);
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

function mashupBy(base, artists, name, makers) {
  const ver = { kind: 'mashup', name, by: [] };
  const m = DASH.exec(base);
  const left = m ? base.slice(0, m.index) : '';
  const right = m ? base.slice(m.index + m[0].length) : '';
  let sources;
  let title;
  if (m && squash(left) && squash(right)) [sources, title] = [splitNames(left, MASH_SOURCES), squash(right)];
  else [sources, title] = [artists, squash(base)];
  if (sources.length) ver.of = sources;
  return [title, splitNames(makers, MAKERS), ver];
}

function mashup(base, artists, notes, name) {
  const ver = { kind: 'mashup', name, by: [] };
  const m = DASH.exec(base);
  const left = m ? base.slice(0, m.index) : base;
  const right = m ? base.slice(m.index + m[0].length) : '';
  if (m && squash(left) && squash(right)) {
    const found = sources(right);
    if (found.length) {
      ver.of = found;
      return [squash(right), names(left), ver];
    }
    notes.push('mashup_makers_unknown');
    return [squash(left), names(right), ver];
  }
  const found = sources(base);
  if (found.length) ver.of = found;
  notes.push('mashup_makers_unknown');
  return [squash(base), artists, ver];
}

const CUE_DASH = / [-–—] /;
const VERSION_MARK = /\b(?:remix(?:ed)?|mix|edit|mashup|bootleg|rework|vip|dub|version|live|acoustic|unplugged|instrumental|remaster(?:ed)?|cover|extended)\b/i;
const FEAT_PLAIN = /\b(?:featuring|feat\.?|ft\.?)\s/i;
const ANY_BRACKET = /[([][^)\]]*[)\]]/;

function markerBeforeDash(title) {
  const blanked = title.replace(new RegExp(ANY_BRACKET, 'g'), (m) => 'x'.repeat(m.length));
  const m = CUE_DASH.exec(blanked);
  if (!m) return false;
  return [...title.slice(0, m.index).matchAll(BRACKET)].some((b) => VERSION_MARK.test(b[1]));
}

function titleFirst(base, titleText, artists, ctx) {
  const m = DASH.exec(base);
  if (!m) return null;
  const left = squash(base.slice(0, m.index));
  const right = squash(base.slice(m.index + m[0].length));
  if (!left || !right || DASH.test(right) || ANY_BRACKET.test(right) || FEAT_PLAIN.test(right)) return null;
  const rightNames = names(right);
  const known = new Set([...artists, ...(ctx.original ?? []), ...(ctx.uploader ? [ctx.uploader] : [])].map(fold));
  const rightHit = rightNames.some((n) => known.has(fold(n)));
  const leftHit = [left, ...names(left)].some((n) => known.has(fold(n)));
  if (leftHit || !(rightHit || (!artists.length && markerBeforeDash(titleText)))) return null;
  const have = new Set(artists.map(fold));
  return [left, rightNames.every((n) => have.has(fold(n))) ? artists : rightNames];
}

function suggestInternal(artist, title, remixer, ctx = {}) {
  const notes = [];
  let alternatives = null;
  const [primary, feat] = cutFeat(squash(artist ?? ''));
  let featured = feat;
  if (featured.length) notes.push('feat_in_artist');
  let artists = [];
  const seen = new Set();
  const pills = splitTokens(primary);
  for (const pill of pills) {
    for (const name of names(pill)) {
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        artists.push(name);
      }
    }
  }
  if (artists.length > pills.length) notes.push('multi_artist');
  const titleText = String(title ?? '').trim();
  const [cut, titleFeat] = cutFeat(titleText);
  if (titleFeat.length) {
    notes.push('feat_in_title');
    const have = new Set(featured.map((f) => f.toLowerCase()));
    featured = [...featured, ...titleFeat.filter((n) => !have.has(n.toLowerCase()))];
  }
  let cutBase = cut;
  const release = releaseTag(cutBase);
  if (release) {
    cutBase = squash(cutBase.slice(0, release.start));
    notes.push('release_tag');
  }
  const tail = MASHUP_TAIL.exec(cutBase);
  let base;
  let fromTitle = null;
  if (tail) base = squash(cutBase.slice(0, tail.index));
  else [base, fromTitle] = titleVersion(cutBase);
  const remixerText = squash(remixer ?? '');
  let ver = null;
  const byText = [remixerText, squash(fromTitle ?? '')].find((t) => t && MASHUP_BY.test(t));
  if (byText && !tail) {
    const mb = MASHUP_BY.exec(byText);
    [base, artists, ver] = mashupBy(base, artists, byText, mb.groups.a ?? mb.groups.b);
    notes.push('mashup_by', byText === remixerText ? 'remixer_to_version' : 'version_in_title');
  } else if (tail || MASHUP_WORD.test(remixerText)) {
    [base, artists, ver] = mashup(base, artists, notes, tail ? tail[1] : remixerText);
    notes.push(tail ? 'version_in_title' : 'remixer_to_version');
  } else if (remixerText) {
    ver = version(remixerText);
    notes.push('remixer_to_version');
    if (fromTitle) notes.push('version_in_title');
  } else if (fromTitle) {
    ver = version(squash(fromTitle));
    notes.push('version_in_title');
    if (ver.kind === 'cover') {
      const dash = DASH.exec(base);
      const m = COVER_TAIL.exec(ver.name);
      const cname = m ? squash(m[1]) : '';
      if (dash && cname && squash(base.slice(0, dash.index)) && squash(base.slice(dash.index + dash[0].length))) {
        [base, artists, ver, alternatives] = coverDash(base.slice(0, dash.index), base.slice(dash.index + dash[0].length), ver.name, cname, [...artists, ...featured], featured, ctx ?? {}, notes);
      } else {
        ver = coverVersion(ver.name, [...artists, ...featured], notes) ?? ver;
      }
    }
  } else if (release && release.cover) {
    ver = { kind: 'cover', name: 'Cover', by: [] };
    notes.push('cover_release', 'version_in_title');
  }
  if (!tail && !alternatives && !(ver && (ver.kind === 'cover' || ver.kind === 'mashup'))) {
    const first = titleFirst(base, titleText, artists, ctx ?? {});
    if (first) {
      [base, artists] = first;
      notes.push('title_first');
    }
  }
  const out = { artists, featured, version: ver, title: base && base !== titleText ? base : null, notes };
  if (alternatives) out.alternatives = alternatives;
  return out;
}

function v2Version(v) {
  if (!v) return v;
  const { kind, by, of, ...rest } = v;
  const out = { ...rest, type: kind, artists: by ?? [] };
  if (of !== undefined) out.originalArtists = of;
  return out;
}

function v2Reading({ artists, featured, version: v, ...rest }) {
  return { ...rest, mainArtists: artists, featuredArtists: featured, version: v2Version(v) };
}

export function suggest(artist, title, remixer, ctx = {}) {
  const { alternatives, ...out } = v2Reading(suggestInternal(artist, title, remixer, ctx));
  return alternatives ? { ...out, alternatives: alternatives.map(v2Reading) } : out;
}
