import { api, auth, session } from './api.js';
import { setupProviders } from './signin.js';
import { usageText } from './limits.js';
import { store } from './store.js';
import { player } from './player.js';
import { autoDownloadOn, setAutoDownload } from './autodl.js';
import { el, pageHead } from './dom.js';
import { describeSync } from './sync-status.js';
import { isGuest, ownerLabel } from './guest.js';
import { downloadAllRow } from './bulk-download.js';
import { bpmCard, metadataCard } from './backfill-card.js';
import { duplicatesCard } from './duplicates-tool.js';
import { isSupported as vizSupported } from './audio-graph.js';
import {
  vizCaps, vizMode, setVizMode, vizHeightId, setVizHeight,
} from './viz-settings.js';
import { availableModes } from './viz-modes.js';
import { TERRAIN_STYLES, getStyle, setStyle } from './viz-terrain-style.js';
import { HEIGHT_OPTIONS } from './viz-constants.js';
import { FADE_MAX, FADE_STEP, fadeLabel, fadeHint } from './fade.js';
import { fadeSettings } from './fade-settings.js';

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

function accountCard() {
  return el('section', { class: 'card' }, el('h2', { class: 't-headline' }, 'Account'), accountSection());
}

function libraryCard(tools) {
  const songs = store.songs.length;
  const secs = store.songs.reduce((n, s) => n + (s.duration || 0), 0);
  const hours = secs >= 3600 ? `${(secs / 3600).toFixed(1)} h of music` : `${Math.round(secs / 60)} min of music`;
  const meter = el('span', { class: 't-caption' }, '');
  api.usage().then((u) => { meter.textContent = usageText(u); }).catch(() => { meter.textContent = ''; });
  const sync = el('span', {}, 'Checking...');
  const paint = () => {
    const v = describeSync(store.sync);
    sync.textContent = '';
    if (v.level !== 'none') sync.append(el('span', { class: `sync-mark ${v.level}`, role: 'img', 'aria-label': v.label }, '!'), ' ');
    sync.append(v.text);
  };
  if (store.sync) paint();
  else {
    fetch('/health').then((r) => r.json()).then((h) => { store.sync = h.sync || 'ok'; paint(); })
      .catch(() => { sync.textContent = 'Server unreachable'; });
  }
  return el('section', { class: 'card' },
    el('h2', { class: 't-headline' }, 'Library'),
    el('div', { class: 'cell' },
      el('span', { class: 't-title' }, `${songs} ${songs === 1 ? 'song' : 'songs'}`),
      el('span', { class: 'muted t-caption' }, songs ? hours : '')),
    el('div', { class: 'divider' }),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Storage'), meter),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Sync'), el('span', { class: 't-caption' }, sync)),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Server'), el('span', { class: 't-caption' }, location.host)),
    ...tools.flatMap((row) => [el('div', { class: 'divider' }), row]));
}

function fadeRow({ id, label, get, set }) {
  const out = el('output', { for: id }, fadeLabel(get()));
  const hint = el('small', { class: 't-caption' });
  const range = el('input', { type: 'range', id, min: 0, max: FADE_MAX, step: FADE_STEP, value: get() });
  const paint = (v) => { out.textContent = fadeLabel(v); hint.textContent = fadeHint(v, player.duration); };
  paint(get());
  range.addEventListener('input', () => { set(range.value); paint(range.value); });
  return el('label', { class: 'switch-row', for: id },
    el('span', { class: 't-subhead set-text' }, label,
      el('small', { class: 't-caption' }, 'Share of the song length. Applied when a song starts or ends.'), hint),
    el('span', { class: 'fade-ctl' }, range, out));
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
        el('small', { class: 't-caption' }, 'Download songs you play or add to the queue. Each download counts toward the hourly add limit.')), box),
    fadeRow({ id: 'fade-in', label: 'Fade in', get: fadeSettings.fadeIn, set: fadeSettings.setFadeIn }),
    fadeRow({ id: 'fade-out', label: 'Fade out', get: fadeSettings.fadeOut, set: fadeSettings.setFadeOut }));
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
  const tools = auth.email ? [downloadAllRow(), metadataCard(), bpmCard(), duplicatesCard()] : [];
  let card = libraryCard(tools);
  const rebuild = () => { const next = libraryCard(tools); card.replaceWith(next); card = next; };
  const unsub = store.subscribe(rebuild);
  window.addEventListener('sync-changed', rebuild);
  root.append(pageHead('Settings', 'Your library and storage on this server.'), el('div', { class: 'settings-grid' },
    el('div', { class: 'settings-col' }, accountCard(), ...(auth.email ? [card] : [])),
    el('div', { class: 'settings-col' }, playbackCard(), visualizerCard())));
  return () => { unsub(); window.removeEventListener('sync-changed', rebuild); };
}
