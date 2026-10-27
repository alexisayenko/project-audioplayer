import { joinTokens } from './tokens.js';
import { suggest } from './credits-split.js';
import { normalizeVersion } from './version-norm.js';

export const OF_KINDS = new Set(['cover', 'mashup']);
export const ofLabel = (kind) => (kind === 'mashup' ? 'Mashup of' : 'Cover of');
export const lower = (s) => String(s ?? '').trim().toLowerCase();
export const COVER_SUFFIX = /(?<![\s,:-])[\s,:-]*\bcover(?:\s+version)?\s*$/i;
const MAKERS_ASK = 'Who made this mashup? Confirm or edit Artists; sources go in Mashup of.';
const COVER_ASK = 'Who performs this cover? Pick the reading that matches; the usual one is listed first.';
const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
const missing = (have, want) => want.filter((n) => !have.some((h) => lower(h) === lower(n)));

export function creditSuggestions({ f, current, syncYear, setTitle, uploader }) {
  const dismissed = new Set();
  let ask = '';
  let knownOriginal = [];
  const readingRow = (r, i, cur) => {
    const v = r.version;
    const of = v.originalArtists ?? [];
    return {
      key: `reading:${i}:${r.mainArtists.join('|')}:${of.join('|')}`,
      text: `Reading ${i + 1}: Artists ${r.mainArtists.join(' | ')}, ${ofLabel(v.type)} ${of.join(', ')}, Title ${r.title}`,
      apply: () => {
        f.artists.value = joinTokens(r.mainArtists);
        if (r.title && r.title !== cur.title.trim()) setTitle(r.title);
        f.kind.value = v.type;
        syncYear();
        if (!f.name.value.trim() && v.name) f.name.value = normalizeVersion(v.name);
        f.of.value = joinTokens(of);
      },
    };
  };
  const titlePart = (s, cur) => (s.title && s.title !== cur.title.trim() ? [{ key: `title:${s.title}`, text: `Title: ${s.title}`, apply: () => setTitle(s.title) }] : []);
  const artistsPart = (s, cur) => {
    if (!s.mainArtists.length || sameList(s.mainArtists, cur.mainArtists)) return [];
    return [{ key: `artists:${s.mainArtists.join('|')}`, text: `Artists: ${s.mainArtists.join(' | ')}`, apply: () => { f.artists.value = joinTokens(s.mainArtists); } }];
  };
  const featuredPart = (s, cur) => {
    const newFeat = missing(cur.featuredArtists, s.featuredArtists);
    if (!newFeat.length) return [];
    return [{ key: `featured:${newFeat.join('|')}`, text: `Featuring: ${newFeat.join(' | ')}`, apply: () => { f.featured.value = joinTokens([...cur.featuredArtists, ...newFeat]); } }];
  };
  const versionBits = (s, cur, newName, newBy) => {
    const v = s.version;
    const bits = [];
    if (!cur.type) bits.push(v.type);
    if (newName) bits.push(`"${newName}"`);
    if (newBy.length) bits.push(`by ${newBy.join(' | ')}`);
    if (OF_KINDS.has(v.type) && v.originalArtists?.length) bits.push(`${ofLabel(v.type)} ${v.originalArtists.join(', ')}`);
    else if (v.type === 'cover' && s.notes.includes('cover_performer')) bits.push(`Cover performed by ${v.name.replace(COVER_SUFFIX, '').trim()}`);
    return bits;
  };
  const applyVersion = (v, cur, newName, newBy) => {
    if (!cur.type) { f.kind.value = v.type; syncYear(); }
    if (newName) f.name.value = normalizeVersion(newName);
    if (newBy.length) f.by.value = joinTokens([...cur.artists, ...newBy]);
    if (OF_KINDS.has(v.type) && v.originalArtists?.length && !f.of.value.trim()) f.of.value = joinTokens(v.originalArtists);
  };
  const versionPart = (s, cur) => {
    const v = s.version;
    if (!v) return [];
    const newBy = missing(cur.artists, v.artists);
    const newName = !f.name.value.trim() && v.name ? normalizeVersion(v.name) : '';
    if (!newBy.length && !newName && cur.type) return [];
    return [{
      key: `version:${v.type}:${newName}:${newBy.join('|')}`,
      text: `Version: ${versionBits(s, cur, newName, newBy).join(', ')}`,
      apply: () => applyVersion(v, cur, newName, newBy),
    }];
  };
  const items = () => {
    const cur = current();
    const s = suggest(f.artists.value, cur.title, f.name.value, { uploader, original: knownOriginal });
    ask = s.notes.includes('mashup_makers_unknown') ? MAKERS_ASK : '';
    if (s.alternatives) {
      ask = COVER_ASK;
      return s.alternatives.map((r, i) => readingRow(r, i, cur)).filter((i) => !dismissed.has(i.key));
    }
    const parts = [...titlePart(s, cur), ...artistsPart(s, cur), ...featuredPart(s, cur), ...versionPart(s, cur)];
    if (!parts.length) return [];
    const row = { key: parts.map((p) => p.key).join('+'), text: parts.map((p) => p.text).join(' · '), apply: () => parts.forEach((p) => p.apply()) };
    return dismissed.has(row.key) ? [] : [row];
  };

  return {
    items,
    ask: () => ask,
    dismiss: (key) => dismissed.add(key),
    reset: () => dismissed.clear(),
    setOriginal: (list) => { knownOriginal = list; },
  };
}
