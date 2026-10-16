import { el } from './dom.js';

export const TERMS_URL = 'data/theory-terms.json';
export const FAIL_TEXT = 'Could not load the terms. Reload to try again.';
export const EMPTY_TEXT = 'No terms yet.';

export function sortTerms(list) {
  return list
    .filter((t) => t && typeof t.id === 'string' && typeof t.term === 'string' && typeof t.description === 'string')
    .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
}

export async function loadTerms(fetchFn = globalThis.fetch) {
  const res = await fetchFn(TERMS_URL);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('bad data');
  return sortTerms(data);
}

export function renderTheory(root) {
  let dead = false;
  const body = el('div', { class: 'th-body' }, el('p', { class: 'muted t-body', role: 'status' }, 'Loading...'));
  root.append(
    el('header', { class: 'page-head' },
      el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
      el('h1', { class: 't-display' }, 'Music theory')),
    el('section', { class: 'th', 'aria-label': 'Terms' }, body),
  );
  const show = (node) => { if (!dead) body.replaceChildren(node); };
  loadTerms().then((terms) => {
    if (!terms.length) { show(el('p', { class: 'muted t-body', role: 'status' }, EMPTY_TEXT)); return; }
    show(el('dl', { class: 'th-list' }, terms.map((t) => el('div', { class: 'th-item card', id: `term-${t.id}` },
      el('dt', { class: 't-title' }, t.term),
      el('dd', { class: 'th-desc t-body' }, t.description)))));
  }).catch(() => show(el('p', { class: 'muted t-body', role: 'status' }, FAIL_TEXT)));
  return () => { dead = true; };
}
