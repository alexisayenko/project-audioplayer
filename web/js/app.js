import { getToken } from './api.js';
import { initPlayer } from './player.js';
import { store } from './store.js';
import { renderLibrary } from './library.js';
import { renderAdd } from './add.js';
import { renderSettings } from './settings.js';

const player = document.getElementById('player');
const renderPlayback = () => { player.hidden = false; return () => { player.hidden = true; }; };
const routes = { library: renderLibrary, add: renderAdd, playback: renderPlayback, settings: renderSettings };
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
  document.body.dataset.route = name;
  cleanup = routes[name](view) || null;
  for (const a of document.querySelectorAll('#nav a')) {
    const on = a.dataset.route === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

initPlayer();
if (getToken()) store.refresh().catch(() => {});
window.addEventListener('hashchange', route);
route();

const warn = document.getElementById('sync-warn');

async function checkSync() {
  let state = 'ok';
  try {
    const res = await fetch('/health');
    if (res.ok) state = (await res.json()).sync || 'ok';
  } catch { /* server unreachable: api calls report that */ }
  warn.hidden = state === 'ok';
  warn.textContent = state === 'error'
    ? 'Library changes are not reaching git (retrying). Check the server.'
    : 'Library changes are waiting to sync to git.';
}

checkSync();
setInterval(checkSync, 30000);
