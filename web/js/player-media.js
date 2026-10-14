import { api } from './api.js';
import { storeGet, storeSet } from './storage.js';
import { $ } from './player-ui.js';

const VOLUME_KEY = 'ap2.volume';

export function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  const artwork = song.cover
    ? [{ src: new URL(api.coverUrl(song.id), location.href).href, sizes: '480x360', type: 'image/jpeg' }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist || '',
    album: song.album || '',
    artwork,
  });
}

export function setupMediaSession(handlers) {
  if (!('mediaSession' in navigator)) return;
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* unsupported */ } };
  for (const [name, fn] of Object.entries(handlers)) set(name, fn);
}

export function updatePositionState(audio) {
  const dur = audio.duration;
  if ('mediaSession' in navigator && Number.isFinite(dur) && dur > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(audio.currentTime, dur), playbackRate: audio.playbackRate });
    } catch { /* unsupported state */ }
  }
}

export function setVolume(audio, v, save = true) {
  const vol = Math.max(0, Math.min(1, v));
  audio.volume = vol;
  for (const id of ['p-volume', 'mini-volume']) {
    $(id).value = Math.round(vol * 100);
    $(id).style.setProperty('--p', vol.toFixed(3));
  }
  $('p-volume-pct').textContent = `${Math.round(vol * 100)}%`;
  $('p-knob').style.setProperty('--vol', vol.toFixed(3));
  if (save) storeSet(VOLUME_KEY, String(vol));
}

export function storedVolume() {
  const v = Number.parseFloat(storeGet(VOLUME_KEY));
  return Number.isFinite(v) ? v : 1;
}
