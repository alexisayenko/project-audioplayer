import { visibleTags, canonicalTag } from './tagname.js';
import { api } from './api.js';

export const store = {
  songs: [],
  tags: [],
  loaded: false,
  sync: null,
  listeners: new Set(),

  async refresh() {
    this.songs = await api.library();
    this.tags = tagCounts(this.songs);
    this.loaded = true;
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
    for (const raw of visibleTags(s.tags)) {
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
