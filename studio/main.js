import { el } from '../web/js/dom.js';
import { mountTools } from '../web/js/studio-tools.js';
import { mountSimple } from '../web/js/simple-tone.js';
import { PAGES, pageFromHash } from './routes.js';

const MOUNT = {
  analyze: (pane) => mountTools(pane, { standalone: true }),
  synthesize: (pane) => mountSimple(pane),
};

const root = document.getElementById('app');
const links = [...document.querySelectorAll('.site-nav a[data-page]')];
let current = null;
let stop = null;

function show() {
  const page = pageFromHash(globalThis.location.hash);
  if (page === current) return;
  current = page;
  stop?.();
  for (const a of links) {
    if (a.dataset.page === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const pane = el('div', { class: 'stu', id: `stu-${page}` });
  root.replaceChildren(pane);
  stop = MOUNT[page](pane);
  document.title = `${PAGES.find((p) => p.id === page).label} - Electrophone Studio`;
}

globalThis.addEventListener('hashchange', show);
show();
