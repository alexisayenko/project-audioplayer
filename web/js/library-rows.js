import { openShareDialog } from './share-ui.js';
import { api } from './api.js';
import { player } from './player.js';
import { el, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { downloadSong } from './download.js';
import { hasAudio, sourceLink } from './playable.js';
import { autoDownloadOn, autodl } from './autodl.js';
import { ringModel } from './dl-progress.js';
import { rowActions } from './row-actions.js';
import { ringNode, lineNode } from './dl-ring.js';
import { serviceIcon } from './service-icons.js';
import { bpmLabel } from './bpm-label.js';
import { genreText } from './genre-cell.js';
import { toggleQueue } from './queue-toggle.js';
import { coverModel, coverButton } from './row-cover.js';
import { editDialog } from './edit-dialog.js';
import { can } from './guest.js';
import { tooltipLine, subtitle, titleLine, titleNodes } from './credits.js';
import { marquee } from './marquee.js';

function cover(s) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s?.cover) img.src = api.coverUrl(s.id, s.cover_v);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

function srcLogo(link) {
  const kind = link.source in { youtube: 1, soundcloud: 1 } ? link.source : 'other';
  const a = el('a', { class: `src-logo src-${kind}`, href: link.url, target: '_blank', rel: 'noopener', 'aria-label': link.label, title: link.label }, serviceIcon(kind));
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

function fetchAudio(s) {
  autodl.request([s.id], { front: true });
}

function dlButton(s) {
  return el('button', { class: 'icon round row-dl', type: 'button', title: 'Download to the server', 'aria-label': `Download: ${titleLine(s)}`, onclick: (e) => { e.stopPropagation(); fetchAudio(s); } }, icon('download', 'action'));
}

function bpmBadge(s) {
  const n = bpmLabel(s.bpm);
  if (!n) return el('span', { class: 'bpm-slot', 'aria-hidden': 'true' });
  return el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)', 'aria-label': `BPM ${n}` },
    n, el('small', { 'aria-hidden': 'true' }, 'BPM'));
}

function moreButton(s, full, { audio, queueable, queued }) {
  const items = [
    ...(queueable ? [
      { label: 'Play now', run: () => player.playNow(s.id) },
      { label: queued ? 'Remove from playlist' : 'Add to playlist', run: () => toggleQueue(s) },
    ] : []),
    ...(audio && can('download') ? [{ label: 'Download', run: () => downloadSong(s) }] : []),
    ...(!audio && can('fetch') && autodl.view(s.id).kind === 'none' ? [{ label: 'Download to server', run: () => fetchAudio(s) }] : []),
    { label: 'Share link', run: () => openShareDialog(s) },
    ...(can('edit') ? [{ label: 'Edit song', run: () => editDialog(s) }] : []),
  ];
  if (!items.length) return el('span', { class: 'more ph', 'aria-hidden': 'true' });
  const more = el('button', { class: 'more', type: 'button', 'aria-label': `More: ${full}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more', 'nav'));
  more.addEventListener('click', () => openMenu(more, items));
  return more;
}

function playlistToggle(s, full, queued, queueable) {
  if (!queueable) return el('span', { class: 'pl-toggle ph', 'aria-hidden': 'true' });
  const label = queued ? 'In playlist - click to remove' : 'Add to playlist';
  const glyph = queued ? 'listCheck' : 'listAdd';
  return el('button', { class: `icon round pl-toggle${queued ? ' on' : ''}`, type: 'button', title: label, 'aria-label': `${label}: ${full}`, 'aria-pressed': String(queued), onclick: () => toggleQueue(s) }, icon(glyph, 'action'));
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

function coverCell(s, full, { audio, queueable, here, link }) {
  const model = coverModel({ audio, queueable, here, playing: player.playing, dl: autodl.view(s.id).kind, source: !!link });
  return coverButton(cover(s), model, full, { run: (action) => runCover(s, action, link) });
}

function durationContent(s, audio, link, dl) {
  const act = rowActions({ audio, link, ring: dl });
  if (act.ring) return ringNode(dl, () => autodl.retry(s.id));
  if (audio) return s.duration ? fmtTime(s.duration) : '';
  return [act.source ? srcLogo(link) : null, act.download ? dlButton(s) : null];
}

export function songRow(s, cur, flashId) {
  const full = titleLine(s);
  const tip = tooltipLine(s);
  const audio = hasAudio(s);
  const queueable = audio || autoDownloadOn();
  const link = audio ? null : sourceLink(s);
  const here = audio && cur && cur.id === s.id;
  const queued = player.inQueue(s.id);
  const more = moreButton(s, full, { audio, queueable, queued });
  const pl = playlistToggle(s, full, queued, queueable);
  const open = openTitle(s, full, tip);
  const genres = genreText(s.tags);
  const dl = audio ? null : ringModel(autodl.view(s.id));
  const durText = durationContent(s, audio, link, dl);
  const dur = el('span', { class: audio ? 'c-dur t-time' : 'c-dur t-caption' }, durText);
  const row = el('li', { class: `song${here ? ' current' : ''}${audio ? '' : ' no-audio'}${flashId === s.id ? ' flash' : ''}`, 'aria-current': here ? 'true' : null, 'data-id': s.id },
    coverCell(s, full, { audio, queueable, here, link }),
    el('div', { class: 'info' },
      el('div', { class: 'title-line' }, open),
      subtitle(s) ? el('small', { class: 'sub t-subhead', title: subtitle(s) }, subtitle(s)) : null),
    el('div', { class: 'c-genres t-subhead' }, bpmBadge(s), el('span', { class: 'g-txt', title: genres || null }, genres)),
    dur,
    pl,
    more,
    dl ? lineNode(dl) : null);
  marquee(open, { auto: !!here, host: row });
  return row;
}
