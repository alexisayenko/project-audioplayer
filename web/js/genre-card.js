import { el } from './dom.js';
import { icon } from './icons.js';
import { cachedTree, loadGenreTree } from './genre-tree.js';
import { resolveNode, libraryTags, genreDescription } from './genre-levels.js';
import { familyIndex, dotClass, OTHER_COLOR } from './genre-data.js';
import { shownSourceLinks } from './genre-source-links.js';
import { createReferencesPanel } from './genre-references.js';
import { filterByTags, prefs, saveLibraryView } from './library-data.js';
import { showGenreOnMap } from './genre-focus.js';

export const NOT_FOUND = 'Genre not found';
export const NO_DESCRIPTION = 'No description yet.';
export const LOAD_FAILED = 'Could not load the genres.';

export function cardSections(n, tree) {
  const byIds = (ids) => ids.map((id) => tree.byId.get(id)).filter(Boolean);
  const related = [];
  for (const name of n.related || []) {
    const r = resolveNode(name, tree);
    if (r && r.id !== n.id && !related.some((x) => x.id === r.id)) related.push(r);
  }
  const parents = byIds(n.parents);
  return {
    parents: parents.filter((p) => !p.group),
    groups: parents.filter((p) => p.group),
    children: [...n.children].filter((c) => !c.group),
    related,
  };
}

export function levelText(n) {
  if (n.group) return n.temporary ? 'Temporary group' : 'Group';
  return `Level ${n.level}`;
}

function chipGroup(label, nodes, go) {
  if (!nodes.length) return null;
  return el('div', { class: 'gc-chips', role: 'group', 'aria-label': label },
    el('span', { class: 'gc-chips-label t-caption muted' }, label),
    ...nodes.map((x) => el('button', { class: 'gc-chip t-caption', type: 'button', 'data-genre': x.name, onclick: () => go(x.name) }, x.label)));
}

function viewInLibrary(n, tree) {
  filterByTags(libraryTags(tree, n.id));
  prefs.never = false;
  prefs.view = 'songs';
  saveLibraryView('songs');
  if (/^#?\/?(library)?$/.test(location.hash)) window.dispatchEvent(new Event('hashchange'));
  else location.hash = '#/library';
}

export function openGenreCard(name, opener = null) {
  const dlg = el('dialog', { class: 'sheet card-dlg genre-card', 'aria-labelledby': 'genre-card-title', tabindex: '-1' });
  const stack = [];
  const refs = createReferencesPanel();
  let current = name;
  let tree = cachedTree();
  let failed = false;
  let live = true;

  const close = () => dlg.close();

  function go(next) {
    stack.push(current);
    current = next;
    paint();
    dlg.querySelector('#genre-card-title')?.focus();
  }

  function back() {
    if (!stack.length) return;
    current = stack.pop();
    paint();
    dlg.querySelector('#genre-card-title')?.focus();
  }

  function topBar() {
    const backBtn = el('button', { type: 'button', class: 'card-back icon round', title: 'Back', 'aria-label': 'Back', hidden: !stack.length, onclick: back }, icon('chevronLeft', 'nav'));
    const closeBtn = el('button', { type: 'button', class: 'card-close', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('clear', 'nav'));
    return el('div', { class: 'gc-bar' }, backBtn, el('span', { class: 'grab', 'aria-hidden': 'true' }), closeBtn);
  }

  function message(text) {
    refs.show(null);
    dlg.replaceChildren(topBar(), el('h2', { id: 'genre-card-title', class: 't-title', tabindex: '-1' }, text));
  }

  function header(n) {
    const slot = n.family ? familyIndex(n.family) : OTHER_COLOR;
    const meta = [el('span', { class: 'gc-level t-caption' }, levelText(n))];
    if (n.fusion) meta.push(el('span', { class: 'gc-fusion t-caption', title: 'A blend of genres from more than one family' }, 'Fusion'));
    return el('div', { class: 'gc-head' },
      el('div', { class: 'gc-title' }, el('span', { class: dotClass(slot < 0 ? OTHER_COLOR : slot), 'aria-hidden': 'true' }), el('h2', { id: 'genre-card-title', class: 't-title', tabindex: '-1' }, n.label)),
      el('p', { class: 'gc-meta' }, ...meta),
      n.synonyms?.length ? el('p', { class: 'gc-synonyms t-caption muted' }, `Also called: ${n.synonyms.join(', ')}`) : null);
  }

  function about(n) {
    const desc = genreDescription(n);
    const links = n.group ? [] : shownSourceLinks(n.sourceLinks);
    return el('section', { class: 'gc-about', 'aria-label': 'Description' },
      el('p', { class: `gc-desc t-body${desc ? '' : ' muted'}` }, desc || NO_DESCRIPTION),
      links.length ? el('div', { class: 'gmr-links gc-links t-caption', role: 'group', 'aria-label': 'Genre sources' }, ...links.map((l) => el('a', {
        href: l.url, target: '_blank', rel: 'noopener noreferrer', 'data-source': l.source, title: `${l.label}: ${n.label}`, 'aria-label': `${l.label}: ${n.label} (opens in a new tab)`,
      }, icon(l.icon, 'inline'), l.label))) : null);
  }

  function sits(n) {
    const s = cardSections(n, tree);
    const groups = [chipGroup('Parents', s.parents, go), chipGroup('Subgenres', s.children, go), chipGroup('Groups', s.groups, go), chipGroup('Related', s.related, go)].filter(Boolean);
    if (!groups.length) return null;
    return el('section', { class: 'gc-sits', 'aria-label': 'Where it sits' }, el('h3', { class: 'gc-h t-caption muted' }, 'Where it sits'), ...groups);
  }

  function actions(n) {
    return el('div', { class: 'card-actions gc-actions' },
      el('button', { class: 'btn outline', type: 'button', onclick: () => { close(); viewInLibrary(n, tree); } }, icon('library', 'inline'), 'View in Library'),
      el('button', { class: 'btn outline', type: 'button', onclick: () => { close(); showGenreOnMap(n.name); } }, icon('genresMap', 'inline'), 'Show on map'));
  }

  function paint() {
    if (!tree) { message(failed ? LOAD_FAILED : 'Loading...'); return; }
    const n = resolveNode(current, tree);
    if (!n) { message(NOT_FOUND); return; }
    refs.show(n.group ? null : n.name);
    dlg.replaceChildren(topBar(), header(n), about(n), sits(n), n.group ? null : refs.node, actions(n));
  }

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault?.(); close(); }
  });
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => {
    live = false;
    refs.destroy();
    dlg.remove();
    if (opener?.isConnected) opener.focus();
  }, { once: true });

  document.body.append(dlg);
  paint();
  if (!tree) loadGenreTree().then((t) => { tree = t; failed = !t; if (live) paint(); });
  dlg.showModal();
  dlg.focus();
  return dlg;
}
