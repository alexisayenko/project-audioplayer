import { api, auth, session } from './api.js';
import { usageText } from './limits.js';
import { store } from './store.js';
import { player } from './player.js';
import { autoDownloadOn, setAutoDownload } from './autodl.js';
import { el, pageHead } from './dom.js';
import { signInErrorText } from './signin-error.js';
import { serviceIcon } from './service-icons.js';
import { isGuest, ownerLabel } from './guest.js';
import { bpmCard, metadataCard } from './backfill-card.js';
import { downloadAllCard } from './bulk-download.js';
import { isSupported as vizSupported } from './audio-graph.js';
import {
  vizCaps, vizMode, setVizMode, vizHeightId, setVizHeight,
} from './viz-settings.js';
import { availableModes } from './viz-modes.js';
import { TERRAIN_STYLES, getStyle, setStyle } from './viz-terrain-style.js';
import { HEIGHT_OPTIONS } from './viz-constants.js';

const GSI = 'https://accounts.google.com/gsi/client';
const APPLE = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const loading = new Map();
function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const s = el('script', { src, async: true });
      s.onload = resolve;
      s.onerror = () => { loading.delete(src); reject(new Error(`Could not load ${new URL(src).hostname}`)); };
      document.head.append(s);
    }));
  }
  return loading.get(src);
}

async function finish(idToken, out) {
  try {
    await session.start(idToken);
    window.dispatchEvent(new Event('auth-changed'));
    await store.refresh();
    location.hash = '#/library';
  } catch (ex) {
    out.replaceChildren(el('p', { class: 'msg error' }, ex.message));
  }
}

async function setupProviders(box, out) {
  let cfg;
  try { cfg = await session.config(); } catch (ex) {
    box.replaceChildren(el('p', { class: 'msg error' }, ex.message));
    return;
  }
  box.replaceChildren();
  const row = (label, control) => el('div', { class: 'cell' }, el('span', { class: 't-subhead' }, label), control);
  if (cfg.google_client_id) {
    const slot = el('div', { class: 'signin-slot' });
    box.append(row('Sign in with Google', slot));
    loadScript(GSI).then(() => {
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: (r) => finish(r.credential, out),
      });
      window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'medium', text: 'signin', shape: 'pill' });
    }).catch((ex) => slot.replaceChildren(el('p', { class: 'msg error' }, ex.message)));
  }
  if (cfg.apple_client_id) {
    const btn = el('button', { class: 'btn outline', type: 'button', disabled: true }, serviceIcon('apple', { size: 'inline' }), 'Sign in');
    box.append(row('Sign in with Apple', btn));
    loadScript(APPLE).then(() => {
      window.AppleID.auth.init({
        clientId: cfg.apple_client_id,
        scope: 'email',
        redirectURI: cfg.apple_redirect,
        usePopup: true,
      });
      btn.disabled = false;
      btn.addEventListener('click', async () => {
        try {
          const r = await window.AppleID.auth.signIn();
          await finish(r.authorization.id_token, out);
        } catch (ex) {
          if (ex && ex.error !== 'popup_closed_by_user') out.replaceChildren(el('p', { class: 'msg error' }, signInErrorText('Apple', ex, location.origin)));
        }
      });
    }).catch((ex) => btn.replaceWith(el('p', { class: 'msg error' }, ex.message)));
  }
  if (!cfg.google_client_id && !cfg.apple_client_id) {
    box.append(el('p', { class: 'muted t-subhead' }, 'Sign-in is not configured on the server.'));
  }
}

function accountSection() {
  const out = el('div');
  if (auth.email) {
    return el('div', { class: 'account' },
      el('div', { class: 'cell' },
        el('span', { class: 't-subhead set-text' }, 'Signed in as ', el('b', {}, auth.email)),
        el('button', {
          class: 'btn outline small signout',
          type: 'button',
          onclick: async () => {
            try { await session.end(); } catch { /* cookie expires on its own */ }
            store.songs = [];
            store.loaded = false;
            window.dispatchEvent(new Event('auth-changed'));
          },
        }, 'Sign out')));
  }
  const box = el('div', { class: 'signin-box' });
  void setupProviders(box, out);
  const intro = isGuest() ? `You are viewing ${ownerLabel()}'s library (read-only). Sign in to build your own.` : 'Sign in to see your library, add songs and play them.';
  return el('div', { class: 'account' }, el('p', { class: 'muted t-subhead' }, intro), box, out);
}

const SYNC_TEXT = { ok: 'In sync with git', error: 'Not reaching git (retrying)' };

function accountCard() {
  return el('section', { class: 'card' }, el('h2', { class: 't-headline' }, 'Account'), accountSection());
}

function libraryCard() {
  const songs = store.songs.length;
  const secs = store.songs.reduce((n, s) => n + (s.duration || 0), 0);
  const hours = secs >= 3600 ? `${(secs / 3600).toFixed(1)} h of music` : `${Math.round(secs / 60)} min of music`;
  const meter = el('span', { class: 't-caption' }, '');
  api.usage().then((u) => { meter.textContent = usageText(u); }).catch(() => { meter.textContent = ''; });
  const sync = el('span', {}, 'Checking...');
  fetch('/health').then((r) => r.json()).then((h) => {
    sync.textContent = SYNC_TEXT[h.sync] || 'Waiting to sync to git';
  }).catch(() => { sync.textContent = 'Server unreachable'; });
  return el('section', { class: 'card' },
    el('h2', { class: 't-headline' }, 'Library'),
    el('div', { class: 'cell' },
      el('span', { class: 't-title' }, `${songs} ${songs === 1 ? 'song' : 'songs'}`),
      el('span', { class: 'muted t-caption' }, songs ? hours : '')),
    el('div', { class: 'divider' }),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Storage'), meter),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Sync'), el('span', { class: 't-caption' }, sync)),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Server'), el('span', { class: 't-caption' }, location.host)));
}

function playbackCard() {
  const box = el('input', { type: 'checkbox', id: 'auto-dl', checked: autoDownloadOn() });
  box.addEventListener('change', () => {
    setAutoDownload(box.checked);
    player.autoDownloadChanged();
  });
  return el('section', { class: 'card' },
    el('h2', { class: 't-headline' }, 'Playback'),
    el('label', { class: 'switch-row', for: 'auto-dl' },
      el('span', { class: 't-subhead set-text' }, 'Auto-download songs',
        el('small', { class: 't-caption' }, 'Download songs you play or add to the playlist. Each download counts toward the hourly add limit.')), box));
}

function visualizerCard() {
  return el('section', { class: 'card' }, el('h2', { class: 't-headline' }, 'Visualizer'), ...vizRows());
}

function vizSelect({ id, label, note, options, value, disabled, onChange }) {
  const select = el('select', { id, disabled },
    options.map((o) => el('option', { value: o.id, selected: o.id === value }, o.label)));
  select.addEventListener('change', () => onChange(select.value));
  return el('label', { class: 'switch-row', for: id },
    el('span', { class: 't-subhead set-text' }, label, el('small', { class: 't-caption' }, note)), select);
}

function vizRows() {
  const supported = vizSupported();
  const modes = availableModes(vizCaps());
  return [
    vizSelect({
      id: 'viz-mode-select',
      label: 'Visualizer mode',
      note: 'Press M on the Playback screen or in full screen to cycle.',
      options: modes,
      value: vizMode(),
      disabled: !supported,
      onChange: setVizMode,
    }),
    ...(modes.some((m) => m.id === 'terrain') ? [vizSelect({
      id: 'viz-terrain-style-select',
      label: 'Terrain style',
      note: 'How the terrain follows the music. Press T while Terrain is shown to cycle.',
      options: TERRAIN_STYLES,
      value: getStyle(),
      disabled: !supported,
      onChange: setStyle,
    })] : []),
    vizSelect({
      id: 'viz-height-select',
      label: 'Visualizer height',
      note: 'How much of the screen the visualizer fills.',
      options: HEIGHT_OPTIONS,
      value: vizHeightId(),
      disabled: !supported,
      onChange: setVizHeight,
    }),
  ];
}

export function renderSettings(root) {
  if (isGuest()) {
    root.append(pageHead('Settings', `You are viewing ${ownerLabel()}'s library.`), el('div', { class: 'settings-grid' }, accountCard()));
    return null;
  }
  let card = libraryCard();
  const unsub = store.subscribe(() => { const next = libraryCard(); card.replaceWith(next); card = next; });
  root.append(pageHead('Settings', 'Your library and storage on this server.'), el('div', { class: 'settings-grid' },
    el('div', { class: 'settings-col' }, accountCard(), ...(auth.email ? [card, bpmCard(), metadataCard(), downloadAllCard()] : [])),
    el('div', { class: 'settings-col' }, playbackCard(), visualizerCard())));
  return unsub;
}
