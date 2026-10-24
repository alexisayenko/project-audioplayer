import { el } from './dom.js';
import { icon } from './icons.js';
import { familyIndex, dotClass } from './genre-data.js';
import { filterByTags } from './library-data.js';
import { count, libraryTags, otherGenres, STATUS_LABELS } from './genre-levels.js';
import { songs, GROUP_TEXT, groupBadgeText } from './genres-rework-text.js';

function badge(text, label, cls = '') {
  return el('span', { class: `gmr-badge ${cls}`.trim(), role: 'img', title: label, 'aria-label': label }, text);
}

function modifierBadge(tree, k) {
  const m = tree.modifiers.get(k);
  return el('span', { class: 'gmr-badge mod', title: m.description || m.name }, m.name);
}

function parentJump(target, select) {
  return el('button', {
    class: 'gmr-also', type: 'button', tabindex: '-1', 'aria-label': `Parent ${target.label}: jump to ${target.label}`, title: `Parent ${target.label}`,
    onclick: (e) => { e.stopPropagation(); select(target.id, { reveal: true, center: true }); },
  }, `parent ${target.label}`);
}

function parentJumps(r, n, { tree, kind, select }) {
  return n.parents.filter((id) => id !== r.parentId && !id.startsWith('g:')).map((id) => {
    const target = tree.byId.get(id);
    if (!target || target.group || (kind === 'radial' && !count(target))) return null;
    return parentJump(target, select);
  });
}

function songControls(tree, n, total) {
  if (!total) return [null, null];
  const label = `Show ${songs(total)} in the Library`;
  return [
    el('span', { class: 'gmr-count t-caption', role: 'img', 'aria-label': songs(total) }, String(total)),
    el('button', {
      class: 'gmr-lib-btn', type: 'button', 'aria-label': label, title: label,
      onclick: (e) => { e.stopPropagation(); filterByTags(libraryTags(tree, n.id)); location.hash = '#/library'; },
    }, icon('library', 'inline')),
  ];
}

function rowParts(r, ctx, rootName) {
  const { tree, labelOf } = ctx;
  const n = r.node;
  return [
    el('span', { class: `gmr-chev${r.hasChildren ? '' : ' none'}`, 'aria-hidden': 'true' }, r.hasChildren ? icon('chevron', 'inline') : null),
    n.level === 1 ? el('span', { class: dotClass(familyIndex(n.name)), 'aria-hidden': 'true' }) : null,
    el('span', { class: 'gmr-name' }, n.label),
    r.via ? el('span', { class: 'gmr-via t-caption muted' }, `also called ${r.via}`) : null,
    ...otherGenres(n, rootName).map((g) => badge(`also in ${labelOf(g)}`, `Also in ${labelOf(g)}`, 'alsoin')),
    n.group ? badge(groupBadgeText(n), GROUP_TEXT(n), 'group') : null,
    n.provisional ? badge('provisional', 'Provisional: placement not reviewed yet', 'prov') : null,
    !n.discogs ? badge('not in Discogs', 'Not in Discogs', 'nodisc') : null,
    ...n.modifiers.map((k) => modifierBadge(tree, k)),
    n.status === 'question' ? badge('question', STATUS_LABELS.question, 'q') : null,
    ...parentJumps(r, n, ctx),
    ...songControls(tree, n, n.group ? 0 : count(n)),
  ];
}

export function buildRow(r, i, ctx, rootName) {
  const n = r.node;
  const { selectedId, activeId, rowCount, select } = ctx;
  const attrs = {
    class: `gmr-row l${Math.min(r.level, 3)}${selectedId === n.id ? ' sel' : ''}${r.matched ? ' hit' : ''}`,
    role: 'treeitem', 'data-id': r.key, 'data-node': n.id, tabindex: r.key === activeId ? '0' : '-1', 'aria-level': String(r.level), style: `--lvl:${r.level}`,
    'aria-selected': String(selectedId === n.id), 'aria-posinset': String(i + 1), 'aria-setsize': String(rowCount),
    onclick: () => select(n.id, { center: true, toggle: r.hasChildren }),
  };
  if (r.hasChildren) attrs['aria-expanded'] = String(r.expanded);
  return el('div', attrs, rowParts(r, ctx, rootName));
}
