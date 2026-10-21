import { api } from './api.js';
import { player } from './player.js';
import { el, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { hasAudio, sourceLink } from './playable.js';
import { autoDownloadOn, autodl } from './autodl.js';
import { ringModel } from './dl-progress.js';
import { rowActions } from './row-actions.js';
import { ringNode, lineNode } from './dl-ring.js';
import { bpmLabel } from './bpm-label.js';
import { genreText } from './genre-cell.js';
import { coverModel, coverButton, queueNote } from './row-cover.js';
import { tooltipLine, subtitle, titleLine, titleNodes } from './credits.js';
import { marquee } from './marquee.js';

function cover(s) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s?.cover) img.src = api.coverUrl(s.id, s.cover_v);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

function fetchAudio(s) {
  autodl.request([s.id], { front: true });
}

function dlButton(s) {
  return el('button', { class: 'icon sq-btn', type: 'button', title: 'Download to the server', 'aria-label': `Download: ${titleLine(s)}`, onclick: (e) => { e.stopPropagation(); fetchAudio(s); } }, icon('download', 'inline'));
}

function bpmBadge(s) {
  const n = bpmLabel(s.bpm);
  if (!n) return null;
  return el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)', 'aria-label': `BPM ${n}` },
    n, el('small', { 'aria-hidden': 'true' }, 'BPM'));
}

function queueButton(s, queued) {
  const note = queued ? queueNote(player.queuePosition(s.id)) : '';
  const tip = queued ? `${note}. Click to remove` : 'Add to queue';
  return el('button', {
    class: `icon sq-btn${queued ? ' on' : ''}`, type: 'button', title: tip,
    'aria-label': `${queued ? 'Remove from queue' : 'Add to queue'}: ${titleLine(s)}`, 'aria-pressed': String(queued),
    onclick: (e) => { e.stopPropagation(); player.toggleInPlaylist(s.id); },
  }, icon(queued ? 'playlist' : 'listAdd', 'inline'));
}

function stateControl(s, { audio, queueable, queued, dl }) {
  if (!audio) {
    const act = rowActions({ audio, ring: dl });
    if (act.ring) return ringNode(dl, () => autodl.retry(s.id));
    if (act.download) return dlButton(s);
  }
  return queueable && (audio || queued) ? queueButton(s, queued) : null;
}

function openTitle(s, full, tip) {
  return el('button', { class: 'open t-headline', type: 'button', title: tip, 'aria-label': `Open: ${full}` }, titleNodes(s));
}

function runCover(s, action, link) {
  if (action === 'source') window.open(link.url, '_blank', 'noopener');
  else if (action === 'play') player.playNow(s.id);
  else if (action === 'pause' || action === 'resume') player.toggle();
  else if (action === 'download') fetchAudio(s);
}

function coverCell(s, full, { audio, queueable, here, link, queued }) {
  const model = coverModel({ audio, queueable, here, playing: player.playing, dl: autodl.view(s.id).kind, source: !!link });
  return coverButton(cover(s), model, full, { run: (action) => runCover(s, action, link), queued });
}

function subLine(s) {
  const sub = subtitle(s);
  const badge = bpmBadge(s);
  if (!sub && !badge) return null;
  return el('div', { class: 'sub-line' },
    el('small', { class: 'sub t-subhead', title: sub || null }, sub),
    badge ? el('span', { class: 'sub-end' }, badge) : null);
}

function statsCell(n) {
  const text = `Listened ${n} ${n === 1 ? 'time' : 'times'}`;
  return el('div', { class: `c-stats t-subhead${n ? '' : ' zero'}`, title: text, 'aria-label': text }, String(n));
}

export function songRow(s, cur, flashId, listened = null) {
  const full = titleLine(s);
  const tip = tooltipLine(s);
  const audio = hasAudio(s);
  const queueable = audio || autoDownloadOn();
  const link = audio ? null : sourceLink(s);
  const here = audio && cur && cur.id === s.id;
  const queued = player.inQueue(s.id);
  const open = openTitle(s, full, tip);
  const genres = genreText(s.tags);
  const dl = audio ? null : ringModel(autodl.view(s.id));
  const row = el('li', { class: `song${here ? ' current' : ''}${audio ? '' : ' no-audio'}${flashId === s.id ? ' flash' : ''}`, 'aria-current': here ? 'true' : null, 'data-id': s.id },
    coverCell(s, full, { audio, queueable, here, link, queued: queued ? player.queuePosition(s.id) : null }),
    el('div', { class: 'info' },
      el('div', { class: 'title-line' }, open, stateControl(s, { audio, queueable, queued, dl }), audio && s.duration ? el('span', { class: 'title-len t-time', title: 'Length' }, fmtTime(s.duration)) : null),
      subLine(s)),
    el('div', { class: 'c-genres t-subhead' }, el('span', { class: 'g-txt', title: genres || null }, genres)),
    listened == null ? null : statsCell(listened),
    dl ? lineNode(dl) : null);
  marquee(open, { auto: !!here, host: row });
  return row;
}
