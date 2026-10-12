import { api } from './api.js';
import { store } from './store.js';
import { el, fmtTime, toast } from './dom.js';

const audio = document.getElementById('audio');
const $ = (id) => document.getElementById(id);

const PLAY = '▶';
const PAUSE = '⏸';

const QUEUE_KEY = 'ap2.queue';

let queue = [];
let index = -1;
let scrubbing = false;
let pendingRestore = false;
const listeners = new Set();

function saveQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify({ ids: queue, index })); } catch { /* storage unavailable */ }
}

function restoreQueue() {
  try {
    const data = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null');
    if (data && Array.isArray(data.ids) && data.ids.every((x) => typeof x === 'string')) {
      queue = [...new Set(data.ids)];
      index = Number.isInteger(data.index) && data.index >= 0 && data.index < queue.length ? data.index : (queue.length ? 0 : -1);
      pendingRestore = queue.length > 0;
    }
  } catch { /* corrupt or unavailable: start empty */ }
}

export const player = {
  get current() { return queue[index] ? store.get(queue[index]) || null : null; },
  get playing() { return !audio.paused; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  playNow(id) {
    const at = queue.indexOf(id);
    if (at >= 0) {
      queue.splice(at, 1);
      if (at <= index) index -= 1;
    }
    index += 1;
    queue.splice(index, 0, id);
    saveQueue();
    load(true);
  },

  add(id) {
    if (queue.includes(id)) return 'duplicate';
    queue.push(id);
    if (index < 0) {
      index = 0;
      saveQueue();
      load(false);
      return 'queued';
    }
    saveQueue();
    render();
    return 'added';
  },

  removeAt(i) {
    if (i <= index || i >= queue.length) return;
    queue.splice(i, 1);
    saveQueue();
    render();
  },

  move(i, delta) {
    const j = i + delta;
    if (i <= index || j <= index || j >= queue.length) return;
    [queue[i], queue[j]] = [queue[j], queue[i]];
    saveQueue();
    render();
  },

  clearUpcoming() {
    queue = queue.slice(0, index + 1);
    saveQueue();
    render();
  },

  toggle() {
    if (!player.current) return;
    if (audio.paused) audio.play().catch(fail); else audio.pause();
  },

  next() {
    if (index + 1 < queue.length) { index += 1; saveQueue(); load(true); }
  },

  prev() {
    if (audio.currentTime > 3 || index === 0) { audio.currentTime = 0; return; }
    index -= 1;
    saveQueue();
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
  $('player').classList.toggle('idle', !song);
  $('player-empty').hidden = !!song;
  const count = $('nav-count');
  count.hidden = !queue.length;
  count.textContent = queue.length;
  if (!song) { document.title = 'Audio Player'; renderQueue(); return; }
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
  renderQueue();
  document.title = `${song.title} - Audio Player`;
  listeners.forEach((fn) => fn());
}

function renderQueue() {
  const upcoming = queue.slice(index + 1);
  $('queue-clear').hidden = !upcoming.length;
  $('queue-empty').hidden = upcoming.length > 0;
  $('queue-list').replaceChildren(...upcoming.map((id, k) => {
    const i = index + 1 + k;
    const s = store.get(id);
    const btn = (label, text, fn, off) => el('button', {
      class: 'icon', type: 'button', title: label, 'aria-label': `${label}: ${s ? s.title : id}`, disabled: off, onclick: fn,
    }, text);
    return el('li', { class: 'queue-item' },
      el('span', { class: 'q-name' }, el('b', {}, s ? s.title : id), el('small', {}, s && s.artist ? s.artist : '')),
      btn('Move up', '↑', () => player.move(i, -1), i - 1 <= index),
      btn('Move down', '↓', () => player.move(i, 1), i + 1 >= queue.length),
      btn('Remove', '✕', () => player.removeAt(i)));
  }));
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
  $('mini-open').addEventListener('click', () => { location.hash = '#/playback'; });
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !player.current) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button, a, dialog, [contenteditable]')) return;
    e.preventDefault();
    player.toggle();
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

  $('queue-clear').addEventListener('click', () => player.clearUpcoming());
  restoreQueue();

  store.subscribe(() => {
    const curId = queue[index];
    const curGone = curId !== undefined && !store.get(curId);
    const kept = queue.filter((id) => store.get(id));
    if (kept.length !== queue.length) {
      const before = queue.slice(0, index).filter((id) => store.get(id)).length;
      queue = kept;
      index = kept.length ? Math.min(before, kept.length - 1) : -1;
      saveQueue();
      if (curGone) {
        audio.pause();
        audio.removeAttribute('src');
        if (index >= 0) pendingRestore = true;
      }
    }
    if (pendingRestore && player.current) {
      pendingRestore = false;
      load(false);
      return;
    }
    render();
  });
}
