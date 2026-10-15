import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, fmtTime } from './dom.js';
import { hasAudio, sourceLink } from './playable.js';
import { can } from './guest.js';
import { autodl, autoDownloadOn } from './autodl.js';
import { statusText } from './dl-progress.js';
import { downloadSong } from './download.js';
import { editDialog } from './edit-dialog.js';
import { displayTitle, titleNodes } from './display-title.js';
import { bpmLabel } from './bpm-label.js';
import { visibleTags, tagGroups, tagLabel } from './tagname.js';
import { serviceIcons } from './service-icons.js';
import { storedLinkStates } from './song-links.js';
import { toggleQueue } from './queue-toggle.js';

export function downloadText(song, view) {
  if (hasAudio(song)) return 'Downloaded to the server';
  if (!view || view.kind === 'none') return 'Not downloaded';
  return statusText(view, false);
}

export function cardTags(tags) {
  const counts = visibleTags(tags).map((tag) => ({ tag, count: 1 }));
  return tagGroups(counts).map((g) => ({ key: g.key, name: g.name, tags: g.tags.map((t) => ({ tag: t.tag, label: tagLabel(t.tag) })) }));
}

export function cardModel(song, view) {
  const { title, remix } = displayTitle(song);
  return {
    title,
    remix,
    sub: [song?.artist, song?.album, song?.year].filter((v) => v != null && String(v).trim() !== '').join(' - '),
    groups: cardTags(song?.tags),
    remixYear: Number.isInteger(song?.remix_year) ? `Remix year ${song.remix_year}` : '',
    bpm: bpmLabel(song?.bpm),
    duration: song?.duration ? fmtTime(song.duration) : '',
    links: storedLinkStates(song),
    download: downloadText(song, view),
  };
}

export function playControl(song, { cur, playing, queueable }) {
  if (hasAudio(song) && cur && cur.id === song.id) return { label: playing ? 'Pause' : 'Play', run: () => player.toggle() };
  if (!queueable) return null;
  return { label: 'Play now', run: () => player.playNow(song.id) };
}

function coverBlock(song) {
  const img = el('img', { class: 'cover card-cover', alt: '' });
  if (song.cover) img.src = api.coverUrl(song.id, song.cover_v);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

function tagBlock(groups) {
  if (!groups.length) return null;
  return el('div', { class: 'chip-groups card-tags' }, groups.map((g) => el('div', { class: 'chip-group' },
    el('span', { class: 'group-name t-caption' }, g.name),
    g.tags.map((t) => el('span', { class: 'tag ns t-caption', title: t.tag }, t.label)))));
}

function linkBlock(links) {
  if (!Object.keys(links).length) return null;
  const row = serviceIcons({ onlyOn: true });
  row.setState(links);
  return row.node;
}

function actionRow(song, close) {
  const audio = hasAudio(song);
  const queueable = audio || autoDownloadOn();
  const play = playControl(song, { cur: player.current, playing: player.playing, queueable });
  const queued = player.inQueue(song.id);
  const view = autodl.view(song.id);
  const link = sourceLink(song);
  const queueLabel = queued ? 'Remove from playlist' : 'Add to playlist';
  const btn = (label, run, cls = 'btn outline') => el('button', { class: cls, type: 'button', onclick: run }, label);
  return el('div', { class: 'card-actions' },
    play ? btn(play.label, play.run, 'btn primary glow') : null,
    queueable ? btn(queueLabel, () => toggleQueue(song)) : null,
    audio && can('download') ? btn('Download', () => downloadSong(song)) : null,
    !audio && can('fetch') && (view.kind === 'none' || view.kind === 'failed') ? btn('Download to server', () => autodl.request([song.id], { front: true })) : null,
    can('edit') ? btn('Edit', () => editDialog(song)) : null,
    !audio && !can('fetch') && link ? btn(link.label, () => window.open(link.url, '_blank', 'noopener')) : null,
    btn('Close', close, 'btn outline card-close'));
}

function paint(dlg, song, close, m) {
  const parts = [
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    coverBlock(song),
    el('div', { class: 'card-head' },
      el('h2', { id: 'song-card-title', class: 't-title' }, titleNodes(song)),
      m.sub ? el('p', { class: 'muted t-subhead' }, m.sub) : null),
    tagBlock(m.groups),
    el('p', { class: 'facts t-caption' },
      m.bpm ? el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)' }, m.bpm, el('small', { 'aria-hidden': 'true' }, 'BPM')) : null,
      m.duration ? el('span', {}, m.duration) : null,
      m.remixYear ? el('span', { class: 'remix-year' }, m.remixYear) : null,
      el('span', {}, m.download)),
    linkBlock(m.links),
    actionRow(song, close),
  ];
  dlg.replaceChildren(...parts.filter(Boolean));
}

const actionButtons = (dlg) => [...dlg.querySelectorAll('.card-actions button')];

function repaint(dlg, song, close) {
  const m = cardModel(song, autodl.view(song.id));
  const idx = actionButtons(dlg).indexOf(document.activeElement);
  paint(dlg, song, close, m);
  if (idx >= 0) {
    const btns = actionButtons(dlg);
    btns[Math.min(idx, btns.length - 1)]?.focus();
  }
}

function focusRow(id, fallback) {
  const rows = [...document.querySelectorAll('.songs li.song')];
  const row = rows.find((r) => r.dataset.id === id);
  const target = row?.querySelector('.open') || (fallback?.isConnected ? fallback : null);
  target?.focus();
}

export function openSongCard(song, opener = null) {
  const dlg = document.getElementById('song-card');
  const id = song.id;
  const close = () => dlg.close();
  let last = '';
  const render = (force) => {
    const fresh = store.get(id);
    if (!fresh) { close(); return; }
    const sig = [downloadText(fresh, autodl.view(id)), player.current?.id === id, player.playing, player.inQueue(id), autoDownloadOn()].join('|');
    if (force !== true && sig === last) return;
    last = sig;
    repaint(dlg, fresh, close);
  };
  const unsubs = [store.subscribe(() => render(true)), player.onChange(render), autodl.onChange(render)];
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => {
    for (const u of unsubs) u();
    dlg.replaceChildren();
    focusRow(id, opener);
  }, { once: true });
  render(true);
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.card-actions button')?.focus();
}
