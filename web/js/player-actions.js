import { storedLinkStates } from './song-links.js';
import { serviceIcon, LABELS } from './service-icons.js';

const KINDS = ['youtube', 'soundcloud'];

export function serviceButtons(song) {
  const states = storedLinkStates(song);
  return KINDS.filter((k) => states[k]?.url).map((k) => ({ kind: k, url: states[k].url, label: `Open on ${LABELS[k]}` }));
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
  host.replaceChildren(...nodes);
  host.hidden = !nodes.length;
}
