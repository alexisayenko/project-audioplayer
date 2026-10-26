import { el } from './dom.js';
import { icon } from './icons.js';
import { tagLabel } from './tagname.js';
import { splitAll, splitChips } from './chip-split.js';
import { store } from './store.js';
import { matchRange } from './genre-suggest.js';
import { buildIndex, resolveGenre, searchGenres, didYouMean, cachedIndex, loadVocabulary, isGroupText } from './genre-vocab.js';
import { familyIndex, dotClass } from './genre-data.js';
import { countryCode, GENRE_CAP } from './metadata-apply.js';
import { isKnownCountry } from './countries.js';

const KINDS = {
  genre: { label: 'Genres', placeholder: 'Pick a genre from the list', make: () => '', cap: GENRE_CAP },
  country: { label: 'Countries', placeholder: 'Add a country (name or ISO code)', make: (raw) => { const c = countryCode(raw); return c ? `country:${c}` : ''; }, cap: Infinity },
};

export function libraryGenres() {
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

const familyText = (e) => (Array.isArray(e.families) && e.families.length ? e.families : [e.family]).join(' and ');

const levelText = (e) => (e.level === 'family' || !e.family ? 'family' : familyText(e));

let listSeq = 0;

const fallbackIndex = () => buildIndex({ genres: libraryGenres().map((name) => ({ name, family: null, level: 'genre' })) });

export function chipField(ns, editor, { cap } = {}) {
  const kind = cap ? { ...KINDS[ns], cap } : KINDS[ns];
  const prefix = `${ns}:`;
  const mine = () => editor.peek().filter((t) => t.toLowerCase().startsWith(prefix));
  const input = el('input', { type: 'text', placeholder: kind.placeholder, 'aria-label': kind.label, enterKeyHint: 'done', autocomplete: 'off' });
  const chips = el('div', { class: 'chips' });
  const list = el('div', { class: 'chips', role: 'listbox', id: `sg-${ns}-${++listSeq}`, 'aria-label': `${kind.label} suggestions` });
  list.style.display = 'none';
  const hint = el('div', { class: 'genre-hint', role: 'status', hidden: true });
  const node = el('div', { class: 'field' }, el('label', {}, kind.label), el('div', { class: 'chip-field' }, chips, input), list, hint);
  let shown = [];
  let active = -1;
  const suggesting = ns === 'genre';
  let loadFailed = false;
  const vocab = () => cachedIndex() || (loadFailed ? fallbackIndex() : null);
  if (suggesting) {
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    loadVocabulary().then((idx) => { loadFailed = !idx; paintChips(); });
  }

  const dot = (e) => (e?.family ? el('span', { class: dotClass(familyIndex(e.family)), 'aria-hidden': 'true' }) : null);

  function closeList() {
    shown = [];
    active = -1;
    list.style.display = 'none';
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function clearHint() {
    hint.hidden = true;
    hint.replaceChildren();
  }

  function showHint(value, names, text) {
    const msg = text || (names.length ? `"${value}" is not in the genre list. Did you mean:` : `"${value}" is not in the genre list. Type to search it.`);
    hint.replaceChildren(el('span', { class: 't-caption' }, msg), ...names.map((n) => el('button', {
      type: 'button', class: 'chip', title: `Use ${n}`,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { accept(n); input.focus(); },
    }, dot(resolveGenre(n, vocab())), n)));
    hint.hidden = false;
  }

  function paintActive() {
    [...list.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', list.children[active].id);
    else input.removeAttribute('aria-activedescendant');
  }

  function accept(name) {
    const bad = addParts([name]);
    input.value = '';
    input.setAttribute('aria-invalid', String(bad));
    if (!bad) clearHint();
    closeList();
  }

  function refreshList() {
    if (!suggesting) return;
    const q = input.value.trim();
    const idx = vocab();
    const have = mine().map((t) => t.slice(prefix.length));
    shown = idx ? searchGenres(q, idx, have) : [];
    active = -1;
    if (!shown.length || mine().length >= kind.cap) { closeList(); return; }
    list.replaceChildren(...shown.map((e, i) => {
      const r = matchRange(e.name, q);
      const label = el('span', { class: 'sg-name' }, ...(r ? [e.name.slice(0, r[0]), el('b', {}, e.name.slice(r[0], r[1])), e.name.slice(r[1])] : [e.name]));
      return el('button', {
        type: 'button', class: 'chip', role: 'option', id: `${list.id}-${i}`, 'aria-selected': 'false', tabIndex: -1,
        title: e.family ? `${e.name}: genre in ${familyText(e)}` : e.name, 'data-genre': e.name,
        onmousedown: (ev) => ev.preventDefault(),
        onclick: () => { accept(e.name); input.focus(); },
      }, dot(e), label, e.level ? el('small', {}, levelText(e)) : null);
    }));
    list.style.display = '';
    input.setAttribute('aria-expanded', 'true');
  }

  function wantSuggestions() {
    if (!suggesting) return;
    refreshList();
    if (!cachedIndex() && !loadFailed) loadVocabulary().then((idx) => { loadFailed = !idx; if (document.activeElement === input) refreshList(); });
  }

  let rejected = null;

  function addGenre(p) {
    const idx = vocab();
    const hit = resolveGenre(p, idx);
    if (!hit) {
      const group = isGroupText(p, idx);
      rejected = rejected || { value: p, names: idx && !group ? didYouMean(p, idx, 5, mine().map((t) => t.slice(prefix.length))) : [], loading: !idx, group };
      return true;
    }
    if (mine().length >= kind.cap) return true;
    editor.addTags([`genre:${hit.name}`]);
    return false;
  }

  function addParts(parts) {
    let bad = false;
    rejected = null;
    for (const p of parts) {
      if (suggesting) { bad = addGenre(p) || bad; continue; }
      const tag = kind.make(p);
      if (!tag) { bad = true; continue; }
      if (mine().length >= kind.cap) { bad = true; continue; }
      editor.addTags([tag]);
    }
    if (rejected) showHint(rejected.value, rejected.names, rejected.loading ? 'The genre list is still loading. Try again in a moment.' : rejected.group ? `"${rejected.value}" only groups genres and is never assigned to a song. Pick a genre under it.` : '');
    return bad;
  }

  function commit() {
    const parts = splitAll(input.value);
    if (!parts.length) { input.value = ''; input.removeAttribute('aria-invalid'); return; }
    const bad = addParts(parts);
    input.setAttribute('aria-invalid', String(bad));
    if (!bad) { input.value = ''; clearHint(); }
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
      if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) { e.preventDefault(); accept(shown[active].name); return; }
      if (e.key === 'Enter' && !e.isComposing && shown.length === 1 && !resolveGenre(input.value, vocab())) { e.preventDefault(); accept(shown[0].name); input.focus(); return; }
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === '/') { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', () => { closeList(); commit(); });
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); clearHint(); flushFinished(); wantSuggestions(); });

  function paintChips() {
    const idx = vocab();
    chips.replaceChildren(...mine().map((t) => {
      const bad = ns === 'country' && !isKnownCountry(t.slice(prefix.length));
      const e = suggesting ? resolveGenre(t.slice(prefix.length), idx) : null;
      let title = t;
      if (bad) title = `${t}: not a known country, remove it`;
      else if (e?.family) title = `${tagLabel(t)}: genre in ${familyText(e)}`;
      return el('span', { class: 'chip tint', title, style: bad ? 'border:1px dashed currentColor' : null }, dot(e), bad ? [icon('warning', 'inline'), tagLabel(t)] : tagLabel(t),
        el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${tagLabel(t)}`, onclick: () => editor.removeTag(t) }, icon('clear', 'inline')));
    }));
    chips.hidden = !chips.children.length;
  }

  editor.subscribe(() => {
    paintChips();
    if (suggesting && list.style.display !== 'none') refreshList();
  });

  return {
    node,
    commit,
    reject({ value, suggestions = [] } = {}) {
      if (!suggesting) return;
      for (const t of mine()) if (t.slice(prefix.length).toLowerCase() === String(value).toLowerCase()) editor.removeTag(t);
      showHint(value, suggestions.filter((n) => resolveGenre(n, vocab())));
    },
  };
}
