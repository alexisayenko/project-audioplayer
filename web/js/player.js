import { api } from './api.js';
import { store } from './store.js';
import { fmtTime, toast } from './dom.js';

const audio = document.getElementById('audio');
const $ = (id) => document.getElementById(id);

const PLAY = '▶';
const PAUSE = '⏸';

let queue = [];
let index = -1;
let scrubbing = false;
const listeners = new Set();

export const player = {
  get current() { return queue[index] ? store.get(queue[index]) || null : null; },
  get playing() { return !audio.paused; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  playQueue(ids, startId) {
    queue = [...ids];
    index = Math.max(0, queue.indexOf(startId));
    load(true);
  },

  toggle() {
    if (!player.current) return;
    if (audio.paused) audio.play().catch(fail); else audio.pause();
  },

  next() {
    if (index + 1 < queue.length) { index += 1; load(true); }
  },

  prev() {
    if (audio.currentTime > 3 || index === 0) { audio.currentTime = 0; return; }
    index -= 1;
    load(true);
  },

  seek(t) { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(t, audio.duration)); },
};

function fail() { toast('Cannot play this song'); }

function load(autoplay) {
  const song = player.current;
  if (!song) return;
  audio.src = api.fileUrl(song.id);
  if (autoplay) audio.play().catch(fail);
  updateMediaSession(song);
  render();
}

function setCover(img, song) {
  const src = song && song.cover ? api.coverUrl(song.id) : '';
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  if (src) img.src = src; else img.removeAttribute('src');
}

function render() {
  const song = player.current;
  document.body.classList.toggle('has-mini', !!song);
  $('mini').hidden = !song;
  if (!song) return;
  const sym = audio.paused ? PLAY : PAUSE;
  $('mini-play').textContent = sym;
  $('p-play').textContent = sym;
  $('mini-title').textContent = song.title;
  $('mini-artist').textContent = song.artist || '';
  $('player-title').textContent = song.title;
  $('player-artist').textContent = song.artist || '';
  setCover($('mini-cover'), song);
  setCover($('player-cover'), song);
  $('p-prev').disabled = false;
  $('p-next').disabled = index + 1 >= queue.length;
  $('mini-next').disabled = $('p-next').disabled;
  $('queue-info').textContent = `${index + 1} of ${queue.length} in queue`;
  document.title = `${song.title} - Audio Player`;
  listeners.forEach((fn) => fn());
}

function renderProgress() {
  const dur = audio.duration;
  const cur = audio.currentTime;
  const frac = Number.isFinite(dur) && dur > 0 ? cur / dur : 0;
  $('mini-bar').style.width = `${frac * 100}%`;
  $('t-dur').textContent = fmtTime(dur);
  if (!scrubbing) {
    $('scrub').value = Math.round(frac * 1000);
    $('t-cur').textContent = fmtTime(cur);
  }
  if ('mediaSession' in navigator && Number.isFinite(dur) && dur > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(cur, dur), playbackRate: audio.playbackRate });
    } catch { /* unsupported state */ }
  }
}

function updateMediaSession(song) {
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

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* unsupported */ } };
  set('play', () => audio.play().catch(fail));
  set('pause', () => audio.pause());
  set('previoustrack', () => player.prev());
  set('nexttrack', () => player.next());
  set('seekto', (d) => player.seek(d.seekTime));
  set('seekbackward', (d) => player.seek(audio.currentTime - (d.seekOffset || 10)));
  set('seekforward', (d) => player.seek(audio.currentTime + (d.seekOffset || 10)));
}

export function initPlayer() {
  setupMediaSession();
  audio.addEventListener('play', render);
  audio.addEventListener('pause', render);
  audio.addEventListener('timeupdate', renderProgress);
  audio.addEventListener('durationchange', renderProgress);
  audio.addEventListener('ended', () => { if (index + 1 < queue.length) player.next(); else render(); });
  audio.addEventListener('error', () => { if (audio.src) fail(); });

  $('mini-play').addEventListener('click', () => player.toggle());
  $('mini-next').addEventListener('click', () => player.next());
  $('p-play').addEventListener('click', () => player.toggle());
  $('p-next').addEventListener('click', () => player.next());
  $('p-prev').addEventListener('click', () => player.prev());
  $('mini-open').addEventListener('click', () => { $('player').hidden = false; });
  $('player-close').addEventListener('click', () => { $('player').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('player').hidden) $('player').hidden = true;
  });

  const scrub = $('scrub');
  scrub.addEventListener('input', () => {
    scrubbing = true;
    $('t-cur').textContent = fmtTime((scrub.value / 1000) * (audio.duration || 0));
  });
  scrub.addEventListener('change', () => {
    player.seek((scrub.value / 1000) * (audio.duration || 0));
    scrubbing = false;
  });

  for (const id of ['mini-cover', 'player-cover']) {
    $(id).addEventListener('error', () => { $(id).removeAttribute('src'); $(id).dataset.src = ''; });
  }

  store.subscribe(() => {
    if (queue[index] && !store.get(queue[index])) {
      audio.pause();
      audio.removeAttribute('src');
      queue = [];
      index = -1;
      $('player').hidden = true;
    }
    render();
  });
}
