import { el } from './dom.js';
import { tagLabel } from './tagname.js';
import { splitAll, splitChips } from './chip-split.js';
import { store } from './store.js';
import { api } from './api.js';
import { suggestGenres, matchRange } from './genre-suggest.js';
import { countryCode, GENRE_CAP } from './metadata-apply.js';

const KINDS = {
  genre: { label: 'Genres', placeholder: 'Add a genre', make: (raw) => (raw.includes(',') ? '' : `genre:${raw.toLowerCase()}`), cap: GENRE_CAP },
  country: { label: 'Countries', placeholder: 'Add a country (name or ISO code)', make: (raw) => { const c = countryCode(raw); return c ? `country:${c}` : ''; }, cap: 1 },
};

let genreCache = null;
let genreLoading = null;
store.subscribe(() => { genreCache = null; });

function libraryGenres() {
  const counts = new Map();
  for (const s of store.songs) {
    for (const t of s.tags || []) {
      if (t.toLowerCase().startsWith('genre:')) {
        const g = t.slice(6).trim().toLowerCase();
        if (g) counts.set(g, (counts.get(g) || 0) + 1);
      }
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

function loadGenres() {
  if (genreCache) return Promise.resolve(genreCache);
  if (!genreLoading) {
    genreLoading = api.genres().catch(() => []).then((list) => {
      genreCache = list.length ? list : libraryGenres();
      genreLoading = null;
      return genreCache;
    });
  }
  return genreLoading;
}

export function chipField(ns, editor) {
  const kind = KINDS[ns];
  const prefix = `${ns}:`;
  const mine = () => editor.peek().filter((t) => t.toLowerCase().startsWith(prefix));
  const input = el('input', { type: 'text', placeholder: kind.placeholder, 'aria-label': kind.label, enterKeyHint: 'done', autocomplete: 'off' });
  const chips = el('div', { class: 'chips' });
  const list = el('div', { class: 'chips', role: 'listbox', id: `sg-${ns}-${Math.random().toString(36).slice(2, 8)}`, 'aria-label': `${kind.label} suggestions` });
  list.style.display = 'none';
  const node = el('div', { class: 'field' }, el('label', {}, kind.label), el('div', { class: 'chip-field' }, chips, input), list);
  let known = [];
  let shown = [];
  let active = -1;
  const suggesting = ns === 'genre';
  if (suggesting) {
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
  }

  function closeList() {
    shown = [];
    active = -1;
    list.style.display = 'none';
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function paintActive() {
    [...list.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', list.children[active].id);
    else input.removeAttribute('aria-activedescendant');
  }

  function accept(g) {
    const bad = addParts([g]);
    input.value = '';
    input.setAttribute('aria-invalid', String(bad));
    closeList();
  }

  function refreshList() {
    if (!suggesting) return;
    const q = input.value.trim();
    shown = suggestGenres(q, known, mine().map((t) => t.slice(prefix.length)));
    active = -1;
    if (!shown.length || mine().length >= kind.cap) { closeList(); return; }
    list.replaceChildren(...shown.map((g, i) => {
      const r = matchRange(g, q);
      const label = r ? [g.slice(0, r[0]), el('b', {}, g.slice(r[0], r[1])), g.slice(r[1])] : [g];
      return el('button', {
        type: 'button', class: 'chip', role: 'option', id: `${list.id}-${i}`, 'aria-selected': 'false', tabIndex: -1,
        onmousedown: (e) => e.preventDefault(),
        onclick: () => { accept(g); input.focus(); },
      }, ...label);
    }));
    list.style.display = '';
    input.setAttribute('aria-expanded', 'true');
  }

  function wantSuggestions() {
    if (!suggesting) return;
    if (genreCache) { known = genreCache; refreshList(); return; }
    known = libraryGenres();
    refreshList();
    loadGenres().then((g) => { known = g; if (document.activeElement === input) refreshList(); });
  }

  function addParts(parts) {
    let bad = false;
    for (const p of parts) {
      const tag = kind.make(p);
      if (!tag) { bad = true; continue; }
      if (ns === 'country') for (const t of mine()) editor.removeTag(t);
      else if (mine().length >= kind.cap) { bad = true; continue; }
      editor.addTags([tag]);
    }
    return bad;
  }

  function commit() {
    const parts = splitAll(input.value);
    if (!parts.length) { input.value = ''; input.removeAttribute('aria-invalid'); return; }
    const bad = addParts(parts);
    input.setAttribute('aria-invalid', String(bad));
    if (!bad) input.value = '';
  }

  function flushFinished() {
    const { parts, rest } = splitChips(input.value);
    if (!parts.length && rest === input.value) return;
    const bad = addParts(parts);
    input.value = rest;
    input.setAttribute('aria-invalid', String(bad));
  }

  input.addEventListener('keydown', (e) => {
    if (suggesting && shown.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = shown.length;
        active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
        paintActive();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) { e.preventDefault(); accept(shown[active]); return; }
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === '/') { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', () => { closeList(); commit(); });
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); flushFinished(); wantSuggestions(); });
  editor.subscribe(() => {
    chips.replaceChildren(...mine().map((t) => el('span', { class: 'chip tint', title: t }, tagLabel(t),
      el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${tagLabel(t)}`, onclick: () => editor.removeTag(t) }, '×'))));
    chips.hidden = !chips.children.length;
    if (suggesting && list.style.display !== 'none') refreshList();
  });
  return { node, commit };
}
