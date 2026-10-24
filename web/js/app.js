import './input-modality.js';
import { api, isSignedIn, session, startup } from './api.js';
import { isGuest, setGuest, streamable, syncBanner } from './guest.js';
import { el, toast } from './dom.js';
import { player as playerApi, initPlayer, pausePlayer } from './player.js';
import { lazyVisualizer } from './viz-lazy.js';
import { lazyRoute } from './lazy-route.js';
import { loadingNote } from './loading-note.js';
import { startBackgroundLoad } from './prefetch.js';
import { isShareHash } from './share-hash.js';
import { initShare } from './share-buttons.js';
import { loadLegal, syncLegal } from './legal.js';
import { store } from './store.js';
import { renderLibrary } from './library.js';
import { openAdd, loadUi } from './lazy-ui.js';
import { loadCollapsed, saveCollapsed } from './sidebar-state.js';
import { SYNC_POLL_MS } from './constants.js';
import { describeSync } from './sync-status.js';
import { describeBuild } from './build-info.js';
import { initHelpNav } from './nav-help.js';
import { renderLogin } from './login.js';

const STARTING_RECHECK_MS = 3000;
const player = document.getElementById('player');
const renderPlayback = () => { player.hidden = false; return () => { player.hidden = true; }; };
const routes = {
  library: renderLibrary,
  playback: renderPlayback,
  playlists: lazyRoute(() => import('./playlists.js'), 'renderPlaylists'),
  genres: lazyRoute(() => import('./genres-rework.js'), 'renderGenresRework'),
  genres2: lazyRoute(() => import('./genres-rework.js'), 'renderGenresMapV2'),
  'genres-classic': lazyRoute(() => import('./genres.js'), 'renderGenres'),
  stats: lazyRoute(() => import('./stats.js'), 'renderStats'),
  theory: lazyRoute(() => import('./theory.js'), 'renderTheory'),
  about: lazyRoute(() => import('./about.js'), 'renderAbout'),
  studio: lazyRoute(() => import('./studio.js').then((m) => ({ renderStudio: (root) => m.renderStudio(root, { player: playerApi }) })), 'renderStudio'),
  features: lazyRoute(() => import('./features.js'), 'renderFeatures'),
  settings: lazyRoute(() => import('./settings.js'), 'renderSettings'),
};
const view = document.getElementById('view');
let cleanup = null;

async function openSharedLink(hash) {
  try {
    const [{ parseShareParams }, open] = await Promise.all([import('./share.js'), loadUi('shareOpen')]);
    open.setShareHost({ openFull: () => { void viz.openFull(); } });
    open.openShared(parseShareParams(hash) ?? 'bad');
  } catch {
    toast('The shared link could not be opened. Check the connection and try again.');
  }
}

function showLogin() {
  document.body.classList.add('signed-out');
  if (document.body.dataset.route === 'login' && view.firstChild) return;
  if (cleanup) cleanup();
  view.replaceChildren();
  document.body.dataset.route = 'login';
  player.hidden = true;
  syncLegal(legalEl, legalCtx());
  cleanup = renderLogin(view);
  window.scrollTo(0, 0);
}

function route() {
  document.body.classList.remove('auth-pending');
  if (!isSignedIn() && !isGuest()) {
    showLogin();
    return;
  }
  let name = location.hash.replace(/^#\/?/, '') || 'library';
  const wantsAdd = name === 'add';
  const shared = isShareHash(location.hash) ? location.hash : null;
  if (shared) {
    name = 'library';
    history.replaceState(null, '', '#/library');
  }
  if (wantsAdd) {
    name = 'library';
    history.replaceState(null, '', '#/library');
  }
  if (name.startsWith('playlists/')) name = 'playlists';
  if (name === 'studio/tools') name = 'studio';
  if (name === 'genres-rework') {
    name = 'genres';
    history.replaceState(null, '', '#/genres');
  }
  if (!routes[name]) name = 'library';
  document.body.classList.remove('signed-out');
  if (cleanup) cleanup();
  view.replaceChildren();
  document.body.dataset.route = name;
  syncLegal(legalEl, legalCtx());
  cleanup = routes[name](view) || null;
  if (name === 'playback') void viz.ensure().catch(() => {});
  for (const a of document.querySelectorAll('#nav a')) {
    const on = a.dataset.route === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  help?.sync(name);
  window.scrollTo(0, 0);
  if (wantsAdd) void openAdd();
  if (shared) void openSharedLink(shared);
}

initPlayer();
const viz = lazyVisualizer({ player: playerApi });
initShare();
const help = initHelpNav();
const sideToggle = document.getElementById('side-toggle');
function setCollapsed(collapsed) {
  document.body.classList.toggle('side-collapsed', collapsed);
  help?.refresh();
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

function resetUnloaded() {
  store.songs = [];
  store.loaded = false;
}

async function enterGuest(early) {
  try {
    const me = await (early?.me ?? api.me());
    if (me?.guest) {
      setGuest(me);
      await (early?.library ?? store.refresh());
    } else if (early) {
      resetUnloaded();
    }
  } catch {
    if (early) resetUnloaded();
  }
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

window.addEventListener('server-starting', () => {
  document.body.classList.remove('auth-pending');
  if (startup.waiting && !view.firstChild) view.replaceChildren(loadingNote('Server is starting...'));
});

const early = { me: api.me(), library: store.refresh() };
early.me.catch(() => {});
early.library.catch(() => {});
try {
  await session.restore();
  if (isSignedIn()) {
    try { await early.library; } catch { /* refresh failure keeps the cached library */ }
  } else {
    await enterGuest(early);
  }
} catch { /* restore failure leaves the app signed out */ }
syncGuestUi();
route();
void loadLegal(legalEl, legalCtx);
void startBackgroundLoad().catch(() => {});
void import('./update-check.js').then((m) => m.startUpdateCheck()).catch(() => {});

const warn = document.getElementById('sync-warn');
const led = document.getElementById('server-led');
const buildEl = document.getElementById('server-build');

const settingsLink = [...document.querySelectorAll('#nav a')].find((a) => a.dataset.route === 'settings');

function markSettingsLink(view) {
  if (!settingsLink) return;
  if (view.dot) {
    settingsLink.dataset.sync = view.level;
    settingsLink.setAttribute('aria-label', `Settings, ${view.label}`);
  } else {
    delete settingsLink.dataset.sync;
    settingsLink.removeAttribute('aria-label');
  }
}

let recheck = null;

async function checkSync() {
  let raw = 'ok';
  let build = null;
  let online = false;
  let starting = false;
  try {
    const res = await fetch('/health');
    online = res.ok;
    if (res.ok) {
      const body = await res.json();
      starting = body.ready === false;
      raw = body.sync || 'ok';
      build = describeBuild(body.build);
    }
  } catch { /* server unreachable: api calls report that */ }
  led.classList.toggle('down', !online);
  led.classList.toggle('starting', starting);
  let serverText = online ? `Server online · ${location.host}` : 'Server unavailable';
  if (starting) serverText = 'Server starting';
  led.parentElement.title = serverText;
  led.parentElement.setAttribute('aria-label', serverText);
  if (online && !starting) store.sync = raw;
  store.build = online ? build : null;
  buildEl.hidden = !store.build;
  buildEl.textContent = store.build ? store.build.text : '';
  buildEl.title = store.build ? store.build.title : '';
  const view = describeSync(online ? raw : 'ok');
  const shown = isGuest() || !online ? { level: 'none', dot: false } : view;
  warn.hidden = shown.level === 'none';
  warn.textContent = shown.level === 'none' ? '' : view.text;
  markSettingsLink(shown);
  window.dispatchEvent(new Event('sync-changed'));
  clearTimeout(recheck);
  recheck = starting ? setTimeout(() => checkSync().catch(() => {}), STARTING_RECHECK_MS) : null;
}

await checkSync().catch(() => {});
setInterval(() => checkSync().catch(() => {}), SYNC_POLL_MS);
