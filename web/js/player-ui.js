import { api } from './api.js';
import { store } from './store.js';
import { hasAudio } from './playable.js';
import { el, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { downloadSong } from './download.js';
import { autodl } from './autodl.js';
import { statusText } from './dl-progress.js';
import { editDialog } from './edit-dialog.js';
import { displayString, titleNodes } from './display-title.js';
import { marquee } from './marquee.js';
import { can } from './guest.js';

export const $ = (id) => document.getElementById(id);

export const setIcon = (id, name, size) => $(id).replaceChildren(icon(name, size));

export function setToggle(ids, on, label, iconName) {
  for (const id of ids) {
    const b = $(id);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label);
    b.title = label;
    b.classList.toggle('on', on);
    if (iconName) b.replaceChildren(icon(iconName, id.startsWith('mini') ? 18 : 20));
  }
}

export function setCover(img, song) {
  const src = song?.cover ? api.coverUrl(song.id) : '';
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  if (src) img.src = src; else img.removeAttribute('src');
}

export function queueRow(item, i, { count, index, move, removeAt, playAt }) {
  const s = store.get(item.id);
  const cover = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s?.cover) cover.src = api.coverUrl(s.id);
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  const title = s ? displayString(s) : item.id;
  const more = el('button', {
    class: 'more', type: 'button', title: 'Song menu', 'aria-label': `Song menu: ${title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, icon('more', 20));
  more.addEventListener('click', () => openMenu(more, [
    ...(s && can('edit') ? [{ label: 'Edit song', run: () => editDialog(s) }] : []),
    ...(hasAudio(s) && can('download') ? [{ label: 'Download', run: () => downloadSong(s) }] : []),
    { label: 'Move up', disabled: i === 0, run: () => move(i, -1) },
    { label: 'Move down', disabled: i === count - 1, run: () => move(i, 1) },
    { label: 'Remove', run: () => removeAt(i) },
  ]));
  const row = el('li', { class: `qrow${i === index ? ' current' : ''}${s && !hasAudio(s) ? ' no-audio' : ''}`, 'aria-current': i === index ? 'true' : null },
    el('span', { class: 'c-idx t-time' }, i + 1),
    cover,
    el('div', { class: 'info' },
      el('button', { class: 'open t-subhead', type: 'button', title: `Play: ${title}`, onclick: () => playAt(i) }, s ? titleNodes(s) : title),
      s?.artist ? el('small', { class: 'sub t-caption' }, s.artist) : null,
      s && !hasAudio(s) ? el('small', { class: 'dl t-caption', 'data-dl': item.id }) : null),
    el('span', { class: 'c-dur t-time' }, s?.duration ? fmtTime(s.duration) : ''),
    more);
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
    $('mini-artist').textContent = v.kind === 'none' ? song.artist || '' : dlText(v, true);
  } else if (song) {
    $('mini-artist').textContent = song.artist || '';
  }
  for (const node of $('queue-list').querySelectorAll('[data-dl]')) paintDl(node, node.dataset.dl);
}

export function paintTimes(cur, dur) {
  $('mini-time').textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
  $('t-cur').textContent = fmtTime(cur);
  $('t-dur').textContent = `-${fmtTime(Number.isFinite(dur) ? Math.max(0, dur - cur) : 0)}`;
}
