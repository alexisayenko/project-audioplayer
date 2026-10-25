import { el } from '../web/js/dom.js';
import { mountRhythm, mountListen, mountChordophones } from '../web/js/studio-tools.js';
import { mountSimple } from '../web/js/simple-tone.js';
import { PAGES, pageFromHash } from './routes.js';
import { mountPlaceholder } from './placeholders.js';
import { mountGlossary } from './glossary.js';
import { mountMenu } from './menu.js';
import { mountFeatures, mountHelp, mountAbout } from './help.js';

const MOUNT = {
  'synthesize/simple': (pane) => mountSimple(pane),
  'synthesize/chordophones': (pane) => mountChordophones(pane),
  'synthesize/aerophones': (pane) => mountPlaceholder(pane, 'synthesize/aerophones'),
  'synthesize/membranophones': (pane) => mountPlaceholder(pane, 'synthesize/membranophones'),
  'synthesize/idiophones': (pane) => mountPlaceholder(pane, 'synthesize/idiophones'),
  'analyze/listen': (pane) => mountListen(pane),
  'analyze/rhythm': (pane) => mountRhythm(pane),
  glossary: (pane) => mountGlossary(pane),
  'help/features': (pane) => mountFeatures(pane),
  'help/help': (pane) => mountHelp(pane),
  'help/about': (pane) => mountAbout(pane),
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
  const pane = el('div', { class: 'stu', id: `stu-${page.replace('/', '-')}` });
  root.replaceChildren(pane);
  stop = MOUNT[page](pane);
  document.title = `${PAGES.find((p) => p.id === page).label} - Electrophone Studio`;
}

mountMenu(document.querySelector('.site-shell'));
globalThis.addEventListener('hashchange', show);
show();
