import { el } from '../web/js/dom.js';
import { TERMS, termById, filterTerms } from '../web/js/glossary-terms.js';
import { glossaryTermFromHash } from './routes.js';

export const TITLE = 'Glossary';
export const INTRO = 'Plain-language definitions of the sound terms used on this site.';
export const termHash = (id) => `#/glossary/${id}`;
export const countText = (shown, total, filtered) => {
  if (!filtered) return `${total} terms`;
  return shown ? `${shown} of ${total} terms` : 'No terms match.';
};

export function mountGlossary(pane, win = globalThis) {
  let marked = null;
  const items = new Map();

  const termLink = (id) => el('a', { href: termHash(id), onclick: () => focusTerm(id) }, termById(id).term);

  const build = (t) => {
    const see = t.see?.length ? [el('span', { class: 'gl-label' }, 'See also'), ...t.see.map(termLink)] : [];
    const demo = t.demo ? [el('a', { href: `#/${t.demo.page}` }, `${t.demo.label} page →`)] : [];
    return el('div', { class: 'gl-item', id: `gl-${t.id}`, tabindex: '-1' },
      el('dt', { class: 't-subhead' }, t.term),
      el('dd', { class: 't-subhead muted gl-text' }, t.text),
      see.length || demo.length ? el('dd', { class: 'gl-more t-caption' }, ...see, ...demo) : null);
  };

  const status = el('p', { class: 'hm-cap muted t-caption', role: 'status' });
  const clear = el('button', { type: 'button', class: 'link-btn', hidden: true, 'aria-label': 'Clear filter', onclick: () => { input.value = ''; unmark(); apply(); input.focus(); } }, 'Clear');
  const input = el('input', { type: 'search', class: 'gl-q', 'aria-label': 'Filter terms', placeholder: 'Filter terms…', autocomplete: 'off', oninput: () => { unmark(); apply(); } });
  const list = el('dl', { class: 'gl-list' });
  for (const t of TERMS) {
    const node = build(t);
    items.set(t.id, node);
    list.append(node);
  }

  function unmark() {
    marked?.classList.remove('gl-hit');
    marked = null;
  }

  function apply() {
    const hits = new Set(filterTerms(TERMS, input.value).map((t) => t.id));
    for (const [id, node] of items) node.hidden = !hits.has(id);
    clear.hidden = !input.value;
    status.textContent = countText(hits.size, TERMS.length, !!input.value.trim());
  }

  function focusTerm(id) {
    const node = items.get(id);
    if (!node) return;
    if (node.hidden) {
      input.value = '';
      apply();
    }
    unmark();
    marked = node;
    node.classList.add('gl-hit');
    node.scrollIntoView({ block: 'start' });
    node.focus({ preventScroll: true });
  }

  const onHash = () => {
    const id = glossaryTermFromHash(win.location.hash);
    if (id) focusTerm(id);
  };

  pane.replaceChildren(el('section', { class: 'card gl-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    el('div', { class: 'row' }, input, clear),
    status,
    list));
  apply();
  win.addEventListener('hashchange', onHash);
  onHash();
  return () => win.removeEventListener('hashchange', onHash);
}
