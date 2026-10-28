import { store } from './store.js';
import { labelsOf } from './label-names.js';

let albumLists = [];

export function noteAlbums(albums) {
  albumLists = (Array.isArray(albums) ? albums : []).map((a) => labelsOf(a));
}

export function libraryLabels() {
  const counts = new Map();
  for (const names of [...store.songs.map((s) => labelsOf(s)), ...albumLists]) {
    for (const name of names) {
      const key = name.toLowerCase();
      const have = counts.get(key);
      if (have) have.n += 1;
      else counts.set(key, { name, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((e) => e.name);
}
