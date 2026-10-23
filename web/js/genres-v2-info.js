import { el } from './dom.js';
import { icon } from './icons.js';
import { familyIndex, dotClass } from './genre-data.js';
import { descriptionNode } from './genre-desc.js';
import { shownSourceLinks } from './genre-source-links.js';
import { createReferencesPanel } from './genre-references.js';

export const V2_NOT_FOUND = 'Genre not found';
export const V2_NO_DESCRIPTION = 'No description yet.';

export const v2LevelText = (g) => (g.level === 1 ? 'Level 1 (super-genre)' : `Level ${g.level}`);

export function createV2InfoRenderer(getData, dotFor = (name) => dotClass(familyIndex(name))) {
  return function renderV2Info(name, { container, titleId = 'genre-card-title' } = {}) {
    const refs = createReferencesPanel({ compact: true });
    let live = true;

    const find = (text) => {
      const byName = getData()?.byName || {};
      if (byName[text]) return byName[text];
      const k = String(text || '').toLowerCase();
      return Object.values(byName).find((g) => g.name.toLowerCase() === k) || null;
    };

    function header(g) {
      const meta = [el('span', { class: 'gc-level t-caption' }, v2LevelText(g))];
      if (g.clusterName) meta.unshift(el('span', { class: 'gc-cluster t-caption' }, g.clusterName));
      return el('div', { class: 'gc-head' },
        el('div', { class: 'gc-title' }, el('span', { class: dotFor(g.name), 'aria-hidden': 'true' }), el('h2', { id: titleId, class: 't-title', tabindex: '-1' }, g.name)),
        el('p', { class: 'gc-meta' }, ...meta));
    }

    function about(g) {
      const links = shownSourceLinks(g.source_links);
      const mm = typeof g.musicmap_url === 'string' && /^https:\/\//i.test(g.musicmap_url) ? g.musicmap_url : null;
      const anchors = links.map((l) => el('a', {
        href: l.url, target: '_blank', rel: 'noopener noreferrer', 'data-source': l.source, title: `${l.label}: ${g.name}`, 'aria-label': `${l.label}: ${g.name} (opens in a new tab)`,
      }, icon(l.icon, 'inline'), l.label));
      if (mm) anchors.push(el('a', { href: mm, target: '_blank', rel: 'noopener noreferrer', 'data-source': 'musicmap', 'aria-label': `Musicmap: ${g.name} (opens in a new tab)` }, icon('externalLink', 'inline'), 'Musicmap'));
      return el('section', { class: 'gc-about', 'aria-label': 'Description' },
        descriptionNode(g.description, V2_NO_DESCRIPTION),
        anchors.length ? el('div', { class: 'gmr-links gc-links t-caption', role: 'group', 'aria-label': 'Genre sources' }, ...anchors) : null);
    }

    function paint(text) {
      const g = find(text);
      if (!g) {
        refs.show(null);
        container.replaceChildren(el('h2', { id: titleId, class: 't-title', tabindex: '-1' }, V2_NOT_FOUND));
        return;
      }
      refs.show(g.v1 || null);
      container.replaceChildren(header(g), about(g), g.v1 ? refs.node : null);
    }

    paint(name);
    return {
      show: (next) => { if (live) paint(next); },
      focusTitle: () => container.querySelector(`#${titleId}`)?.focus(),
      destroy: () => { live = false; refs.destroy(); },
    };
  };
}
