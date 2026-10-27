import { chipField } from './chip-field.js';

export const GENRE_MAX = 20;

function genreTags(list) {
  const out = [];
  for (const g of list || []) {
    const t = `genre:${String(g).trim()}`;
    if (t.length > 6 && out.length < GENRE_MAX && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

export function genreEditor(initial) {
  let tags = genreTags(initial);
  const subs = new Set();
  const notify = () => { for (const f of subs) f(); };
  const editor = {
    peek: () => tags,
    addTags(add) {
      tags = genreTags([...tags, ...add].map((t) => t.slice(6)));
      notify();
    },
    removeTag(t) { tags = tags.filter((x) => x !== t); notify(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    replace(names) { tags = genreTags(names); notify(); },
  };
  const field = chipField('genre', editor, { cap: GENRE_MAX });
  notify();
  return { node: field.node, get: () => tags.map((t) => t.slice(6)), commit: field.commit, add: (names) => editor.addTags((names || []).map((n) => `genre:${n}`)), set: editor.replace, subscribe: editor.subscribe };
}
