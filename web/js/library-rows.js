import { api } from './api.js';
import { player } from './player.js';
import { el, toast, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { downloadSong } from './download.js';
import { hasAudio, sourceLink } from './playable.js';
import { autoDownloadOn, autodl } from './autodl.js';
import { ringModel } from './dl-progress.js';
import { rowActions } from './row-actions.js';
import { ringNode, lineNode } from './dl-ring.js';
import { serviceIcon } from './service-icons.js';
import { trackSub } from './track-sub.js';
import { bpmLabel } from './bpm-label.js';
import { genreText } from './genre-cell.js';
import { editDialog } from './edit-dialog.js';
import { displayString, titleNodes } from './display-title.js';

function cover(s) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s?.cover) img.src = api.coverUrl(s.id);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

function srcLogo(link) {
  const kind = link.source in { youtube: 1, soundcloud: 1 } ? link.source : 'other';
  const a = el('a', { class: `src-logo src-${kind}`, href: link.url, target: '_blank', rel: 'noopener', 'aria-label': link.label, title: link.label }, serviceIcon(kind, { size: 22 }));
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

function fetchAudio(s) {
  autodl.request([s.id], { front: true });
}

function dlButton(s) {
  return el('button', { class: 'row-dl', type: 'button', title: 'Download to the server', 'aria-label': `Download: ${displayString(s)}`, onclick: (e) => { e.stopPropagation(); fetchAudio(s); } }, icon('download', 18));
}

function bpmBadge(s) {
  const n = bpmLabel(s.bpm);
  if (!n) return null;
  return el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)', 'aria-label': `BPM ${n}` },
    n, el('small', { 'aria-hidden': 'true' }, 'BPM'));
}

export function songRow(s, cur, flashId) {
  const full = displayString(s);
  const tip = s.artist ? `${full} - ${s.artist}` : full;
  const audio = hasAudio(s);
  const queueable = audio || autoDownloadOn();
  const link = audio ? null : sourceLink(s);
  const here = audio && cur && cur.id === s.id;
  const queued = player.inQueue(s.id);
  const more = el('button', { class: 'more', type: 'button', 'aria-label': `More: ${full}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more', 20));
  more.addEventListener('click', () => openMenu(more, [
    ...(queueable ? [
      { label: 'Play now', run: () => player.playNow(s.id) },
      { label: queued ? 'Remove from playlist' : 'Add to playlist', run: () => toggleQueue(s) },
    ] : []),
    ...(audio ? [{ label: 'Download', run: () => downloadSong(s) }] : []),
    ...(!audio && autodl.view(s.id).kind === 'none' ? [{ label: 'Download to server', run: () => fetchAudio(s) }] : []),
    { label: 'Edit song', run: () => editDialog(s) },
  ]));
  const label = queued ? 'In playlist - click to remove' : 'Add to playlist';
  const pl = queueable
    ? el('button', { class: `pl-toggle${queued ? ' on' : ''}`, type: 'button', title: label, 'aria-label': `${label}: ${full}`, 'aria-pressed': String(queued), onclick: () => toggleQueue(s) }, icon(queued ? 'listCheck' : 'listAdd', 18))
    : el('span', { class: 'pl-toggle ph', 'aria-hidden': 'true' });
  const open = queueable
    ? el('button', { class: 'open t-headline', type: 'button', title: `Play now: ${tip}`, 'aria-label': `Play now: ${full}`, onclick: () => player.playNow(s.id) }, titleNodes(s))
    : el('span', { class: 'open t-headline', title: tip }, titleNodes(s));
  const genres = genreText(s.tags);
  let durText = '';
  if (audio) durText = s.duration ? fmtTime(s.duration) : '';
  const dl = audio ? null : ringModel(autodl.view(s.id));
  const act = rowActions({ audio, link, ring: dl });
  if (act.ring) durText = ringNode(dl, () => autodl.retry(s.id));
  else if (!audio) durText = [act.source ? srcLogo(link) : null, act.download ? dlButton(s) : null];
  const dur = el('span', { class: audio ? 'c-dur t-time' : 'c-dur t-caption' }, durText);
  return el('li', { class: `song${here ? ' current' : ''}${audio ? '' : ' no-audio'}${flashId === s.id ? ' flash' : ''}`, 'aria-current': here ? 'true' : null, 'data-id': s.id },
    cover(s),
    el('div', { class: 'info' },
      el('div', { class: 'title-line' }, open, bpmBadge(s)),
      trackSub(s) ? el('small', { class: 'sub t-subhead' }, trackSub(s)) : null),
    el('span', { class: 'c-genres t-subhead', title: genres || null }, genres),
    dur,
    pl,
    more,
    dl ? lineNode(dl) : null);
}

function toggleQueue(s) {
  const r = player.toggleInPlaylist(s.id);
  const messages = { duplicate: 'Already in queue', queued: 'Queued', removed: 'Removed from playlist' };
  toast(messages[r] || 'Added');
}
