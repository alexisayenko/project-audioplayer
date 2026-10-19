import { el } from './dom.js';
import { icon } from './icons.js';
import { SOURCES } from './genre-source-links.js';

export function sourceIcons(links, genreLabel) {
  const out = [];
  for (const s of SOURCES) {
    const l = (links || []).find((x) => x.source === s.key);
    if (!l) continue;
    const search = l.kind === 'search';
    out.push(el('a', {
      class: `gmr-src ${search ? 'search' : 'page'}`, href: l.url, target: '_blank', rel: 'noopener noreferrer', 'data-source': s.key,
      'aria-label': `${s.label}: ${genreLabel}`, title: search ? `Search on ${s.label}` : `Open on ${s.label}`,
    }, icon(s.icon, 'action')));
  }
  return out.length ? el('span', { class: 'gmr-sources', 'data-slot': 'source-icons' }, ...out) : null;
}
