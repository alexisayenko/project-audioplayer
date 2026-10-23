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

export async function genreReferences(name, { force = false } = {}) {
  if (isGuest()) return [];
  const key = String(name).toLowerCase();
  if (force || !byGenre.has(key)) {
    const p = api.genreReferences(name).then((d) => (Array.isArray(d?.references) ? d.references : []));
    byGenre.set(key, p);
    p.catch(() => { if (byGenre.get(key) === p) byGenre.delete(key); });
  }
  return byGenre.get(key);
}

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

export function buildBody({ artist, title, year, role, note, sources }) {
  const body = { artist: String(artist || '').trim(), title: String(title || '').trim(), role };
  const y = Number.parseInt(year, 10);
  if (Number.isInteger(y) && y > 0) body.year = y;
  const n = String(note || '').trim();
  if (n) body.note = n;
  body.sources = sources || [];
  return body;
}

export function patchBodyFor(entry, { year, role, note, sources }) {
  const body = {};
  if (role !== entry.role) body.role = role;
  const n = String(note || '').trim();
  if (n !== (entry.note || '')) body.note = n;
  const y = Number.parseInt(year, 10);
  const nextYear = Number.isInteger(y) && y > 0 ? y : null;
  if (nextYear !== (entry.year ?? null)) body.year = nextYear;
  if (JSON.stringify(sources) !== JSON.stringify(entrySources(entry).map((s) => ({ type: s.type, url: s.url, ...(s.note ? { note: s.note } : {}) })))) body.sources = sources;
  return body;
}

export function markBody({ role, note }) {
  const n = String(note || '').trim();
  return { role, ...(n ? { note: n } : {}) };
}

if (typeof window !== 'undefined') window.addEventListener('auth-changed', () => { resetReferences(); emit(); });
