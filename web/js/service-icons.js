const NS = 'http://www.w3.org/2000/svg';

const SHAPES = {
  youtube: '<path fill-rule="evenodd" d="M4.8 4.3h14.4A4.8 4.8 0 0 1 24 9.1v5.8a4.8 4.8 0 0 1-4.8 4.8H4.8A4.8 4.8 0 0 1 0 14.9V9.1a4.8 4.8 0 0 1 4.8-4.8zM9.1 7.9 15.4 12 9.1 16.1z"/>',
  soundcloud: '<path d="M3 18.7A3.4 3.4 0 0 1 3 11.9A5.3 5.3 0 0 1 10.6 8.2A7.6 7.6 0 0 1 19 11.1A3.8 3.8 0 0 1 19 18.7z"/>',
  wikipedia: '<text x="12" y="20" font-size="23" font-weight="600" font-family="Georgia, \'Times New Roman\', serif" text-anchor="middle">W</text>',
  spotify: '<circle cx="12" cy="12" r="12"/><g fill="none" stroke="var(--surface)" stroke-width="1.9" stroke-linecap="round"><path d="M6.2 9.1Q12 6.8 17.8 9.1"/><path d="M7.4 12Q12 10 16.6 12"/><path d="M8.5 14.9Q12 13.3 15.5 14.9"/></g>',
};
export const LABELS = { youtube: 'YouTube', soundcloud: 'SoundCloud', wikipedia: 'Wikipedia', spotify: 'Spotify' };
const ORDER = ['youtube', 'soundcloud', 'wikipedia', 'spotify'];

function glyph(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SHAPES[name];
  return svg;
}

const EXTERNAL = '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';

export function serviceIcon(kind, { size = 22 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SHAPES[kind] || EXTERNAL;
  return svg;
}

function make(name, st, busy) {
  const on = !!st?.on;
  const cls = `svc svc-${name}${on ? ' on' : ''}${busy && name !== 'spotify' ? ' pulse' : ''}`;
  const link = on && st.url;
  const node = document.createElement(link ? 'a' : 'span');
  node.className = cls;
  node.setAttribute('aria-label', LABELS[name]);
  node.title = LABELS[name];
  if (link) {
    node.href = st.url;
    node.target = '_blank';
    node.rel = 'noopener';
  } else {
    node.setAttribute('role', 'img');
  }
  node.append(glyph(name));
  return node;
}

export function serviceIcons() {
  const node = document.createElement('div');
  node.className = 'svc-row';
  let state = {};
  let busy = false;
  const paint = () => node.replaceChildren(...ORDER.map((n) => make(n, state[n], busy)));
  paint();
  return {
    node,
    setBusy(b) { busy = b; paint(); },
    setState(s) { state = s || {}; paint(); },
    reset() { state = {}; busy = false; paint(); },
  };
}
