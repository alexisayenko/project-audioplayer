import { api } from './api.js';
import { store } from './store.js';
import { hasAudio } from './playable.js';
import { el, fmtTime } from './dom.js';
import { fmtRemaining, paintElapsed, bindElapsed, onTimeLeftChange } from './time-left.js';
import { icon } from './icons.js';
import { storeGet, storeSet } from './storage.js';
import { openMenu } from './menu.js';
import { downloadSong } from './download.js';
import { autodl } from './autodl.js';
import { statusText } from './dl-progress.js';
import { editDialog } from './lazy-ui.js';
import { titleLine, artistLine, titleNodes } from './credits.js';
import { marquee } from './marquee.js';
import { can } from './guest.js';
import { coverButton, queueCoverModel, isRowControl } from './row-cover.js';

export const $ = (id) => document.getElementById(id);

export const setIcon = (id, name, size) => $(id).replaceChildren(icon(name, size));

export const MINI_COMPACT_KEY = 'ap2.miniCompact';

export function setMiniCompact(on) {
  const label = on ? 'Expand player' : 'Compact player';
  const b = $('mini-compact');
  $('mini').classList.toggle('compact', on);
  document.body.classList.toggle('mini-compact', on);
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', label);
  b.title = label;
  b.replaceChildren(icon(on ? 'chevronLeft' : 'chevronRight', 'inline'));
}

export function initMiniCompact() {
  const b = $('mini-compact');
  let on = storeGet(MINI_COMPACT_KEY) === '1';
  setMiniCompact(on);
  b.addEventListener('click', () => {
    on = !on;
    setMiniCompact(on);
    storeSet(MINI_COMPACT_KEY, on ? '1' : '0');
  });
}

export function setToggle(ids, on, label, iconName) {
  for (const id of ids) {
    const b = $(id);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label);
    b.title = label;
    b.classList.toggle('on', on);
    if (iconName) b.replaceChildren(icon(iconName, 'action'));
  }
}

export function setCover(img, song) {
  const src = song?.cover ? api.coverUrl(song.id, song.cover_v) : '';
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  if (src) img.src = src; else img.removeAttribute('src');
}

export function queueRow(item, i, { count, index, move, removeAt, playAt, openCard = () => {}, playing = false }) {
  const s = store.get(item.id);
  const cover = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s?.cover) cover.src = api.coverUrl(s.id, s.cover_v);
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  const title = s ? titleLine(s) : item.id;
  const more = el('button', {
    class: 'more', type: 'button', title: 'Song menu', 'aria-label': `Song menu: ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, icon('more', 'nav'));
  more.addEventListener('click', () => openMenu(more, [
    ...(s && can('edit') ? [{ label: 'Edit song', run: () => { void editDialog(s); } }] : []),
    ...(hasAudio(s) && can('download') ? [{ label: 'Download', run: () => downloadSong(s) }] : []),
    { label: 'Move up', disabled: i === 0, run: () => move(i, -1) },
    { label: 'Move down', disabled: i === count - 1, run: () => move(i, 1) },
    { label: 'Remove', run: () => removeAt(i) },
  ]));
  const coverBtn = coverButton(cover, queueCoverModel(i === index, playing), title, { run: () => playAt(i) });
  coverBtn.dataset.title = title;
  const row = el('li', { class: `qrow${i === index ? ' current' : ''}${s && !hasAudio(s) ? ' no-audio' : ''}`, 'aria-current': i === index ? 'true' : null },
    el('span', { class: 'c-idx t-time' }, i + 1),
    coverBtn,
    el('div', { class: 'info' },
      el('button', { class: 'open t-subhead', type: 'button', title: `Open: ${title}`, 'aria-label': `Open: ${title}` }, s ? titleNodes(s) : title),
      s && artistLine(s) ? el('small', { class: 'sub t-caption' }, artistLine(s)) : null,
      s && !hasAudio(s) ? el('small', { class: 'dl t-caption', 'data-dl': item.id }) : null),
    el('span', { class: 'c-dur t-time' }, s?.duration ? fmtTime(s.duration) : ''),
    more);
  row.addEventListener('click', (e) => {
    if (s && !isRowControl(e.target)) openCard(s, row.querySelector('.open'));
  });
  marquee(row.querySelector('.open'), { auto: i === index, host: row });
  return row;
}

function dlText(v, short) {
  if (v.kind === 'paused') return `Download limit reached - resumes in ${v.minutes} min`;
  return statusText(v, short);
}

function paintDl(node, id) {
  const v = autodl.view(id);
  node.classList.toggle('failed', v.kind === 'failed');
  node.replaceChildren(dlText(v, true));
  if (v.kind === 'failed') {
    node.append(' ', el('button', { class: 'dl-act', type: 'button', onclick: () => autodl.retry(id) }, 'Retry'));
  }
}

export function updateDl(song) {
  const box = $('player-dl');
  const missing = !!song && !hasAudio(song);
  box.hidden = !missing;
  if (missing) {
    const v = autodl.view(song.id);
    $('player-dl-text').textContent = dlText(v, false);
    const btn = $('player-dl-btn');
    btn.hidden = !(v.kind === 'none' || v.kind === 'failed') || !can('fetch');
    btn.textContent = v.kind === 'failed' ? 'Retry' : 'Download';
    $('mini-artist').textContent = v.kind === 'none' ? artistLine(song) : dlText(v, true);
  } else if (song) {
    $('mini-artist').textContent = artistLine(song);
  }
  for (const node of $('queue-list').querySelectorAll('[data-dl]')) paintDl(node, node.dataset.dl);
}

let lastTimes = [0, NaN];

export function paintTimes(cur, dur) {
  lastTimes = [cur, dur];
  paintElapsed($('mini-elapsed'), fmtTime(cur), fmtRemaining(cur, dur));
  $('mini-dur').textContent = ` / ${fmtTime(dur)}`;
}

export function initTimeToggle() {
  bindElapsed($('mini-elapsed'));
  onTimeLeftChange(() => paintTimes(...lastTimes));
}
