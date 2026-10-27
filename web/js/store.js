import { filterableTags, canonicalTag, withRuntimeDecade } from './tagname.js';
import { api } from './api.js';

export const store = {
  songs: [],
  tags: [],
  loaded: false,
  sync: null,
  build: null,
  listeners: new Set(),

  loadedAt: 0,
  pending: null,
  sig: null,

  refresh({ maxAgeMs = 0 } = {}) {
    if (this.pending) return this.pending;
    if (maxAgeMs > 0 && this.loaded && Date.now() - this.loadedAt < maxAgeMs) return Promise.resolve();
    const run = (async () => {
      const songs = await api.library();
      const sig = JSON.stringify(songs);
      if (maxAgeMs > 0 && this.loaded && sig === this.sig) {
        this.loadedAt = Date.now();
        return;
      }
      this.songs = songs;
      this.sig = sig;
      this.tags = tagCounts(this.songs);
      this.loaded = true;
      this.loadedAt = Date.now();
      this.listeners.forEach((fn) => fn());
    })();
    this.pending = run;
    const clear = () => { if (this.pending === run) this.pending = null; };
    run.then(clear, clear);
    return run;
  },

  insert(song) {
    this.songs = [...this.songs.filter((s) => s.id !== song.id), song];
    this.sig = null;
    this.tags = tagCounts(this.songs);
    this.loaded = true;
    this.loadedAt = Date.now();
    this.listeners.forEach((fn) => fn());
  },

  get(id) {
    return this.songs.find((s) => s.id === id);
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

export function tagCounts(songs) {
  const map = new Map();
  for (const s of songs) {
    const seen = new Set();
    for (const raw of filterableTags(withRuntimeDecade(s).tags)) {
      const t = canonicalTag(raw);
      const key = t.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key) || { tag: t, count: 0 };
      e.count += 1;
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}
