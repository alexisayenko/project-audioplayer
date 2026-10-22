import { api } from './api.js';

export const TTL_MS = 180000;
export const WINDOWS = [['today', 'Today'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['all', 'All time']];

let cache = null;
let pending = null;
let refreshing = null;
let stamp = 0;
let version = 0;

export function formatTotal(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '0 min';
  if (s < 60) return 'under 1 min';
  const mins = Math.floor(s / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${mins} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!m) return day || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function hasListening(entry) {
  if (!entry) return false;
  const sum = (o) => WINDOWS.reduce((n, [k]) => n + (Number(o?.[k]) || 0), 0);
  return sum(entry.listened) + sum(entry.skipped) > 0 || Number(entry.total_listened_s) > 0;
}

export function listeningRows(entry) {
  const cell = (o, k) => String(Number(o?.[k]) || 0);
  return [
    { label: 'Listened', cells: WINDOWS.map(([k]) => cell(entry.listened, k)) },
    { label: 'Skipped', cells: WINDOWS.map(([k]) => cell(entry.skipped, k)) },
  ];
}

export function cachedListening() {
  return cache;
}

export function listeningStale(now = Date.now()) {
  return !cache || now - stamp >= TTL_MS;
}

export function invalidateListening() {
  stamp = -Infinity;
  version += 1;
}

export function getListening({ load = () => api.listening(), now = () => Date.now() } = {}) {
  if (cache && now() - stamp < TTL_MS) return Promise.resolve(cache);
  if (pending) return pending;
  const mine = version;
  pending = load().then((d) => {
    const songs = d?.songs && typeof d.songs === 'object' ? d.songs : {};
    cache = songs;
    if (mine === version) stamp = now();
    return cache;
  }).finally(() => { pending = null; });
  return pending;
}

export function refreshListening(options = {}) {
  invalidateListening();
  if (refreshing) return refreshing;
  const now = options.now || (() => Date.now());
  refreshing = (async () => {
    for (;;) {
      const requestedVersion = version;
      if (pending) {
        await pending.catch(() => {});
        continue;
      }
      if (requestedVersion !== version) continue;
      const songs = await getListening(options);
      if (requestedVersion === version && !listeningStale(now())) return songs;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function resetListeningForTests() {
  cache = null;
  pending = null;
  refreshing = null;
  stamp = -Infinity;
  version = 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('plays-flushed', invalidateListening);
  window.addEventListener('auth-changed', () => { cache = null; invalidateListening(); });
}
