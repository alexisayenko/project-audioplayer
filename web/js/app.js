import { api, isSignedIn, session } from './api.js';
import { isGuest, setGuest, streamable, syncBanner } from './guest.js';
import { toast } from './dom.js';
import { player as playerApi, initPlayer, pausePlayer } from './player.js';
import { initVisualizer } from './viz-ui.js';
import { isShareHash, parseShareParams } from './share.js';
import { openShared, setShareHost } from './share-open.js';
import { initShare } from './share-ui.js';
import { loadLegal, syncLegal } from './legal.js';
import { store } from './store.js';
import { renderLibrary } from './library.js';
import { openAdd } from './add.js';
import { renderSettings } from './settings.js';
import { renderGenres } from './genres.js';
import { renderPlaylists } from './playlists.js';
import { renderStats } from './stats.js';
import { loadCollapsed, saveCollapsed } from './sidebar-state.js';
import { SYNC_POLL_MS } from './constants.js';

const player = document.getElementById('player');
const renderPlayback = () => { player.hidden = false; return () => { player.hidden = true; }; };
const routes = { library: renderLibrary, playback: renderPlayback, playlists: renderPlaylists, genres: renderGenres, stats: renderStats, settings: renderSettings };
const view = document.getElementById('view');
let cleanup = null;

function route() {
  let name = location.hash.replace(/^#\/?/, '') || 'library';
  const wantsAdd = name === 'add';
  const shared = isShareHash(location.hash) ? parseShareParams(location.hash) ?? 'bad' : null;
  if (shared) {
    name = 'library';
    history.replaceState(null, '', '#/library');
  }
  if (wantsAdd) {
    name = 'library';
    history.replaceState(null, '', '#/library');
  }
  if (!routes[name]) name = 'library';
  if (!isSignedIn() && !isGuest() && name !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  document.body.classList.toggle('signed-out', !isSignedIn() && !isGuest());
  if (cleanup) cleanup();
  view.replaceChildren();
  document.body.dataset.route = name;
  syncLegal(legalEl, legalCtx());
  cleanup = routes[name](view) || null;
  for (const a of document.querySelectorAll('#nav a')) {
    const on = a.dataset.route === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  if (wantsAdd) openAdd();
  if (shared) openShared(shared);
}

initPlayer();
const viz = initVisualizer({ player: playerApi });
setShareHost({ openFull: () => viz.full.open() });
initShare();
const sideToggle = document.getElementById('side-toggle');
function setCollapsed(collapsed) {
  document.body.classList.toggle('side-collapsed', collapsed);
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  sideToggle.setAttribute('aria-expanded', String(!collapsed));
  sideToggle.setAttribute('aria-label', label);
  sideToggle.title = label;
}
setCollapsed(loadCollapsed(localStorage));
sideToggle.addEventListener('click', () => {
  const next = !document.body.classList.contains('side-collapsed');
  setCollapsed(next);
  saveCollapsed(localStorage, next);
});
window.addEventListener('hashchange', route);
const stage = view.parentNode;
let shownGuest = false;

const legalEl = document.getElementById('legal');
function legalCtx() {
  return { guest: isGuest(), route: document.body.dataset.route, vizFull: document.body.classList.contains("viz-full-open") };
}

function syncGuestUi() {
  document.body.classList.toggle('guest', isGuest());
  document.body.classList.toggle('guest-noaudio', isGuest() && !streamable());
  syncBanner(stage, stage.firstChild, () => { location.hash = '#/settings'; });
  shownGuest = isGuest();
  syncLegal(legalEl, legalCtx());
}

async function enterGuest() {
  try {
    const me = await api.me();
    if (me?.guest) {
      setGuest(me);
      await store.refresh();
    }
  } catch { /* 401: the public view is off, the sign-in gate stays */ }
}

async function onAuthChanged() {
  const wasGuest = shownGuest;
  if (!isSignedIn()) {
    pausePlayer();
    if (!isGuest()) {
      syncGuestUi();
      route();
      await enterGuest();
    }
  } else if (wasGuest) {
    pausePlayer();
    store.songs = [];
    store.loaded = false;
    try { await store.refresh(); } catch { /* the library page shows the retry */ }
  }
  syncGuestUi();
  route();
}

window.addEventListener('auth-changed', () => { void onAuthChanged(); });
window.addEventListener('guest-limit', (e) => toast(e.detail));

try {
  await session.restore();
  if (isSignedIn()) {
    try { await store.refresh(); } catch { /* refresh failure keeps the cached library */ }
  } else {
    await enterGuest();
  }
} catch { /* restore failure leaves the app signed out */ }
syncGuestUi();
route();
void loadLegal(legalEl, legalCtx);

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
  const serverText = online ? `Server online \u00b7 ${location.host}` : 'Server unavailable';
  ledText.textContent = serverText;
  led.parentElement.title = serverText;
  led.parentElement.setAttribute('aria-label', serverText);
  warn.hidden = state === 'ok';
  warn.textContent = state === 'error'
    ? 'Library changes are not reaching git (retrying). Check the server.'
    : 'Library changes are waiting to sync to git.';
}

await checkSync().catch(() => {});
setInterval(() => checkSync().catch(() => {}), SYNC_POLL_MS);
