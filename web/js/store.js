import { visibleTags } from './tagname.js';
import { api } from './api.js';

export const store = {
  songs: [],
  tags: [],
  loaded: false,
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
    for (const t of visibleTags(s.tags)) {
      const key = t.toLocaleLowerCase();
      const e = map.get(key) || { tag: t, count: 0 };
      e.count += 1;
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}
