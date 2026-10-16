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
import { creditParts, isStructured, subtitle, titleNodes, detailsLines } from './credits.js';
import { icon } from './icons.js';
import { bpmLabel } from './bpm-label.js';
import { visibleTags, tagGroups, tagLabel } from './tagname.js';
import { serviceIcons } from './service-icons.js';
import { storedLinkStates } from './song-links.js';
import { toggleQueue } from './queue-toggle.js';
import { openShareDialog } from './share-ui.js';

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
  const { title, remix } = creditParts(song);
  return {
    title,
    remix,
    sub: subtitle(song),
    album: String(song?.album ?? '').trim(),
    groups: cardTags(song?.tags),
    remixYear: !isStructured(song) && Number.isInteger(song?.remix_year) ? `Remix year ${song.remix_year}` : '',
    details: detailsLines(song).map(({ label, value }) => (label === 'Cover of' ? `Cover of ${value}` : `${label}: ${value}`)),
    bpm: bpmLabel(song?.bpm),
    duration: song?.duration ? fmtTime(song.duration) : '',
    links: storedLinkStates(song),
    download: downloadText(song, view),
  };
}

export function playControl(song, { queueable }) {
  return queueable ? { label: 'Play now', run: () => player.playNow(song.id) } : null;
}

function headBlock(song, m) {
  const title = el('h2', { id: 'song-card-title', class: 't-title' }, titleNodes(song));
  const sub = m.sub ? el('p', { class: 'card-sub t-subhead' }, m.sub) : null;
  const album = m.album ? el('p', { class: 'card-album muted t-subhead' }, m.album) : null;
  if (!song.cover) return [el('div', { class: 'card-head' }, title, sub, album)];
  const img = el('img', { class: 'cover card-cover', alt: '', src: api.coverUrl(song.id, song.cover_v) });
  const art = el('div', { class: 'card-art' }, img, el('div', { class: 'cover-text' }, title, sub));
  img.addEventListener('error', () => { img.removeAttribute('src'); art.classList.add('noart'); });
  return [art, album ? el('div', { class: 'card-head' }, album) : null];
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

function actionRow(song) {
  const audio = hasAudio(song);
  const queueable = audio || autoDownloadOn();
  const play = playControl(song, { queueable });
  const queued = player.inQueue(song.id);
  const view = autodl.view(song.id);
  const link = sourceLink(song);
  const btn = (label, run, cls = 'btn outline') => el('button', { class: cls, type: 'button', onclick: run }, label);
  const ib = (label, name, run, cls = 'icon round') => el('button', { class: cls, type: 'button', title: label, 'aria-label': label, onclick: run }, icon(name, 'nav'));
  const dl = audio && can('download') ? ib('Download', 'download', () => downloadSong(song))
    : !audio && can('fetch') && (view.kind === 'none' || view.kind === 'failed') ? ib('Download to server', 'download', () => autodl.request([song.id], { front: true })) : null;
  const icons = [
    play ? ib(play.label, 'play', play.run, 'key lit') : null,
    ib('Share link', 'share', () => openShareDialog(song)),
    dl,
    can('edit') ? ib('Edit', 'pencil', () => editDialog(song)) : null,
    queueable ? (queued ? ib('Remove from playlist', 'playlistRemove', () => toggleQueue(song)) : ib('Add to playlist', 'playlistAdd', () => toggleQueue(song))) : null,
  ].filter(Boolean);
  return el('div', { class: 'card-actions' },
    icons.length ? el('div', { class: 'card-icons' }, ...icons) : null,
    !audio && !can('fetch') && link ? btn(link.label, () => window.open(link.url, '_blank', 'noopener')) : null);
}

const SIDE_KEYS = ['country'];

function sideBlock(m) {
  const row = (label, ...vals) => el('div', { class: 'side-row' }, el('span', { class: 'group-name t-caption' }, label), el('span', { class: 'side-val t-caption' }, ...vals));
  const tagRow = (g) => row(g.name, ...g.tags.map((t) => el('span', { class: 'tag ns t-caption', title: t.tag }, t.label)));
  return el('div', { class: 'card-side' },
    ...m.groups.filter((g) => SIDE_KEYS.includes(g.key)).map(tagRow),
    m.bpm ? row('BPM', el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)' }, m.bpm, el('small', { 'aria-hidden': 'true' }, 'BPM'))) : null,
    m.duration ? row('Time', m.duration) : null,
    m.remixYear ? row('Remix year', el('span', { class: 'remix-year' }, m.remixYear)) : null,
    row('Status', m.download));
}

function paint(dlg, song, close, m) {
  const [art, head] = headBlock(song, m);
  const side = sideBlock(m);
  const rest = m.groups.filter((g) => g.key !== 'decade' && !SIDE_KEYS.includes(g.key));
  const parts = [
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    el('div', { class: 'dlg-head card-bar' }, el('span'), el('button', { type: 'button', class: 'link-btn t-headline card-close', onclick: close }, 'Close')),
    art ? el('div', { class: 'card-top' }, art, side) : null,
    head,
    art ? null : side,
    tagBlock(rest),
    m.details.length ? el('p', { class: 'facts t-caption card-details' }, ...m.details.map((d) => el('span', {}, d))) : null,
    linkBlock(m.links),
    actionRow(song),
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
  (dlg.querySelector('.card-actions button') || dlg.querySelector('.card-close'))?.focus();
}
