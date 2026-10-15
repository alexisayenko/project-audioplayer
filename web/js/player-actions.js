import { storedLinkStates, hostKind } from './song-links.js';
import { songSources } from './song-payload.js';
import { icon } from './icons.js';
import { wikiTarget } from './wiki-links.js';
import { serviceIcon, LABELS } from './service-icons.js';

const KINDS = ['youtube', 'soundcloud'];

export function serviceButtons(song) {
  const states = storedLinkStates(song);
  return KINDS.filter((k) => states[k]?.url).map((k) => ({ kind: k, url: states[k].url, label: `Open on ${LABELS[k]}` }));
}

export function otherSourceUrl(song) {
  const hit = songSources(song).find(({ url }) => !KINDS.includes(hostKind(url)) && /^https?:\/\//i.test(url));
  return hit ? hit.url : null;
}

export function paintServiceButtons(host, song) {
  const nodes = serviceButtons(song).map(({ kind, url, label }) => {
    const a = document.createElement('a');
    a.className = `icon round svc svc-${kind} on`;
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = label;
    a.setAttribute('aria-label', label);
    a.append(serviceIcon(kind, { size: 22 }));
    return a;
  });
  const other = otherSourceUrl(song);
  if (other) {
    const a = document.createElement('a');
    a.className = 'icon round svc on';
    a.href = other;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open source';
    a.setAttribute('aria-label', 'Open source');
    a.append(icon('link', 22));
    nodes.push(a);
  }
  const wiki = wikiTarget(song);
  if (wiki) {
    const a = document.createElement('a');
    a.className = 'icon round svc svc-wikipedia on';
    a.href = wiki.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = wiki.label;
    a.setAttribute('aria-label', wiki.label);
    a.append(serviceIcon('wikipedia', { size: 22 }));
    nodes.push(a);
  }
  host.replaceChildren(...nodes);
  host.hidden = !nodes.length;
}
