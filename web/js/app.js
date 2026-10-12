import { getToken } from './api.js';
import { initPlayer } from './player.js';
import { renderLibrary } from './library.js';
import { renderAdd } from './add.js';
import { renderSettings } from './settings.js';

const routes = { library: renderLibrary, add: renderAdd, settings: renderSettings };
const view = document.getElementById('view');
let cleanup = null;

function route() {
  let name = location.hash.replace(/^#\/?/, '') || 'library';
  if (!routes[name]) name = 'library';
  if (!getToken() && name !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  if (cleanup) cleanup();
  view.replaceChildren();
  cleanup = routes[name](view) || null;
  for (const a of document.querySelectorAll('#nav a')) {
    const on = a.dataset.route === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

initPlayer();
window.addEventListener('hashchange', route);
route();
