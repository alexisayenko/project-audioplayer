import { store } from './store.js';
import { artistLine } from './credits.js';
import { player } from './player.js';
import { el, toast, fmtTime } from './dom.js';
import { hasAudio } from './playable.js';
import { streamable } from './guest.js';
import { storeGet, storeSet, storeRemove } from './storage.js';
import { MODE_STORAGE_KEY } from './viz-modes.js';
import { STYLE_STORAGE_KEY, setStyle } from './viz-terrain-style.js';
import { setVizMode } from './viz-settings.js';
import { FLIGHT_KEY, setFlightOn } from './viz-flight.js';
import { setCam } from './viz-cam-debug.js';
import { openSongCard } from './song-card.js';
import { clampT } from './share.js';

const NOT_AVAILABLE = 'This song is not available';
const NO_AUDIO = 'No audio on the server yet';
const NO_GUEST_AUDIO = 'Audio is not available in the guest view';
const memoryOnly = { setItem() {} };

let host = { openFull: () => {} };
let gate = null;

export function setShareHost(next) { host = { ...host, ...next }; }

function keepStored(key, fn) {
  const prev = storeGet(key);
  fn();
  if (prev === null) storeRemove(key); else storeSet(key, prev);
}

export function applyVizOverrides(share) {
  if (share.viz) keepStored(MODE_STORAGE_KEY, () => setVizMode(share.viz));
  if (share.style) keepStored(STYLE_STORAGE_KEY, () => setStyle(share.style));
  if (share.cam) setCam(share.cam, memoryOnly);
  if (share.fl) keepStored(FLIGHT_KEY, () => setFlightOn(true));
}

export function closeGate() {
  if (!gate) return;
  gate.node.remove();
  document.removeEventListener('keydown', gate.onKey, true);
  gate = null;
}

function seekWhenReady(audio, t) {
  if (!(t > 0)) return;
  const go = () => player.seek(clampT(t, audio.duration));
  if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
}

function start(song, share) {
  const audio = document.getElementById('audio');
  if (share.fs) host.openFull();
  player.playNow(song.id);
  seekWhenReady(audio, share.t);
}

export function showGate(song, share) {
  closeGate();
  const label = share.t > 0 ? `Tap to play at ${fmtTime(share.t)}` : 'Tap to play';
  const go = el('button', { class: 'btn primary glow share-go', type: 'button' }, label);
  const skip = el('button', { class: 'link-btn t-subhead', type: 'button' }, 'Not now');
  const node = el('div', { class: 'share-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shared song' },
    el('div', { class: 'share-gate-card' },
      el('p', { class: 't-eyebrow' }, 'SHARED WITH YOU'),
      el('h2', { class: 't-title' }, song.title),
      artistLine(song) ? el('p', { class: 'muted t-subhead' }, artistLine(song)) : null,
      go, skip));
  go.addEventListener('click', () => { closeGate(); start(song, share); });
  skip.addEventListener('click', closeGate);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeGate(); return; }
    if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === go ? skip : go).focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(node);
  gate = { node, onKey };
  go.focus();
}

export function openShared(share) {
  closeGate();
  const song = share && share !== 'bad' ? store.get(share.id) : null;
  if (!song) { toast(NOT_AVAILABLE); return false; }
  applyVizOverrides(share);
  if (!hasAudio(song) || !streamable()) {
    toast(hasAudio(song) ? NO_GUEST_AUDIO : NO_AUDIO);
    openSongCard(song);
    return false;
  }
  location.hash = '#/playback';
  showGate(song, share);
  return true;
}
