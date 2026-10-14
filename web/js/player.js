import { api } from './api.js';
import { store } from './store.js';
import { hasAudio } from './playable.js';
import { el, fmtTime, toast, plural } from './dom.js';
import * as Q from './queue-logic.js';
import { visibleTags, tagChip, tagGroups, tagLabel, tagText } from './tagname.js';
import { songLinks } from './wiki-links.js';
import { icon } from './icons.js';
import { openMenu, closeMenu, initMenus } from './menu.js';
import { downloadSong } from './download.js';
import { autodl, autoDownloadOn } from './autodl.js';
import { editDialog, dialogHead } from './edit-dialog.js';
import { requestReveal } from './reveal.js';

const audio = document.getElementById('audio');
const $ = (id) => document.getElementById(id);

const REPEAT_NEXT = { off: 'all', all: 'one' };
const REPEAT_LABEL = { one: 'one song', all: 'whole list' };

function applyLabel(fresh, drop) {
  if (fresh) return `Add songs (${fresh} ${plural(fresh, 'tag', 'tags')})`;
  return drop ? 'Apply' : 'Add songs';
}

const QUEUE_KEY = 'ap2.queue';
const SHUFFLE_KEY = 'ap2.shuffle';
const REPEAT_KEY = 'ap2.repeat';
const VOLUME_KEY = 'ap2.volume';

const setIcon = (id, name, size) => $(id).replaceChildren(icon(name, size));

let qs = Q.emptyState();
let shuffle = false;
let repeat = 'off';
let played = [];
let history = [];
let scrubbing = false;
let pendingRestore = false;
let awaiting = null;
const listeners = new Set();

const ids = () => Q.queueIds(qs);
const canQueue = (song) => !!song && (hasAudio(song) || autoDownloadOn());
const usable = (item) => {
  const s = store.get(item.id);
  return hasAudio(s) || (!!s && autoDownloadOn() && autodl.view(item.id).kind !== 'failed');
};
const logic = () => ({ queue: ids(), index: qs.index, shuffle, repeat, played });

function saveQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(qs)); } catch { /* storage unavailable */ }
}

function savePrefs() {
  try {
    localStorage.setItem(SHUFFLE_KEY, shuffle ? '1' : '0');
    localStorage.setItem(REPEAT_KEY, repeat);
  } catch { /* storage unavailable */ }
}

function restore() {
  try {
    qs = Q.parseSaved(JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null'));
    pendingRestore = qs.items.length > 0;
    shuffle = localStorage.getItem(SHUFFLE_KEY) === '1';
    const r = localStorage.getItem(REPEAT_KEY);
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
  get current() { const it = qs.items[qs.index]; return it ? store.get(it.id) || null : null; },
  get playing() { return !audio.paused; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  playNow(id) {
    if (!canQueue(store.get(id))) return;
    qs = Q.playNow(qs, id);
    saveQueue();
    load(true);
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
    if (audio.paused) audio.play().catch(fail); else audio.pause();
  },

  next(auto = false) {
    let at = qs.index;
    let seen = played;
    let skipped = 0;
    for (let k = 0; k < qs.items.length; k += 1) {
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
    let at = qs.index;
    let hist = history;
    let skipped = 0;
    for (let k = 0; k < qs.items.length; k += 1) {
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

  seek(t) { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(t, audio.duration)); },
};

function fail() { toast('Cannot play this song'); }

function skipNote(n) {
  if (n) toast(`Skipped ${n} ${plural(n, 'song', 'songs')} without audio`);
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

function setCover(img, song) {
  const src = song?.cover ? api.coverUrl(song.id) : '';
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  if (src) img.src = src; else img.removeAttribute('src');
}

function render() {
  const song = player.current;
  const n = qs.items.length;
  document.body.classList.toggle('has-mini', !!song);
  $('mini').hidden = !song;
  $('player').classList.toggle('idle', !song);
  $('player-empty').hidden = !!song;
  $('details-body').hidden = !song;
  $('cover-text').hidden = !song;
  $('p-edit').hidden = !song;
  $('p-download').hidden = !hasAudio(song);
  $('queue-count').textContent = n ? `${n} ${plural(n, 'song', 'songs')}` : '';
  renderPlaylistControls();
  const playing = !audio.paused;
  setIcon('p-play', playing ? 'pause' : 'play', 22);
  setIcon('mini-play', playing ? 'pause' : 'play', 20);
  $('p-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const cover = $('cover-toggle');
  cover.hidden = !song;
  cover.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  cover.title = playing ? 'Pause' : 'Play';
  cover.classList.toggle('is-playing', playing);
  $('cover-icon').replaceChildren(icon(playing ? 'pause' : 'play', 44));
  $('mini-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (!song) {
    document.title = 'Electrophone';
    for (const id of ['p-prev', 'p-next', 'p-play', 'mini-prev', 'mini-next']) $(id).disabled = true;
    $('player-cover').removeAttribute('src');
    $('player-cover').dataset.src = '';
    $('cover-art').classList.add('noart');
    $('player-dl').hidden = true;
    renderQueue();
    listeners.forEach((fn) => fn());
    return;
  }
  const noNext = !Q.hasNext(logic());
  for (const id of ['p-prev', 'p-play', 'mini-prev']) $(id).disabled = false;
  $('p-next').disabled = noNext;
  $('mini-next').disabled = noNext;
  $('mini-title').textContent = song.title;
  const inList = player.inQueue(song.id);
  const pl = $('mini-playlist');
  pl.setAttribute('aria-pressed', String(inList));
  pl.classList.toggle('on', inList);
  pl.title = inList ? 'In playlist - click to remove' : 'Add to current playlist';
  pl.setAttribute('aria-label', pl.title);
  pl.replaceChildren(icon(inList ? 'listCheck' : 'listAdd', 18));
  $('mini-artist').textContent = song.artist || '';
  $('player-title').textContent = song.title;
  $('player-sub').textContent = [song.artist, song.album, song.year].filter(Boolean).join(' · ');
  const remixLine = [song.remixer ? `Remix: ${song.remixer}` : ''].filter(Boolean).join(' · ');
  if (remixLine) $('player-sub').textContent += ($('player-sub').textContent ? ' · ' : '') + remixLine;
  $('player-tags').replaceChildren(...visibleTags(song.tags).map(tagChip));
  $('player-bpm').textContent = song.bpm != null ? `${Math.round(song.bpm)} BPM` : '';
  $('player-links').replaceChildren(...songLinks(song).map((l) => el('a', { class: 'source t-caption', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label)));
  updateDl();
  setCover($('mini-cover'), song);
  setCover($('player-cover'), song);
  $('cover-art').classList.toggle('noart', !song.cover);
  renderQueue();
  document.title = `${song.title} - Electrophone`;
  listeners.forEach((fn) => fn());
}

function setToggle(ids, on, label, iconName) {
  for (const id of ids) {
    const b = $(id);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label);
    b.title = label;
    b.classList.toggle('on', on);
    if (iconName) b.replaceChildren(icon(iconName, id.startsWith('mini') ? 18 : 20));
  }
}

function renderPlaylistControls() {
  setToggle(['p-shuffle', 'mini-shuffle'], shuffle, `Shuffle: ${shuffle ? 'on' : 'off'}`);
  setToggle(['p-repeat', 'mini-repeat'], repeat !== 'off', `Repeat: ${REPEAT_LABEL[repeat] || 'off'}`, repeat === 'one' ? 'repeatOne' : 'repeat');
  const nothing = !Q.upcomingCount(qs) && !qs.tags.length;
  $('queue-clear').disabled = nothing;
  $('queue-clear').title = nothing ? 'Nothing upcoming to clear' : 'Remove the upcoming songs and tag chips';
  $('fill-tags').replaceChildren(...qs.tags.map((t) => el('span', { class: 'chip tint', title: t },
    tagText(t),
    el('button', {
      class: 'x', type: 'button', title: `Remove tag: ${t}`, 'aria-label': `Remove tag: ${t}`,
      onclick: () => { const n = player.removeTag(t); toast(n ? `Removed ${n} ${plural(n, 'song', 'songs')}` : 'Tag removed'); },
    }, '×'))));
}

function songRow(item, i) {
  const s = store.get(item.id);
  const cover = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s?.cover) cover.src = api.coverUrl(s.id);
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  const title = s ? s.title : item.id;
  const more = el('button', {
    class: 'more', type: 'button', title: 'Song menu', 'aria-label': `Song menu: ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, icon('more', 20));
  more.addEventListener('click', () => openMenu(more, [
    ...(s ? [{ label: 'Edit song', run: () => editDialog(s) }] : []),
    ...(hasAudio(s) ? [{ label: 'Download', run: () => downloadSong(s) }] : []),
    { label: 'Move up', disabled: i === 0, run: () => player.move(i, -1) },
    { label: 'Move down', disabled: i === qs.items.length - 1, run: () => player.move(i, 1) },
    { label: 'Remove', run: () => player.removeAt(i) },
  ]));
  return el('li', { class: `qrow${i === qs.index ? ' current' : ''}${s && !hasAudio(s) ? ' no-audio' : ''}`, 'aria-current': i === qs.index ? 'true' : null },
    el('span', { class: 'c-idx t-time' }, i + 1),
    cover,
    el('div', { class: 'info' },
      el('button', { class: 'open t-subhead', type: 'button', title: 'Play', onclick: () => player.playAt(i) }, title),
      s?.artist ? el('small', { class: 'sub t-caption' }, s.artist) : null,
      s && !hasAudio(s) ? el('small', { class: 'dl t-caption', 'data-dl': item.id }) : null),
    el('span', { class: 'c-dur t-time' }, s?.duration ? fmtTime(s.duration) : ''),
    more);
}

function openTagPicker() {
  const dlg = document.getElementById('edit-dialog');
  const chosen = new Set(qs.tags.map((t) => t.toLocaleLowerCase()));
  const groups = tagGroups(store.tags);
  const apply = el('button', { type: 'button', class: 'btn primary glow' }, 'Add songs');
  const refresh = () => {
    const fresh = [...chosen].filter((c) => !qs.tags.some((t) => t.toLocaleLowerCase() === c));
    const drop = qs.tags.filter((t) => !chosen.has(t.toLocaleLowerCase()));
    apply.disabled = !fresh.length && !drop.length;
    apply.textContent = applyLabel(fresh.length, drop.length);
  };
  const chip = (t) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', title: t.tag },
      tagLabel(t.tag), el('small', {}, t.count));
    const sync = () => {
      const on = chosen.has(t.tag.toLocaleLowerCase());
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    b.addEventListener('click', () => {
      const k = t.tag.toLocaleLowerCase();
      if (chosen.has(k)) chosen.delete(k); else chosen.add(k);
      sync();
      refresh();
    });
    sync();
    return b;
  };
  apply.addEventListener('click', () => {
    const fresh = store.tags.filter((t) => chosen.has(t.tag.toLocaleLowerCase()) && !qs.tags.some((x) => x.toLocaleLowerCase() === t.tag.toLocaleLowerCase()));
    const drop = qs.tags.filter((t) => !chosen.has(t.toLocaleLowerCase()));
    dlg.close();
    let removed = 0;
    for (const t of drop) removed += player.removeTag(t);
    let added = 0;
    if (fresh.length) added = player.addTags(fresh.map((t) => t.tag));
    const parts = [];
    if (fresh.length) parts.push(`Added ${added} ${added === 1 ? 'song' : 'songs'}`);
    if (drop.length) parts.push(`removed ${removed} ${removed === 1 ? 'song' : 'songs'}`);
    toast(parts.join(', ').replace(/^./, (c) => c.toUpperCase()));
  });
  dlg.replaceChildren(el('div', {},
    dialogHead('Add songs by tag', 'Songs with any picked tag are added to the end of the playlist.', () => dlg.close()),
    groups.length ? el('div', { class: 'chip-groups' }, groups.map((g) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, g.name),
      ...g.tags.map(chip)))) : el('p', { class: 'muted' }, 'No tags yet'),
    el('div', { class: 'row end' }, apply)));
  refresh();
  dlg.showModal();
}

function renderQueue() {
  closeMenu();
  $('queue-empty').hidden = qs.items.length > 0;
  $('queue-list').replaceChildren(...qs.items.map((item, i) => songRow(item, i)));
  updateDl();
}

function dlText(v, short) {
  switch (v.kind) {
    case 'downloading': return v.progress > 0 ? `Downloading ${Math.round(v.progress * 100)}%` : 'Downloading...';
    case 'queued': return short ? 'Queued' : 'Queued for download';
    case 'paused': return `Download limit reached - resumes in ${v.minutes} min`;
    case 'failed': return short ? 'Download failed' : `Download failed: ${v.error}`;
    default: return 'Not downloaded';
  }
}

function paintDl(node, id) {
  const v = autodl.view(id);
  node.classList.toggle('failed', v.kind === 'failed');
  node.replaceChildren(dlText(v, true));
  if (v.kind === 'failed') {
    node.append(' ', el('button', { class: 'dl-act', type: 'button', onclick: () => autodl.retry(id) }, 'Retry'));
  }
}

function updateDl() {
  const song = player.current;
  const box = $('player-dl');
  const missing = !!song && !hasAudio(song);
  box.hidden = !missing;
  if (missing) {
    const v = autodl.view(song.id);
    $('player-dl-text').textContent = dlText(v, false);
    const btn = $('player-dl-btn');
    btn.hidden = !(v.kind === 'none' || v.kind === 'failed');
    btn.textContent = v.kind === 'failed' ? 'Retry' : 'Download';
  }
  for (const node of $('queue-list').querySelectorAll('[data-dl]')) paintDl(node, node.dataset.dl);
}

function renderProgress() {
  const dur = audio.duration;
  const cur = audio.currentTime;
  const frac = Number.isFinite(dur) && dur > 0 ? cur / dur : 0;
  $('mini-bar').style.width = `${frac * 100}%`;
  $('scrub').style.setProperty('--p', frac.toFixed(4));
  $('mini-time').textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
  $('t-dur').textContent = `-${fmtTime(Number.isFinite(dur) ? Math.max(0, dur - cur) : 0)}`;
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

function setVolume(v, save = true) {
  const vol = Math.max(0, Math.min(1, v));
  audio.volume = vol;
  for (const id of ['p-volume', 'mini-volume']) {
    $(id).value = Math.round(vol * 100);
    $(id).style.setProperty('--p', vol.toFixed(3));
  }
  $('p-volume-pct').textContent = `${Math.round(vol * 100)}%`;
  $('p-knob').style.setProperty('--vol', vol.toFixed(3));
  if (!save) return;
  try { localStorage.setItem(VOLUME_KEY, String(vol)); } catch { /* storage unavailable */ }
}

export function initPlayer() {
  setupMediaSession();
  initMenus();
  audio.addEventListener('play', render);
  audio.addEventListener('pause', render);
  audio.addEventListener('timeupdate', renderProgress);
  audio.addEventListener('durationchange', renderProgress);
  audio.addEventListener('ended', () => player.next(true));
  audio.addEventListener('error', () => { if (audio.src) fail(); });

  setIcon('p-prev', 'prev');
  setIcon('p-next', 'next');
  setIcon('p-shuffle', 'shuffle');
  setIcon('mini-prev', 'prev', 18);
  setIcon('mini-next', 'next', 18);
  setIcon('mini-shuffle', 'shuffle', 18);
  setIcon('p-edit', 'pencil', 20);
  setIcon('mini-edit', 'pencil', 18);
  setIcon('mini-locate', 'locate', 18);
  setIcon('p-download', 'download', 20);
  $('cover-toggle').addEventListener('click', () => {
    player.toggle();
    const b = $('cover-toggle');
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 1200);
  });
  $('player-dl-btn').addEventListener('click', () => { if (player.current) startDownload(player.current); });
  autodl.onChange(() => {
    const cur = player.current;
    if (awaiting && cur && awaiting === cur.id && !hasAudio(cur) && autodl.view(cur.id).kind === 'failed') {
      awaiting = null;
      toast(`Could not download "${cur.title}"`);
      player.next();
    }
    updateDl();
  });
  $('p-download').addEventListener('click', () => { if (player.current) downloadSong(player.current); });

  for (const p of ['mini', 'p']) {
    $(`${p}-play`).addEventListener('click', () => player.toggle());
    $(`${p}-next`).addEventListener('click', () => player.next());
    $(`${p}-prev`).addEventListener('click', () => player.prev());
    $(`${p}-shuffle`).addEventListener('click', () => player.setShuffle(!shuffle));
    $(`${p}-repeat`).addEventListener('click', () => player.cycleRepeat());
  }
  $('tag-add').addEventListener('click', openTagPicker);
  $('queue-clear').addEventListener('click', () => {
    const n = player.clearUpcoming();
    toast(n ? `Cleared ${n} ${plural(n, 'song', 'songs')}` : 'Tag chips cleared');
  });
  $('mini-open').addEventListener('click', () => { location.hash = '#/playback'; });
  $('mini-edit').addEventListener('click', () => { if (player.current) editDialog(player.current); });
  $('mini-locate').addEventListener('click', () => { if (player.current) requestReveal(player.current.id); });
  $('mini-playlist').addEventListener('click', () => {
    const cur = player.current;
    if (cur && player.toggleInPlaylist(cur.id) === 'removed') toast('Removed from playlist');
  });
  $('p-edit').addEventListener('click', () => { if (player.current) editDialog(player.current); });

  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !player.current) return;
    if (e.target.closest?.('input, textarea, select, button, a, dialog, [contenteditable]')) return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(audio.currentTime - 5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(audio.currentTime + 5); }
  });
  $('queue-list').addEventListener('scroll', closeMenu);

  const scrub = $('scrub');
  scrub.addEventListener('input', () => {
    scrubbing = true;
    scrub.style.setProperty('--p', (scrub.value / 1000).toFixed(4));
    $('t-cur').textContent = fmtTime((scrub.value / 1000) * (audio.duration || 0));
  });
  scrub.addEventListener('change', () => {
    player.seek((scrub.value / 1000) * (audio.duration || 0));
    scrubbing = false;
  });

  let stored = 1;
  try { const v = Number.parseFloat(localStorage.getItem(VOLUME_KEY)); if (Number.isFinite(v)) stored = v; } catch { /* storage unavailable */ }
  setVolume(stored, false);
  for (const id of ['p-volume', 'mini-volume']) $(id).addEventListener('input', (e) => setVolume(e.target.value / 100));

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
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
