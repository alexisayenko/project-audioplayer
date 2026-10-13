import { api } from './api.js';
import { store } from './store.js';
import { hasAudio } from './playable.js';
import { el, fmtTime, toast, plural } from './dom.js';
import * as Q from './queue-logic.js';
import { visibleTags, tagChip, tagGroups, tagLabel, tagText } from './tagname.js';
import { songLinks } from './wiki-links.js';
import { icon } from './icons.js';
import { openMenu, closeMenu, initMenus } from './menu.js';
import { editDialog, dialogHead } from './edit-dialog.js';

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
const listeners = new Set();

const ids = () => Q.queueIds(qs);
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

function commit(next) {
  const wasEmpty = qs.index < 0;
  qs = next;
  saveQueue();
  if (wasEmpty && qs.index >= 0) load(false); else render();
}

function jumpTo(i, remember = true) {
  const cur = qs.items[qs.index];
  if (remember && shuffle && cur && i !== qs.index) history.push(cur.id);
  qs = { ...qs, index: i };
  saveQueue();
  load(true);
}

export const player = {
  get current() { const it = qs.items[qs.index]; return it ? store.get(it.id) || null : null; },
  get playing() { return !audio.paused; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  playNow(id) {
    if (!hasAudio(store.get(id))) return;
    qs = Q.playNow(qs, id);
    saveQueue();
    load(true);
  },

  add(id) {
    if (!hasAudio(store.get(id))) return 'unavailable';
    const { state, result } = Q.addManual(qs, id);
    commit(state);
    return result;
  },

  addTags(tags) {
    const { state, added } = Q.addTags(qs, tags, store.songs.filter(hasAudio));
    commit(state);
    return added;
  },

  addListed(songs, tag) {
    const { state, added, already } = Q.addListed(qs, songs.filter(hasAudio), tag);
    commit(state);
    return { added, already };
  },

  removeTag(tag) {
    const { state, removed } = Q.removeTags(qs, [tag]);
    commit(state);
    return removed;
  },

  clean() {
    const { state, removed } = Q.clean(qs);
    commit(state);
    return removed;
  },

  removeAt(i) { commit(Q.removeAt(qs, i)); },
  move(i, delta) { commit(Q.move(qs, i, delta)); },

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
    if (!player.current) return;
    if (audio.paused) audio.play().catch(fail); else audio.pause();
  },

  next(auto = false) {
    const step = Q.nextStep(logic(), !auto);
    if (!step) { render(); return; }
    played = step.played;
    if (step.index === qs.index) { audio.currentTime = 0; audio.play().catch(fail); render(); return; }
    jumpTo(step.index);
  },

  prev() {
    const step = audio.currentTime > 3 ? null : Q.prevStep({ ...logic(), history });
    if (!step) { audio.currentTime = 0; return; }
    history = step.history;
    jumpTo(step.index, false);
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
  $('p-more').hidden = !song;
  $('queue-count').textContent = n ? `${n} ${plural(n, 'song', 'songs')}` : '';
  renderPlaylistControls();
  const playing = !audio.paused;
  setIcon('p-play', playing ? 'pause' : 'play', 22);
  setIcon('mini-play', playing ? 'pause' : 'play', 20);
  $('p-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('mini-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (!song) {
    document.title = 'Electrophone';
    for (const id of ['p-prev', 'p-next', 'p-play', 'mini-prev', 'mini-next']) $(id).disabled = true;
    $('player-cover').removeAttribute('src');
    $('player-cover').dataset.src = '';
    $('cover-art').classList.add('noart');
    renderQueue();
    return;
  }
  const noNext = !Q.hasNext(logic());
  for (const id of ['p-prev', 'p-play', 'mini-prev']) $(id).disabled = false;
  $('p-next').disabled = noNext;
  $('mini-next').disabled = noNext;
  $('mini-title').textContent = song.title;
  $('mini-artist').textContent = song.artist || '';
  $('player-title').textContent = song.title;
  $('player-sub').textContent = [song.artist, song.album, song.year].filter(Boolean).join(' · ');
  $('player-tags').replaceChildren(...visibleTags(song.tags).map(tagChip));
  $('player-bpm').textContent = song.bpm != null ? `${Math.round(song.bpm)} BPM` : '';
  $('player-links').replaceChildren(...songLinks(song).map((l) => el('a', { class: 'source t-caption', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label)));
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
  $('queue-clear').disabled = !qs.tags.length;
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
  const past = i <= qs.index;
  const more = el('button', {
    class: 'more', type: 'button', title: 'Song menu', 'aria-label': `Song menu: ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, icon('more', 20));
  more.addEventListener('click', () => openMenu(more, [
    { label: 'Move up', disabled: past || i - 1 <= qs.index, run: () => player.move(i, -1) },
    { label: 'Move down', disabled: past || i + 1 >= qs.items.length, run: () => player.move(i, 1) },
    { label: 'Remove', disabled: past, run: () => player.removeAt(i) },
  ]));
  return el('li', { class: `qrow${i === qs.index ? ' current' : ''}`, 'aria-current': i === qs.index ? 'true' : null },
    el('span', { class: 'c-idx t-time' }, i + 1),
    cover,
    el('div', { class: 'info' },
      el('button', { class: 'open t-subhead', type: 'button', title: 'Play', onclick: () => player.playAt(i) }, title),
      s?.artist ? el('small', { class: 'sub t-caption' }, s.artist) : null),
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
  setIcon('p-more', 'more', 20);

  for (const p of ['mini', 'p']) {
    $(`${p}-play`).addEventListener('click', () => player.toggle());
    $(`${p}-next`).addEventListener('click', () => player.next());
    $(`${p}-prev`).addEventListener('click', () => player.prev());
    $(`${p}-shuffle`).addEventListener('click', () => player.setShuffle(!shuffle));
    $(`${p}-repeat`).addEventListener('click', () => player.cycleRepeat());
  }
  $('tag-add').addEventListener('click', openTagPicker);
  $('queue-clear').addEventListener('click', () => {
    const n = player.clean();
    toast(n ? `Removed ${n} ${plural(n, 'song', 'songs')}` : 'Tags cleared');
  });
  $('mini-open').addEventListener('click', () => { location.hash = '#/playback'; });
  $('p-more').addEventListener('click', () => {
    const song = player.current;
    if (song) openMenu($('p-more'), [{ label: 'Edit song', run: () => editDialog(song) }]);
  });

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
      return;
    }
    render();
  });
  render();
}

export function pausePlayer() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
