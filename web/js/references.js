import { api } from './api.js';
import { isGuest } from './guest.js';

export const ROLES = ['archetype', 'origin', 'landmark', 'breakthrough'];
export const ROLE_LABELS = { archetype: 'Archetype', origin: 'Origin', landmark: 'Landmark', breakthrough: 'Breakthrough' };
export const SOURCE_TYPES = {
  wikipedia: 'Wikipedia', musicbrainz: 'MusicBrainz', discogs: 'Discogs', rym: 'Rate Your Music', allmusic: 'AllMusic', chart: 'Chart', critic: 'Critic', compilation: 'Compilation', other: 'Other',
};
export const MAX_SOURCES = 8;

export const roleLabel = (role) => ROLE_LABELS[role] || role;
export const sourceTypeLabel = (type) => SOURCE_TYPES[type] || SOURCE_TYPES.other;

export function entrySources(entry) {
  if (Array.isArray(entry?.sources)) return entry.sources.filter((s) => s?.url);
  return entry?.source_url ? [{ type: 'other', url: entry.source_url }] : [];
}

export const sourceCount = (entry) => (Number.isInteger(entry?.source_count) ? entry.source_count : entrySources(entry).length);

export function sourcesTip(entry) {
  const types = entrySources(entry).map((s) => sourceTypeLabel(s.type));
  return types.join(', ');
}

export function isPlayableLink(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)(youtube\.com|youtu\.be|soundcloud\.com)$/.test(host);
  } catch {
    return false;
  }
}

export function addLinkFor(entry) {
  const list = entrySources(entry);
  const playable = list.find((s) => s.type !== 'chart' && isPlayableLink(s.url));
  return (playable || list[0])?.url || null;
}

export function eraYears(era) {
  const start = Number.isInteger(era?.start) ? era.start : null;
  const end = Number.isInteger(era?.end) ? era.end : null;
  if (start != null && end != null) return start === end ? `c. ${start}` : `c. ${start}-${end}`;
  if (start != null) return `since ${start}`;
  if (end != null) return `until ${end}`;
  return '';
}

export function sortEras(eras) {
  return [...(eras || [])].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || String(a.name).localeCompare(String(b.name)));
}

export function sortEntries(entries) {
  return [...(entries || [])].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || String(a.title).localeCompare(String(b.title)));
}

export function groupByEra(entries, eras, { owner = false } = {}) {
  const list = sortEras(eras);
  if (!list.length) return [{ era: null, entries: sortEntries(entries) }];
  const known = new Set(list.map((e) => e.id));
  const groups = list.map((era) => ({ era, entries: sortEntries((entries || []).filter((e) => e.era === era.id)) }));
  const rest = sortEntries((entries || []).filter((e) => !e.era || !known.has(e.era)));
  if (rest.length) groups.push({ era: null, entries: rest });
  return groups.filter((g) => !g.era || g.entries.length || owner);
}

export const entryLine = (e) => `${e.artist} - ${e.title}${e.year ? ` (${e.year})` : ''}`;

let all = null;
let owner = false;
let loading = null;
const byGenre = new Map();
const listeners = new Set();

const emit = () => { for (const fn of [...listeners]) fn(); };

export const onReferencesChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const cachedReferences = () => all;
export const isReferenceOwner = () => owner;
export const referencesAvailable = () => !isGuest();

export function resetReferences() {
  all = null;
  owner = false;
  loading = null;
  byGenre.clear();
}

export function loadReferences({ force = false } = {}) {
  if (isGuest()) return Promise.resolve(null);
  if (all && !force) return Promise.resolve(all);
  if (!loading || force) {
    const run = Promise.all([
      Promise.resolve().then(() => api.allReferences()).catch(() => null),
      owner ? Promise.resolve(null) : Promise.resolve().then(() => api.me()).then((m) => m?.owner === true).catch(() => false),
    ]).then(([data, isOwner]) => {
      if (isOwner != null) owner = isOwner;
      if (data) all = { references: data.references || {}, by_song: data.by_song || {} };
      emit();
      return all;
    }).finally(() => { if (loading === run) loading = null; });
    loading = run;
  }
  return loading;
}

export async function genreReferenceData(name, { force = false } = {}) {
  if (isGuest()) return { references: [], eras: [] };
  const key = String(name).toLowerCase();
  if (force || !byGenre.has(key)) {
    const p = api.genreReferences(name).then((d) => ({ references: Array.isArray(d?.references) ? d.references : [], eras: Array.isArray(d?.eras) ? d.eras : [] }));
    byGenre.set(key, p);
    p.catch(() => { if (byGenre.get(key) === p) byGenre.delete(key); });
  }
  return byGenre.get(key);
}

export const genreReferences = (name, opts) => genreReferenceData(name, opts).then((d) => d.references);
export const genreEras = (name, opts) => genreReferenceData(name, opts).then((d) => sortEras(d.eras));

export const songMarks = (songId) => all?.by_song?.[songId] || [];

export function referenceSongIds(role = '') {
  const out = new Set();
  for (const [id, marks] of Object.entries(all?.by_song || {})) {
    if (!role || marks.some((m) => m.role === role)) out.add(id);
  }
  return out;
}

export function marksTip(marks) {
  return marks.map((m) => `${m.genre} (${roleLabel(m.role)})`).join(', ');
}

async function afterWrite(name, result) {
  byGenre.delete(String(name).toLowerCase());
  await loadReferences({ force: true });
  return result;
}

export const addReference = (name, body) => api.addReference(name, body).then((r) => afterWrite(name, r));
export const patchReference = (name, id, body) => api.patchReference(name, id, body).then((r) => afterWrite(name, r));
export const saveEras = (name, eras) => api.putGenreEras(name, { eras }).then((r) => afterWrite(name, r));
export const deleteReference = (name, id) => api.deleteReference(name, id).then((r) => afterWrite(name, r));

export function cleanSources(rows) {
  const out = [];
  for (const r of rows || []) {
    const url = String(r?.url || '').trim();
    if (!url && !String(r?.note || '').trim()) continue;
    if (!/^https?:\/\/\S+$/i.test(url)) return { sources: [], error: 'Source links must start with http:// or https://.' };
    const note = String(r.note || '').trim();
    out.push({ type: SOURCE_TYPES[r.type] ? r.type : 'other', url, ...(note ? { note } : {}) });
  }
  if (out.length > MAX_SOURCES) return { sources: [], error: `At most ${MAX_SOURCES} sources.` };
  return { sources: out, error: '' };
}

export function cleanEras(rows) {
  const out = [];
  for (const r of rows || []) {
    const name = String(r?.name || '').trim();
    const startText = String(r?.start ?? '').trim();
    const endText = String(r?.end ?? '').trim();
    const note = String(r?.note || '').trim();
    const sourceRows = r?.sources || [];
    if (!name && !startText && !endText && !note && !sourceRows.some((x) => String(x?.url || '').trim())) continue;
    if (!name) return { eras: [], error: 'Every era needs a name.' };
    const year = (t) => (/^\d{4}$/.test(t) ? Number.parseInt(t, 10) : NaN);
    const start = startText ? year(startText) : null;
    const end = endText ? year(endText) : null;
    if (Number.isNaN(start) || Number.isNaN(end)) return { eras: [], error: `Years in "${name}" must be four digits.` };
    if (start != null && end != null && end < start) return { eras: [], error: `"${name}" ends before it starts.` };
    const cleaned = cleanSources(sourceRows);
    if (cleaned.error) return { eras: [], error: cleaned.error };
    out.push({
      ...(r.id ? { id: r.id } : {}), name, start, end, ...(note ? { note } : {}), sources: cleaned.sources,
    });
  }
  const names = out.map((e) => e.name.toLowerCase());
  if (new Set(names).size !== names.length) return { eras: [], error: 'Era names must be different.' };
  return { eras: out, error: '' };
}

export function buildBody({
  artist, title, year, role, note, sources, era,
}) {
  const body = { artist: String(artist || '').trim(), title: String(title || '').trim(), role };
  const y = Number.parseInt(year, 10);
  if (Number.isInteger(y) && y > 0) body.year = y;
  const n = String(note || '').trim();
  if (n) body.note = n;
  body.sources = sources || [];
  if (era) body.era = era;
  return body;
}

export function patchBodyFor(entry, {
  year, role, note, sources, era,
}) {
  const body = {};
  if (era !== undefined && (era || null) !== (entry.era || null)) body.era = era || null;
  if (role !== entry.role) body.role = role;
  const n = String(note || '').trim();
  if (n !== (entry.note || '')) body.note = n;
  const y = Number.parseInt(year, 10);
  const nextYear = Number.isInteger(y) && y > 0 ? y : null;
  if (nextYear !== (entry.year ?? null)) body.year = nextYear;
  if (JSON.stringify(sources) !== JSON.stringify(entrySources(entry).map((s) => ({ type: s.type, url: s.url, ...(s.note ? { note: s.note } : {}) })))) body.sources = sources;
  return body;
}

export function markBody({ role, note, era }) {
  const n = String(note || '').trim();
  return { role, ...(n ? { note: n } : {}), ...(era ? { era } : {}) };
}

if (typeof window !== 'undefined') window.addEventListener('auth-changed', () => { resetReferences(); emit(); });
