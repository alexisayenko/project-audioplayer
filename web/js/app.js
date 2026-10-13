import { isSignedIn, session } from './api.js';
import { initPlayer, pausePlayer } from './player.js';
import { store } from './store.js';
import { renderLibrary } from './library.js';
import { openAdd } from './add.js';
import { renderSettings } from './settings.js';

const player = document.getElementById('player');
const renderPlayback = () => { player.hidden = false; return () => { player.hidden = true; }; };
const routes = { library: renderLibrary, playback: renderPlayback, settings: renderSettings };
const view = document.getElementById('view');
let cleanup = null;

function route() {
  let name = location.hash.replace(/^#\/?/, '') || 'library';
  const wantsAdd = name === 'add';
  if (wantsAdd) {
    name = 'library';
    history.replaceState(null, '', '#/library');
  }
  if (!routes[name]) name = 'library';
  if (!isSignedIn() && name !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  document.body.classList.toggle('signed-out', !isSignedIn());
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
  if (wantsAdd) openAdd();
}

initPlayer();
window.addEventListener('hashchange', route);
window.addEventListener('auth-changed', () => {
  if (!isSignedIn()) pausePlayer();
  route();
});

try {
  await session.restore();
  if (isSignedIn()) store.refresh().catch(() => {});
} catch { /* restore failure leaves the app signed out */ }
route();

const warn = document.getElementById('sync-warn');
const led = document.getElementById('server-led');
const ledText = document.getElementById('server-text');

async function checkSync() {
  let state = 'ok';
  let online = false;
  try {
    const res = await fetch('/health');
    online = res.ok;
    if (res.ok) state = (await res.json()).sync || 'ok';
  } catch { /* server unreachable: api calls report that */ }
  led.classList.toggle('down', !online);
  ledText.textContent = online ? `Server online \u00b7 ${location.host}` : 'Server unavailable';
  warn.hidden = state === 'ok';
  warn.textContent = state === 'error'
    ? 'Library changes are not reaching git (retrying). Check the server.'
    : 'Library changes are waiting to sync to git.';
}

await checkSync().catch(() => {});
setInterval(() => checkSync().catch(() => {}), 30000);
