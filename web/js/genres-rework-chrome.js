import { el } from './dom.js';
import { icon } from './icons.js';

const SEE_ALSO = [
  ['Rate Your Music genres', 'https://rateyourmusic.com/genres/', 'Genre tree and descriptions'],
  ['Musicmap', 'https://musicmap.info/', 'Genealogy of popular music genres'],
];

export const pageTitle = (v2, dock) => (v2 || dock ? 'Genres map v2' : 'Genres map');

export function createSeeAlso() {
  return el('div', { class: 'gmr-seealso t-caption', role: 'group', 'aria-label': 'See also' },
    el('span', { class: 'gmr-seealso-label' }, 'See also'),
    ...SEE_ALSO.map(([label, href, tip]) => el('a', {
      href, target: '_blank', rel: 'noopener noreferrer', title: tip, 'aria-label': `${label}: ${tip} (opens in a new tab)`,
    }, label, icon('externalLink', 'inline'))));
}

export function createZoomBar(getView) {
  return el('div', { class: 'gm-zoom', role: 'group', 'aria-label': 'Zoom' },
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => getView().zoomBy(1.3) }, icon('plus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => getView().zoomBy(1 / 1.3) }, icon('minus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => getView().reset() }, icon('maximize', 'action')));
}

export function createLegend(open, kind, legendSub) {
  const legend = el('div', { class: 'gmr-legend', id: 'gmr-legend', role: 'group', 'aria-labelledby': 'gmr-legend-title', hidden: !open },
    el('h2', { class: 'gmr-legend-title t-caption', id: 'gmr-legend-title' }, 'Legend'),
    el('ul', { class: 'gmr-legend-list t-caption' },
      el('li', {}, el('span', { class: 'gmr-key size', 'aria-hidden': 'true' }), 'Size: songs here and below'),
      el('li', { class: 'gmr-r' }, el('span', { class: 'gmr-key neutral', 'aria-hidden': 'true' }), 'Grey: no song tagged here, shown to connect genres below'),
      el('li', { class: 'gmr-g' }, el('span', { class: 'gmr-key', 'aria-hidden': 'true' }), 'Solid, full colour: a song in your library is tagged with this genre'),
      el('li', { class: 'gmr-g' }, el('span', { class: 'gmr-key faint', 'aria-hidden': 'true' }), 'Faint: no song in your library; it only appears here as part of the vocabulary'),
      el('li', {}, el('span', { class: 'gmr-key split', 'aria-hidden': 'true' }), 'Split colour: genre belongs to several families'),
      el('li', {}, el('span', { class: 'gmr-key split', 'aria-hidden': 'true' }), 'Fusion genre (shown with the Fusion genres toggle)'),
      el('li', {}, el('span', { class: 'gmr-key nodisc', 'aria-hidden': 'true' }), 'Dashed ring: not in Discogs'),
      el('li', {}, el('span', { class: 'gmr-key group', 'aria-hidden': 'true' }), 'Dashed outline on grey: a temporary group (organisational, never assigned to a song)'),
      el('li', {}, el('span', { class: 'gmr-key q', 'aria-hidden': 'true' }), 'Question badge: under question'),
      el('li', {}, el('span', { class: 'gmr-line dotted', 'aria-hidden': 'true' }), 'Dotted: related (influence, not a parent)'),
      el('li', { class: 'gmr-g' }, el('span', { class: 'gmr-line', 'aria-hidden': 'true' }), 'Line: parent genre (a genre with several parents has a line to each)')));
  legend.classList.toggle('is-graph', kind === 'graph');
  legend.append(legendSub);
  return legend;
}

export function createBar({ status, bar, reload, familyRow, subRow, groupNote, preview }) {
  return el('div', { class: 'gmr-bar' }, status,
    el('div', { class: 'gmr-btns' }, bar.legendBtn, bar.nowBtn, reload),
    el('div', { class: 'gmr-btns' }, bar.viewRow, bar.libBtn, bar.drillBtn, bar.collapseMapBtn, bar.fusionBtn, bar.relatedBtn, bar.resetLayoutBtn, bar.useSavedBtn, bar.exportBtn),
    familyRow, subRow, groupNote, preview);
}

export function createCloseButton(onclick) {
  return el('button', {
    class: 'gm-x', type: 'button', 'aria-label': 'Close outline', title: 'Close outline', 'aria-controls': 'gmr-panel', 'aria-expanded': 'true', onclick,
  }, icon('clear', 'nav'));
}

export function fillSide(p) {
  if (p.v2) {
    p.side.append(p.barEl, el('div', { class: 'gmr-scroll' }, el('div', { class: 'gmr-tools' }, p.search, p.modifierRow)), p.seeAlso);
    return;
  }
  p.outlineEl.append(
    el('div', { class: 'gmr-scroll' },
      el('div', { class: 'gmr-tools' }, p.search, p.expandAll, p.collapseAll, p.statusRow, p.modifierRow),
      p.treeEl, p.empty));
  p.side.append(
    el('div', { class: 'gm-outline-head' }, el('h2', { class: 't-headline' }, 'Outline'), p.closeBtn),
    p.barEl,
    p.outlineEl,
    p.seeAlso);
}

export function workChildren(p) {
  const out = [p.canvas, p.graphCanvas];
  if (p.dock) out.push(p.dock.node);
  if (!p.v2) out.push(p.side, p.outlineBtn);
  out.push(p.zoomBar);
  if (!p.v2) out.push(p.legend);
  return out;
}
