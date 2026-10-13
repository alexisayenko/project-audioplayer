import { el } from './dom.js';
import { tagLabel } from './tagname.js';
import { splitAll, splitChips } from './chip-split.js';
import { countryCode, GENRE_CAP } from './metadata-apply.js';

const KINDS = {
  genre: { label: 'Genres', placeholder: 'Add a genre', make: (raw) => (raw.includes(',') ? '' : `genre:${raw.toLowerCase()}`), cap: GENRE_CAP },
  country: { label: 'Countries', placeholder: 'Add a country (name or ISO code)', make: (raw) => { const c = countryCode(raw); return c ? `country:${c}` : ''; }, cap: 1 },
};

export function chipField(ns, editor) {
  const kind = KINDS[ns];
  const prefix = `${ns}:`;
  const mine = () => editor.peek().filter((t) => t.toLowerCase().startsWith(prefix));
  const input = el('input', { type: 'text', placeholder: kind.placeholder, 'aria-label': kind.label, enterKeyHint: 'done', autocomplete: 'off' });
  const chips = el('div', { class: 'chips' });
  const node = el('div', { class: 'field' }, el('label', {}, kind.label), el('div', { class: 'chip-field' }, chips, input));

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
    if (e.key === 'Enter' || e.key === ',' || e.key === '/') { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); flushFinished(); });
  editor.subscribe(() => {
    chips.replaceChildren(...mine().map((t) => el('span', { class: 'chip tint', title: t }, tagLabel(t),
      el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${tagLabel(t)}`, onclick: () => editor.removeTag(t) }, '×'))));
    chips.hidden = !chips.children.length;
  });
  return { node, commit };
}
