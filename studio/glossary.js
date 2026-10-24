import { el } from '../web/js/dom.js';
import { segmented } from '../web/js/segmented.js';
import { TERMS, termById, filterTerms } from '../web/js/glossary-terms.js';
import { matchSet } from '../web/js/glossary-map.js';
import { glossaryTermFromHash, glossaryViewFromHash, glossaryMapTermFromHash } from './routes.js';
import { createGlossaryMap } from './glossary-map-view.js';

export const TITLE = 'Glossary';
export const INTRO = 'Plain-language definitions of the sound terms used on this site, as a list or as a map of how they connect.';
export const VIEWS = [['list', 'List'], ['map', 'Map']];
export const termHash = (id) => `#/glossary/${id}`;
export const viewHash = (view, id = '') => (view === 'map' ? `#/glossary/map${id ? `/${id}` : ''}` : '#/glossary');
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
    map?.setMatches(matchSet(TERMS, input.value));
  }

  let view = 'list';
  let map = null;
  const mapHost = el('div', { class: 'gl-map', hidden: true });
  const seg = segmented(VIEWS, () => view, (v) => {
    showView(v);
    win.location.hash = viewHash(v);
  }, { 'aria-labelledby': 'gl-view-label' });
  const bar = el('div', { class: 'hm-axis' }, el('span', { id: 'gl-view-label', class: 'hm-lbl' }, 'View'), seg.group);

  function showView(v) {
    view = v;
    seg.paint();
    list.hidden = v !== 'list';
    mapHost.hidden = v !== 'map';
    if (v !== 'map') return;
    if (!map) {
      map = createGlossaryMap({ onSelect: (id) => win.history?.replaceState?.(null, '', viewHash('map', id ?? '')) });
      mapHost.append(map.node);
      map.setMatches(matchSet(TERMS, input.value));
    }
    map.show();
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
    const hash = win.location.hash;
    const v = glossaryViewFromHash(hash);
    showView(v);
    if (v === 'map') {
      const id = glossaryMapTermFromHash(hash);
      if (id) map.select(id, { silent: true, reveal: true });
      return;
    }
    const id = glossaryTermFromHash(hash);
    if (id) focusTerm(id);
  };

  pane.replaceChildren(el('section', { class: 'card gl-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    bar,
    el('div', { class: 'row' }, input, clear),
    status,
    list,
    mapHost));
  apply();
  win.addEventListener('hashchange', onHash);
  onHash();
  return () => {
    win.removeEventListener('hashchange', onHash);
    map?.destroy();
  };
}
