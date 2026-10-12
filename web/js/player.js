import { api } from './api.js';
import { store } from './store.js';
import { el, fmtTime, toast } from './dom.js';
import * as Q from './queue-logic.js';

const audio = document.getElementById('audio');
const $ = (id) => document.getElementById(id);

const PLAY = '▶';
const PAUSE = '⏸';

const QUEUE_KEY = 'ap2.queue';
const SHUFFLE_KEY = 'ap2.shuffle';
const REPEAT_KEY = 'ap2.repeat';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NUM5 = '<text x="12" y="15.6" font-size="8.5" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">5</text>';
const LOOP = '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>';
const ICONS = {
  prev: '<path d="M6 5v14"/><path d="M19 5.5v13L9 12z" fill="currentColor"/>',
  next: '<path d="M18 5v14"/><path d="M5 5.5v13L15 12z" fill="currentColor"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  back5: `<path d="M5 12a7 7 0 1 0 2-4.9"/><path d="M5 4.5v3.7h3.7"/>${NUM5}`,
  fwd5: `<path d="M19 12a7 7 0 1 1-2-4.9"/><path d="M19 4.5v3.7h-3.7"/>${NUM5}`,
  shuffle: '<path d="M3 7h3c5 0 7 10 12 10h3"/><path d="M3 17h3c1.7 0 3-.9 4-2.2"/><path d="M13.5 9c1.2-1.3 2.4-2 4.5-2h3"/><path d="M18 4l3 3-3 3"/><path d="M18 14l3 3-3 3"/>',
  loopAll: LOOP,
  loopOne: `${LOOP}<text x="12" y="15" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">1</text>`,
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
function icon(name, size = 22) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name];
  return svg;
}
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
    qs = Q.playNow(qs, id);
    saveQueue();
    load(true);
  },

  add(id) {
    const { state, result } = Q.addManual(qs, id);
    commit(state);
    return result;
  },

  addTags(tags) {
    const { state, added } = Q.addTags(qs, tags, store.songs);
    commit(state);
    return added;
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
  const src = song && song.cover ? api.coverUrl(song.id) : '';
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
  $('player-cover').hidden = !song;
  const count = $('nav-count');
  count.hidden = !n;
  count.textContent = n;
  $('queue-count').textContent = n ? `${n} ${n === 1 ? 'song' : 'songs'}` : '';
  renderPlaylistControls();
  if (!song) {
    document.title = 'Audio Player';
    for (const id of ['p-prev', 'p-back', 'p-fwd', 'p-next', 'p-play']) $(id).disabled = true;
    setIcon('p-play', 'play', 30);
    renderQueue();
    return;
  }
  for (const id of ['p-prev', 'p-back', 'p-fwd', 'p-play']) $(id).disabled = false;
  $('mini-play').textContent = audio.paused ? PLAY : PAUSE;
  setIcon('p-play', audio.paused ? 'play' : 'pause', 30);
  $('mini-title').textContent = song.title;
  $('mini-artist').textContent = song.artist || '';
  $('player-title').textContent = song.title;
  $('player-sub').textContent = [song.artist, song.album, song.year].filter(Boolean).join(', ');
  $('player-tags').replaceChildren(...(song.tags || []).map(tagChip));
  $('player-bpm').textContent = song.bpm != null ? `${Math.round(song.bpm)} BPM` : '';
  const src = $('player-source');
  src.hidden = !/^https?:\/\//i.test(song.source_url || '');
  if (!src.hidden) src.href = song.source_url;
  setCover($('mini-cover'), song);
  setCover($('player-cover'), song);
  $('p-next').disabled = !Q.hasNext(logic());
  $('mini-next').disabled = $('p-next').disabled;
  renderQueue();
  document.title = `${song.title} - Audio Player`;
  listeners.forEach((fn) => fn());
}

function tagChip(t) {
  const i = t.indexOf(':');
  return i > 0
    ? el('span', { class: 'tag ns' }, el('span', { class: 'ns-key' }, t.slice(0, i)), t.slice(i + 1))
    : el('span', { class: 'tag' }, t);
}

function setToggle(id, on, label) {
  const b = $(id);
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', label);
  b.title = label;
  b.classList.toggle('on', on);
}

function renderPlaylistControls() {
  setToggle('p-shuffle', shuffle, `Shuffle: ${shuffle ? 'on' : 'off'}`);
  setToggle('p-loop-one', repeat === 'one', `Loop one song: ${repeat === 'one' ? 'on' : 'off'}`);
  setToggle('p-loop-all', repeat === 'all', `Loop whole list: ${repeat === 'all' ? 'on' : 'off'}`);
  $('queue-clear').disabled = !qs.tags.length;
  $('fill-tags').replaceChildren(...qs.tags.map((t) => el('span', { class: 'chip on' },
    t,
    el('button', {
      class: 'x', type: 'button', title: `Remove tag: ${t}`, 'aria-label': `Remove tag: ${t}`,
      onclick: () => { const n = player.removeTag(t); toast(n ? `Removed ${n} ${n === 1 ? 'song' : 'songs'}` : 'Tag removed'); },
    }, '×'))));
}

function songRow(item, i) {
  const s = store.get(item.id);
  const sub = s ? [s.artist, s.album, s.year].filter(Boolean).join(', ') : '';
  const cover = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s && s.cover) cover.src = api.coverUrl(s.id);
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  const title = s ? s.title : item.id;
  const now = i === qs.index && !audio.paused;
  return el('li', { class: `song${i === qs.index ? ' current' : ''}`, 'aria-current': i === qs.index ? 'true' : null },
    cover,
    el('div', { class: 'info' },
      el('button', { class: 'open', type: 'button', title: 'Play', onclick: () => player.playAt(i) }, title),
      sub ? el('small', {}, sub) : null),
    el('div', { class: 'side' },
      el('div', { class: 'meta' }, s && s.duration ? el('span', { class: 'dur' }, fmtTime(s.duration)) : null),
      el('div', { class: 'btns' },
        el('button', {
          class: 'icon', type: 'button', title: now ? 'Pause' : 'Play', 'aria-label': `${now ? 'Pause' : 'Play'}: ${title}`,
          onclick: () => player.playAt(i),
        }, icon(now ? 'pause' : 'play')),
        el('button', {
          class: 'icon', type: 'button', title: 'Song menu', 'aria-label': `Song menu: ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
          onclick: (e) => openRowMenu(e.currentTarget, i),
        }, icon('menu')))),
    s && (s.tags || []).length ? el('div', { class: 'tags' }, s.tags.map(tagChip)) : null);
}

let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.btn.setAttribute('aria-expanded', 'false');
  openMenu.node.remove();
  openMenu = null;
}

function openRowMenu(btn, i) {
  const again = openMenu && openMenu.btn === btn;
  closeMenu();
  if (again) return;
  const past = i <= qs.index;
  const item = (label, off, fn) => el('button', {
    class: 'menu-item', type: 'button', role: 'menuitem', disabled: off,
    onclick: () => { closeMenu(); fn(); },
  }, label);
  const node = el('div', { class: 'menu', role: 'menu' },
    item('Move up', past || i - 1 <= qs.index, () => player.move(i, -1)),
    item('Move down', past || i + 1 >= qs.items.length, () => player.move(i, 1)),
    item('Remove', past, () => player.removeAt(i)));
  document.body.append(node);
  btn.setAttribute('aria-expanded', 'true');
  openMenu = { node, btn };
  const r = btn.getBoundingClientRect();
  const h = node.offsetHeight;
  node.style.top = `${r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  node.style.left = `${Math.max(8, Math.min(r.right - node.offsetWidth, window.innerWidth - node.offsetWidth - 8))}px`;
  const first = node.querySelector('button:not(:disabled)');
  if (first) first.focus();
}

function openTagPicker() {
  const dlg = document.getElementById('edit-dialog');
  const chosen = new Set(qs.tags.map((t) => t.toLocaleLowerCase()));
  const groups = new Map();
  for (const t of store.tags) {
    const i = t.tag.indexOf(':');
    const key = i > 0 ? t.tag.slice(0, i) : '';
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  const apply = el('button', { type: 'button', class: 'btn primary' }, 'Add songs');
  const refresh = () => {
    const fresh = [...chosen].filter((c) => !qs.tags.some((t) => t.toLocaleLowerCase() === c));
    const drop = qs.tags.filter((t) => !chosen.has(t.toLocaleLowerCase()));
    apply.disabled = !fresh.length && !drop.length;
    apply.textContent = fresh.length ? `Add songs (${fresh.length} ${fresh.length === 1 ? 'tag' : 'tags'})` : drop.length ? 'Apply' : 'Add songs';
  };
  const chip = (t, key) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' },
      key ? t.tag.slice(key.length + 1) : t.tag, el('small', {}, t.count));
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
    el('h2', {}, 'Add songs by tag'),
    el('p', { class: 'muted' }, 'Songs with any picked tag are added to the end of the playlist.'),
    order.length ? el('div', { class: 'chip-groups' }, order.map((key) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, key ? key[0].toLocaleUpperCase() + key.slice(1) : 'Tags'),
      ...groups.get(key).map((t) => chip(t, key))))) : el('p', { class: 'muted' }, 'No tags yet'),
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), apply)));
  refresh();
  dlg.showModal();
}

function renderQueue() {
  closeMenu();
  $('queue-empty').hidden = qs.items.length > 0;
  $('queue-list').replaceChildren(...qs.items.map(songRow));
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
  audio.addEventListener('ended', () => player.next(true));
  audio.addEventListener('error', () => { if (audio.src) fail(); });

  setIcon('p-prev', 'prev');
  setIcon('p-next', 'next');
  setIcon('p-back', 'back5', 26);
  setIcon('p-fwd', 'fwd5', 26);
  setIcon('p-shuffle', 'shuffle');
  setIcon('p-loop-one', 'loopOne');
  setIcon('p-loop-all', 'loopAll');
  setIcon('tag-add', 'plus');

  $('mini-play').addEventListener('click', () => player.toggle());
  $('mini-next').addEventListener('click', () => player.next());
  $('p-play').addEventListener('click', () => player.toggle());
  $('p-next').addEventListener('click', () => player.next());
  $('p-prev').addEventListener('click', () => player.prev());
  $('p-back').addEventListener('click', () => player.seek(audio.currentTime - 5));
  $('p-fwd').addEventListener('click', () => player.seek(audio.currentTime + 5));
  $('p-shuffle').addEventListener('click', () => player.setShuffle(!shuffle));
  $('p-loop-one').addEventListener('click', () => player.toggleRepeat('one'));
  $('p-loop-all').addEventListener('click', () => player.toggleRepeat('all'));
  $('tag-add').addEventListener('click', openTagPicker);
  $('queue-clear').addEventListener('click', () => {
    const n = player.clean();
    toast(n ? `Removed ${n} ${n === 1 ? 'song' : 'songs'}` : 'Tags cleared');
  });
  $('mini-open').addEventListener('click', () => { location.hash = '#/playback'; });

  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.node.contains(e.target) && !openMenu.btn.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openMenu) { const b = openMenu.btn; closeMenu(); b.focus(); return; }
    if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !player.current) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button, a, dialog, [contenteditable]')) return;
    e.preventDefault();
    player.toggle();
  });
  window.addEventListener('resize', closeMenu);
  $('queue-list').addEventListener('scroll', closeMenu);

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
}
