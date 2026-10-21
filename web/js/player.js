import { api } from './api.js';
import { store } from './store.js';
import { hasAudio } from './playable.js';
import { el, toast, plural } from './dom.js';
import { icon } from './icons.js';
import * as Q from './queue-logic.js';
import { visibleTags, tagChip, tagText } from './tagname.js';
import { closeMenu, initMenus } from './menu.js';
import { downloadSong } from './download.js';
import { autodl, autoDownloadOn } from './autodl.js';
import { attachScrubber } from './scrubber.js';
import { storeGet, storeSet } from './storage.js';
import { paintCover, currentCoverModel, paintQueueCovers } from './row-cover.js';
import { $, setIcon, setToggle, setCover, queueRow, updateDl, paintTimes, initMiniCompact } from './player-ui.js';
import { updateMediaSession, setupMediaSession, updatePositionState, setVolume, storedVolume } from './player-media.js';
import { canSetVolume } from './volume-logic.js';
import { attachDockWheel } from './dock-wheel.js';
import { titleLine, tooltipLine, artistLine, subtitle, titleNodes } from './credits.js';
import { marquee, disposeAll } from './marquee.js';
import { can, isGuest } from './guest.js';
import { createPlayRecorder } from './play-recorder.js';
import { createQueueFollow } from './queue-follow.js';
import { createMediaRetry } from './media-retry.js';
import { openSongCard, openTagPicker, loadUi } from './lazy-ui.js';
import { createLoop } from './loop-engine.js';
import { createGapless } from './gapless-loop.js';
import { initLoopChip } from './loop-chip.js';

const audio = document.getElementById('audio');
const loop = createLoop(audio, undefined, createGapless({ audio }));
const retry = createMediaRetry({ audio, onChange: () => { paintConn(); render(true); }, onGone: () => fail() });
const shownPlaying = () => !audio.paused && !retry.stalled();
let followQueue = null;

const REPEAT_NEXT = { off: 'all', all: 'one' };
const REPEAT_LABEL = { one: 'one song', all: 'whole list' };

const QUEUE_KEY = 'ap2.queue';
const SHUFFLE_KEY = 'ap2.shuffle';
const REPEAT_KEY = 'ap2.repeat';

let qs = Q.emptyState();
let shuffle = false;
let repeat = 'off';
let played = [];
let history = [];
let volumeOk = true;
const scrubbers = [];
let pendingRestore = false;
let awaiting = null;
const listeners = new Set();

const ids = () => Q.queueIds(qs);
const canQueue = (song) => !!song && (hasAudio(song) || autoDownloadOn());
const usable = (item) => {
  const s = store.get(item.id);
  return hasAudio(s) || (!!s && autoDownloadOn() && autodl.view(item.id).kind !== 'failed');
};
const hasAudioId = (id) => hasAudio(store.get(id));
const logic = () => ({ queue: ids(), index: qs.index, shuffle, repeat, played });

function saveQueue() {
  storeSet(QUEUE_KEY, JSON.stringify(qs));
}

function savePrefs() {
  storeSet(SHUFFLE_KEY, shuffle ? '1' : '0');
  storeSet(REPEAT_KEY, repeat);
}

function restore() {
  try {
    qs = Q.parseSaved(JSON.parse(storeGet(QUEUE_KEY) || 'null'));
    pendingRestore = qs.items.length > 0;
    shuffle = storeGet(SHUFFLE_KEY) === '1';
    const r = storeGet(REPEAT_KEY);
    repeat = ['off', 'all', 'one'].includes(r) ? r : 'off';
  } catch { /* corrupt or unavailable: start empty */ }
}

function syncDownloads() {
  if (!autoDownloadOn()) return 0;
  autodl.prune(ids());
  const need = qs.items.slice(Math.max(qs.index, 0))
    .filter((it) => store.get(it.id) && !hasAudio(store.get(it.id)) && autodl.view(it.id).kind === 'none')
    .map((it) => it.id);
  return need.length ? autodl.request(need) : 0;
}

function commit(next) {
  const wasEmpty = qs.index < 0;
  qs = next;
  saveQueue();
  if (wasEmpty && qs.index >= 0) load(false); else render();
  syncDownloads();
}

function jumpTo(i, remember = true) {
  const cur = qs.items[qs.index];
  if (remember && shuffle && cur && i !== qs.index) history.push(cur.id);
  qs = { ...qs, index: i };
  saveQueue();
  load(true);
}

const qsSet = { for: null, ids: new Set() };

export const player = {
  loop,
  get current() { const it = qs.items[qs.index]; return it ? store.get(it.id) || null : null; },
  get currentId() { return qs.items[qs.index]?.id ?? null; },
  get playing() { return !audio.paused; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  playNow(id) {
    if (!canQueue(store.get(id))) return;
    qs = Q.playNow(qs, id);
    saveQueue();
    load(true);
  },

  playNext(id) {
    if (!canQueue(store.get(id))) return 'unavailable';
    const { state, result } = Q.playNext(qs, id);
    if (result === 'now') player.playNow(id);
    else if (result === 'next') commit(state);
    return result;
  },

  add(id) {
    if (!canQueue(store.get(id))) return 'unavailable';
    const { state, result } = Q.addManual(qs, id);
    commit(state);
    return result;
  },

  inQueue(id) {
    if (qsSet.for !== qs) { qsSet.for = qs; qsSet.ids = Q.queuedSet(qs); }
    return qsSet.ids.has(id);
  },

  queuePosition(id) {
    const i = qs.items.findIndex((it) => it.id === id);
    return i < 0 ? null : { pos: i + 1, total: qs.items.length };
  },

  toggleInPlaylist(id) {
    const i = qs.items.findIndex((it) => it.id === id);
    if (i >= 0) { player.removeAt(i); return 'removed'; }
    return player.add(id);
  },

  addTags(tags) {
    const { state, added } = Q.addTags(qs, tags, store.songs.filter(canQueue));
    commit(state);
    return added;
  },

  addListed(songs, tag) {
    const { state, added, already } = Q.addListed(qs, songs.filter(canQueue), tag);
    commit(state);
    return { added, already, fetching: pendingDownloads() };
  },

  playListed(songs, tags) {
    const playable = songs.filter(canQueue);
    const r = Q.playListed(qs, playable, tags, shuffle);
    if (!r.count) return { count: 0, skipped: songs.length, replaced: false };
    played = [];
    history = [];
    qs = r.state;
    saveQueue();
    load(true);
    syncDownloads();
    return { count: r.count, skipped: songs.length - playable.length, replaced: r.replaced, fetching: pendingDownloads() };
  },

  removeTag(tag) {
    const { state, removed } = Q.removeTags(qs, [tag]);
    commit(state);
    return removed;
  },

  clearUpcoming() {
    const { state, removed } = Q.clearUpcoming(qs);
    commit(state);
    return removed;
  },

  autoDownloadChanged() {
    if (autoDownloadOn()) {
      syncDownloads();
      const cur = player.current;
      if (cur && !hasAudio(cur)) autodl.request([cur.id], { front: true });
    } else {
      autodl.prune([]);
    }
    render();
  },

  removeAt(i) {
    const wasPlaying = !audio.paused;
    const { state, currentRemoved } = Q.removeItem(qs, i);
    if (state === qs) return;
    if (!currentRemoved) { commit(state); return; }
    qs = state;
    let k = qs.index;
    while (k >= 0 && k < qs.items.length && !usable(qs.items[k])) k += 1;
    if (k >= 0 && k < qs.items.length && k >= i) {
      qs = { ...qs, index: k };
      saveQueue();
      load(wasPlaying);
    } else {
      awaiting = null;
      pausePlayer();
      saveQueue();
      if (qs.index >= 0) load(false); else render();
    }
    syncDownloads();
  },
  move(i, delta) { commit(Q.moveItem(qs, i, delta)); },

  setShuffle(on) {
    shuffle = !!on;
    played = [];
    history = [];
    savePrefs();
    render();
  },

  toggleRepeat(target) {
    repeat = Q.toggleRepeat(repeat, target);
    savePrefs();
    render();
  },

  cycleRepeat() {
    repeat = REPEAT_NEXT[repeat] || 'off';
    savePrefs();
    render();
  },

  playAt(i) {
    if (i < 0 || i >= qs.items.length) return;
    if (i === qs.index) { player.toggle(); return; }
    jumpTo(i);
  },

  toggle() {
    const song = player.current;
    if (!song) return;
    if (!hasAudio(song)) { wantAudio(song); return; }
    if (retry.state === 'failed') { retry.retryNow(); return; }
    if (audio.paused) audio.play().catch(fail); else audio.pause();
  },

  peekNextId() {
    if (shuffle || !qs.items.length) return null;
    const step = Q.nextStep({ ...logic(), played }, false);
    const id = step ? qs.items[step.index]?.id : null;
    return id && id !== player.current?.id && hasAudioId(id) ? id : null;
  },

  next(auto = false) {
    if (!autoDownloadOn()) {
      const step = Q.nextPlayable({ ...logic(), played }, !auto, hasAudioId, false);
      if (!step) { toast(shuffle ? 'No downloaded songs to shuffle' : 'No more downloaded songs in the playlist'); render(); return; }
      played = step.played;
      if (step.index === qs.index) { audio.currentTime = 0; audio.play().catch(fail); render(); return; }
      skipNote(step.skipped);
      jumpTo(step.index);
      return;
    }
    let at = qs.index;
    let seen = played;
    let skipped = 0;
    for (let n = qs.items.length; n > 0; n--) {
      const step = Q.nextStep({ ...logic(), index: at, played: seen }, !auto);
      if (!step) break;
      seen = step.played;
      if (step.index === qs.index) { played = seen; audio.currentTime = 0; audio.play().catch(fail); render(); return; }
      if (usable(qs.items[step.index])) { played = seen; skipNote(skipped); jumpTo(step.index); return; }
      skipped += 1;
      at = step.index;
    }
    played = seen;
    skipNote(skipped);
    render();
  },

  prev() {
    const back = () => { audio.currentTime = 0; };
    if (audio.currentTime > 3) { back(); return; }
    if (!autoDownloadOn()) {
      const step = Q.prevPlayable({ ...logic(), history }, hasAudioId, false);
      if (!step) { back(); return; }
      history = step.history;
      skipNote(step.skipped);
      jumpTo(step.index, false);
      return;
    }
    let at = qs.index;
    let hist = history;
    let skipped = 0;
    for (let n = qs.items.length; n > 0; n--) {
      const step = Q.prevStep({ ...logic(), index: at, history: hist });
      if (!step) break;
      hist = step.history;
      if (usable(qs.items[step.index])) { history = hist; skipNote(skipped); jumpTo(step.index, false); return; }
      skipped += 1;
      at = step.index;
    }
    skipNote(skipped);
    back();
  },

  get shuffleOn() { return shuffle; },
  get repeatMode() { return repeat; },
  get position() { return audio.currentTime; },
  get duration() { return audio.duration; },
  play() { if (player.current && hasAudio(player.current) && audio.paused) audio.play().catch(fail); },
  get volume() { return audio.volume; },
  get muted() { return audio.muted; },
  get volumeAdjustable() { return volumeOk; },
  setVolume(v) {
    setVolume(audio, v);
    if (audio.muted && v > 0) audio.muted = false;
  },
  toggleMute() {
    if (audio.muted || audio.volume === 0) {
      audio.muted = false;
      if (audio.volume === 0) setVolume(audio, 0.5);
    } else {
      audio.muted = true;
    }
  },

  seek(t) { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(t, audio.duration)); },
};

function paintConn() {
  const host = $('mini-conn');
  if (!host) return;
  host.hidden = retry.state === 'ok';
  if (host.hidden) { host.replaceChildren(); return; }
  if (retry.state === 'reconnecting') { host.replaceChildren('Reconnecting...'); return; }
  const btn = el('button', { class: 'conn-retry', type: 'button' }, 'Retry');
  btn.addEventListener('click', () => retry.retryNow());
  host.replaceChildren('Cannot reach the server. ', btn);
}

function fail() { toast('Cannot play this song'); }

function skipNote(n) {
  if (n) toast(autoDownloadOn() ? `Skipped ${n} ${plural(n, 'song', 'songs')} without audio` : `Skipped ${n} not downloaded`);
}

function pendingDownloads() {
  return qs.items.filter((it) => autodl.view(it.id).kind !== 'none').length;
}

function wantAudio(song) {
  awaiting = song.id;
  if (autoDownloadOn()) {
    autodl.request([song.id], { front: true });
    return;
  }
  toast('Not downloaded');
}

function startDownload(song) {
  awaiting = song.id;
  const k = autodl.view(song.id).kind;
  if (k === 'failed') autodl.retry(song.id);
  else autodl.request([song.id], { front: true });
}

function load(autoplay) {
  const song = player.current;
  retry.reset();
  loop.clear();
  if (!song) return;
  updateMediaSession(song);
  if (!hasAudio(song)) {
    audio.pause();
    audio.removeAttribute('src');
    awaiting = autoplay ? song.id : null;
    if (autoDownloadOn()) autodl.request([song.id], { front: true });
    render();
    return;
  }
  awaiting = null;
  audio.src = api.fileUrl(song.id);
  if (autoplay) audio.play().catch(fail);
  render();
}

let servicesSeq = 0;
function paintServices(song) {
  const seq = ++servicesSeq;
  if (!song) {
    const host = $('p-svc');
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  loadUi('actions').then((m) => { if (seq === servicesSeq) m.paintServiceButtons($('p-svc'), song); }, () => {});
}

function renderTransport(song, playing) {
  const label = playing ? 'Pause' : 'Play';
  $('mini').hidden = !song;
  $('player').classList.toggle('idle', !song);
  $('player-empty').hidden = !!song;
  $('details-body').hidden = !song;
  $('cover-text').hidden = !song;
  $('p-view').hidden = !song;
  paintServices(song);
  $('p-download').hidden = !hasAudio(song) || !can('download');
  setIcon('mini-play', playing ? 'pause' : 'play', 'action');
  const cover = $('cover-toggle');
  cover.hidden = !song;
  const cm = currentCoverModel(playing);
  const name = song ? titleLine(song) : '';
  paintCover(cover, cm, name, { size: 28, extra: 'cover-btn' });
  paintCover($('mini-cover-btn'), cm, name, { size: 27 });
  $('mini-play').setAttribute('aria-label', label);
}

function renderIdle() {
  document.title = 'Electrophone';
  for (const id of ['mini-prev', 'mini-next']) $(id).disabled = true;
  $('player-cover').removeAttribute('src');
  $('player-cover').dataset.src = '';
  $('cover-art').classList.add('noart');
  renderProgress();
  $('player-dl').hidden = true;
  renderQueue();
  followQueue?.(null, -1);
  listeners.forEach((fn) => fn());
}

function renderMini(song) {
  const noNext = !Q.hasNext(logic());
  for (const id of ['mini-prev', 'mini-play']) $(id).disabled = false;
  $('mini-next').disabled = noNext;
  $('mini-title').replaceChildren(...titleNodes(song));
  $('mini-title').title = tooltipLine(song);
  marquee($('mini-title'), { auto: true });
  $('mini-artist').textContent = artistLine(song);
}

function renderDetails(song) {
  $('player-title').replaceChildren(...titleNodes(song));
  $('player-title').title = tooltipLine(song);
  marquee($('player-title'), { auto: true });
  $('player-sub').textContent = subtitle(song);
  $('player-tags').replaceChildren(...visibleTags(song.tags).map(tagChip));
  const bpm = song.bpm != null ? Math.round(song.bpm) : null;
  $('player-bpm').replaceChildren(...(bpm == null ? [] : [el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)', 'aria-label': `BPM ${bpm}` }, `${bpm} `, el('small', { 'aria-hidden': 'true' }, 'BPM'))]));
  updateDl(player.current);
  setCover($('mini-cover'), song);
  setCover($('player-cover'), song);
  $('cover-art').classList.toggle('noart', !song.cover);
}

function render(coversOnly = false) {
  const song = player.current;
  const n = qs.items.length;
  document.body.classList.toggle('has-mini', !!song);
  renderTransport(song, shownPlaying());
  $('queue-count').textContent = n ? `${n} ${plural(n, 'song', 'songs')}` : '';
  renderPlaylistControls();
  if (!song) {
    renderIdle();
    return;
  }
  renderMini(song);
  renderDetails(song);
  if (coversOnly) paintQueueCovers($('queue-list'), qs.index, shownPlaying(), (row) => row.querySelector('.row-cover').dataset.title);
  else renderQueue();
  followQueue ||= createQueueFollow($('queue-list'));
  followQueue(song.id, qs.index);
  document.title = `${titleLine(song)} - Electrophone`;
  renderProgress();
  listeners.forEach((fn) => fn());
}

function renderPlaylistControls() {
  setToggle(['mini-shuffle'], shuffle, `Shuffle: ${shuffle ? 'on' : 'off'}`);
  setToggle(['mini-repeat'], repeat !== 'off', `Repeat: ${REPEAT_LABEL[repeat] || 'off'}`, repeat === 'one' ? 'repeatOne' : 'repeat');
  const nothing = !Q.upcomingCount(qs) && !qs.tags.length;
  $('queue-clear').disabled = nothing;
  $('queue-clear').title = nothing ? 'Nothing upcoming to clear' : 'Remove the upcoming songs and tag chips';
  $('fill-tags').replaceChildren(...qs.tags.map((t) => el('span', { class: 'chip tint', title: t },
    tagText(t),
    el('button', {
      class: 'x', type: 'button', title: `Remove tag: ${t}`, 'aria-label': `Remove tag: ${t}`,
      onclick: () => { const n = player.removeTag(t); toast(n ? `Removed ${n} ${plural(n, 'song', 'songs')}` : 'Tag removed'); },
    }, icon('clear', 'inline')))));
}

const queueCtx = () => ({
  count: qs.items.length,
  index: qs.index,
  move: (i, d) => player.move(i, d),
  removeAt: (i) => player.removeAt(i),
  playAt: (i) => player.playAt(i),
  openCard: (song, opener) => { void openSongCard(song, opener); },
  playing: shownPlaying(),
});

function renderQueue() {
  closeMenu();
  $('queue-empty').hidden = qs.items.length > 0;
  disposeAll($('queue-list'));
  const focused = document.activeElement?.closest?.('#queue-list .row-cover') ? [...$('queue-list').children].indexOf(document.activeElement.closest('li')) : -1;
  $('queue-list').replaceChildren(...qs.items.map((item, i) => queueRow(item, i, queueCtx())));
  if (focused >= 0) $('queue-list').children[focused]?.querySelector('.row-cover')?.focus();
  updateDl(player.current);
}

const isScrubbing = () => scrubbers.some((x) => x.dragging);

function previewTime(t) {
  if (t != null) paintTimes(t, audio.duration);
}

function renderProgress() {
  const dur = audio.duration;
  const cur = audio.currentTime;
  for (const x of scrubbers) x.sync();
  if (!isScrubbing()) paintTimes(cur, dur);
  updatePositionState(audio);
}

export function initPlayer() {
  setupMediaSession({
    play: () => audio.play().catch(fail),
    pause: () => audio.pause(),
    previoustrack: () => player.prev(),
    nexttrack: () => player.next(),
    seekto: (d) => player.seek(d.seekTime),
    seekbackward: (d) => player.seek(audio.currentTime - (d.seekOffset || 10)),
    seekforward: (d) => player.seek(audio.currentTime + (d.seekOffset || 10)),
  });
  initMenus();
  audio.addEventListener('play', () => render(true));
  audio.addEventListener('pause', () => render(true));
  audio.addEventListener('timeupdate', renderProgress);
  audio.addEventListener('durationchange', renderProgress);
  audio.addEventListener('ended', () => { window.dispatchEvent(new Event('song-ended')); if (!loop.onEnded()) player.next(true); });
  initLoopChip($('mini-loop'), loop);
  const recorder = createPlayRecorder({
    audio,
    getSongId: () => player.currentId,
    canRecord: () => !isGuest(),
    post: (batch, opts) => api.postPlays(batch, !!opts?.keepalive),
    onFlushed: () => window.dispatchEvent(new Event('plays-flushed')),
  });
  listeners.add(() => recorder.sync());

  initMiniCompact();
  setIcon('mini-prev', 'prev', 'action');
  setIcon('mini-next', 'next', 'action');
  setIcon('mini-shuffle', 'shuffle', 'action');
  setIcon('p-view', 'info', 'nav');
  setIcon('p-download', 'download', 'nav');
  for (const id of ['cover-toggle', 'mini-cover-btn']) $(id).addEventListener('click', () => player.toggle());
  $('player-dl-btn').addEventListener('click', () => { if (player.current) startDownload(player.current); });
  autodl.onChange(() => {
    const cur = player.current;
    if (awaiting && cur && awaiting === cur.id && !hasAudio(cur) && autodl.view(cur.id).kind === 'failed') {
      awaiting = null;
      toast(`Could not download "${cur.title}"`);
      player.next();
    }
    updateDl(player.current);
  });
  $('p-download').addEventListener('click', () => { if (player.current) downloadSong(player.current); });

  $('mini-play').addEventListener('click', () => player.toggle());
  $('mini-next').addEventListener('click', () => player.next());
  $('mini-prev').addEventListener('click', () => player.prev());
  $('mini-shuffle').addEventListener('click', () => player.setShuffle(!shuffle));
  $('mini-repeat').addEventListener('click', () => player.cycleRepeat());
  $('tag-add').addEventListener('click', (e) => openTagPicker(player, () => qs.tags, e.currentTarget));
  $('queue-clear').addEventListener('click', () => {
    const n = player.clearUpcoming();
    toast(n ? `Cleared ${n} ${plural(n, 'song', 'songs')}` : 'Tag chips cleared');
  });
  const miniOpen = $('mini-open');
  miniOpen.setAttribute('aria-label', 'Song info');
  miniOpen.addEventListener('click', () => { if (player.current) openSongCard(player.current, miniOpen); });
  $('p-view').addEventListener('click', () => { if (player.current) openSongCard(player.current, $('p-view')); });

  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !player.current) return;
    if (e.target.closest?.('input, textarea, select, button, a, dialog, [contenteditable]')) return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(audio.currentTime - 5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(audio.currentTime + 5); }
  });
  $('queue-list').addEventListener('scroll', closeMenu);

  scrubbers.push(attachScrubber($('mini-scrub'), {
    duration: () => audio.duration,
    time: () => audio.currentTime,
    onSeek: (t) => { player.seek(t); renderProgress(); },
    onPreview: previewTime,
  }));

  volumeOk = canSetVolume(audio);
  document.body.classList.toggle('vol-readonly', !volumeOk);
  setVolume(audio, storedVolume(), false);
  $('mini-volume').addEventListener('input', (e) => player.setVolume(e.target.value / 100));
  attachDockWheel($('mini'), { player, note: $('mini-vol-note'), pct: $('mini-vol-pct'), sr: $('mini-vol-sr') });

  for (const id of ['mini-cover', 'player-cover']) {
    $(id).addEventListener('error', () => { $(id).removeAttribute('src'); $(id).dataset.src = ''; });
  }

  restore();

  store.subscribe(() => {
    const { state, curGone } = Q.syncLibrary(qs, (id) => !!store.get(id));
    if (state !== qs) {
      qs = state;
      saveQueue();
      if (curGone) {
        audio.pause();
        audio.removeAttribute('src');
        if (qs.index >= 0) pendingRestore = true;
      }
    }
    if (pendingRestore && player.current) {
      pendingRestore = false;
      load(false);
      syncDownloads();
      return;
    }
    if (awaiting && player.current && player.current.id === awaiting && hasAudio(player.current)) {
      load(true);
      return;
    }
    render();
    syncDownloads();
  });
  render();
}

export function pausePlayer() {
  loop.clear();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
