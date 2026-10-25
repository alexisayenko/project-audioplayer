import { el } from '../web/js/dom.js';
import { segmented } from '../web/js/segmented.js';
import { TERMS, termById, termByAnchor, filterTerms } from '../web/js/glossary-terms.js';
import { matchSet, termsByDomain } from '../web/js/glossary-map.js';
import { glossaryTermFromHash, glossaryViewFromHash, glossaryMapTermFromHash } from './routes.js';
import { createGlossaryMap, dotFor } from './glossary-map-view.js';
import { demoLink, pageLink } from './glossary-demo.js';

export const TITLE = 'Glossary';
export const INTRO = 'Plain-language definitions of the sound terms used on this site, as a list or as a map of how they connect.';
export const VIEWS = [['list', 'List'], ['map', 'Map']];
export const ORDERS = [['category', 'By category'], ['az', 'A-Z']];
export const termHash = (id) => `#/glossary/${id}`;
export const viewHash = (view, id = '') => (view === 'map' ? `#/glossary/map${id ? `/${id}` : ''}` : '#/glossary');
export const countText = (shown, total, filtered) => {
  if (!filtered) return `${total} terms`;
  return shown ? `${shown} of ${total} terms` : 'No terms match.';
};
export const sectionCount = (shown, total, filtered) => (filtered ? ` (${shown} of ${total})` : ` (${total})`);

export function mountGlossary(pane, win = globalThis) {
  let marked = null;
  let order = 'category';
  const items = new Map();

  const termLink = (id) => el('a', { href: termHash(id), onclick: () => focusTerm(id) }, termById(id).term);

  const build = (t) => {
    const see = t.see?.length ? [el('span', { class: 'gl-label' }, 'See also'), ...t.see.map(termLink)] : [];
    const demo = pageLink(t);
    const openDemo = demoLink(t);
    return el('div', { class: 'gl-item', id: `gl-${t.id}`, tabindex: '-1' },
      el('dt', { class: 't-subhead' }, t.term, t.aliases?.length ? el('span', { class: 'gl-also t-caption' }, ` also: ${t.aliases.join(', ')}`) : null),
      el('dd', { class: 't-subhead muted gl-text' }, t.text),
      openDemo.length ? el('dd', { class: 'gl-demo-row' }, ...openDemo) : null,
      see.length || demo.length ? el('dd', { class: 'gl-more t-caption' }, ...see, ...demo) : null);
  };

  const status = el('p', { class: 'hm-cap muted t-caption', role: 'status' });
  const clear = el('button', { type: 'button', class: 'link-btn', hidden: true, 'aria-label': 'Clear filter', onclick: () => { input.value = ''; unmark(); apply(); input.focus(); } }, 'Clear');
  const input = el('input', { type: 'search', class: 'gl-q', 'aria-label': 'Filter terms', placeholder: 'Filter terms…', autocomplete: 'off', oninput: () => { unmark(); apply(); } });
  for (const t of TERMS) items.set(t.id, build(t));

  const azList = el('dl', { class: 'gl-list' });
  const sections = termsByDomain().map((g) => {
    const count = el('span', { class: 'gl-count' });
    const head = el('h3', { class: 't-subhead gl-sec-h', id: `gl-cat-${g.id}`, tabindex: '-1' }, dotFor(g.id), el('span', {}, g.label), count);
    const dl = el('dl', { class: 'gl-list' });
    const sec = el('section', { class: 'gl-sec', 'aria-labelledby': head.id }, head, dl);
    const chip = el('button', { type: 'button', class: 'btn outline small gl-chip', onclick: () => jumpTo(sec, head) }, dotFor(g.id), g.label);
    return { group: g, count, dl, sec, chip };
  });
  const listHost = el('div', { class: 'gl-lists' });
  const jump = el('div', { class: 'gl-jump', role: 'group', 'aria-label': 'Jump to a category' }, ...sections.map((s) => s.chip));
  let orderSeg = null;

  function jumpTo(sec, head) {
    sec.scrollIntoView({ block: 'start' });
    head.focus({ preventScroll: true });
  }

  function layoutList() {
    if (order === 'az') {
      azList.replaceChildren(...TERMS.map((t) => items.get(t.id)));
      listHost.replaceChildren(azList);
    } else {
      for (const s of sections) s.dl.replaceChildren(...s.group.terms.map((t) => items.get(t.id)));
      listHost.replaceChildren(...sections.map((s) => s.sec));
    }
    jump.hidden = order !== 'category' || view !== 'list';
  }

  function unmark() {
    marked?.classList.remove('gl-hit');
    marked = null;
  }

  function apply() {
    const hits = new Set(filterTerms(TERMS, input.value).map((t) => t.id));
    const filtered = !!input.value.trim();
    for (const [id, node] of items) {
      node.hidden = !hits.has(id);
    }
    for (const s of sections) {
      const shown = s.group.terms.filter((t) => hits.has(t.id)).length;
      s.sec.hidden = shown === 0;
      s.chip.hidden = shown === 0;
      s.count.textContent = sectionCount(shown, s.group.terms.length, filtered);
    }
    clear.hidden = !input.value;
    status.textContent = countText(hits.size, TERMS.length, filtered);
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
  orderSeg = segmented(ORDERS, () => order, (v) => {
    order = v;
    orderSeg.paint();
    layoutList();
  }, { 'aria-labelledby': 'gl-order-label' });
  const orderBar = el('div', { class: 'hm-axis' }, el('span', { id: 'gl-order-label', class: 'hm-lbl' }, 'Order'), orderSeg.group);

  function showView(v) {
    view = v;
    seg.paint();
    listHost.hidden = v !== 'list';
    orderBar.hidden = v !== 'list';
    jump.hidden = order !== 'category' || v !== 'list';
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
      const hit = termByAnchor(glossaryMapTermFromHash(hash));
      if (hit) map.select(hit.id, { silent: true, reveal: true });
      return;
    }
    const hit = termByAnchor(glossaryTermFromHash(hash));
    if (hit) focusTerm(hit.id);
  };

  pane.replaceChildren(el('section', { class: 'card gl-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    bar,
    el('div', { class: 'gl-tools' }, el('div', { class: 'row' }, input, clear), orderBar),
    status,
    jump,
    listHost,
    mapHost));
  layoutList();
  orderSeg.paint();
  apply();
  win.addEventListener('hashchange', onHash);
  onHash();
  return () => {
    win.removeEventListener('hashchange', onHash);
    map?.destroy();
  };
}
