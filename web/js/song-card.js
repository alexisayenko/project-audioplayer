import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, fmtTime, toast } from './dom.js';
import { hasAudio, sourceLink } from './playable.js';
import { can } from './guest.js';
import { autodl, autoDownloadOn } from './autodl.js';
import { downloadSong } from './download.js';
import { editDialog } from './edit-dialog.js';
import { creditParts, subtitle, titleNodes, detailsLines, yearFact, albumOf, albumsOf, displayLine } from './credits.js';
import { icon } from './icons.js';
import { bpmLabel } from './bpm-label.js';
import { visibleTags, tagGroups, tagLabel, splitTag } from './tagname.js';
import { genreLines } from './genre-levels.js';
import { cachedTree, loadGenreTree } from './genre-tree.js';
import { serviceIcons } from './service-icons.js';
import { storedLinkStates } from './song-links.js';
import { toggleQueue, playNextInQueue } from './queue-toggle.js';
import { openShareDialog, copyText } from './share-ui.js';

export function cardTags(tags) {
  const counts = visibleTags(tags).map((tag) => ({ tag, count: 1 }));
  return tagGroups(counts).map((g) => ({ key: g.key, name: g.name, tags: g.tags.map((t) => ({ tag: t.tag, label: tagLabel(t.tag) })) }));
}

const HIDDEN_DETAILS = new Set(['Version', 'Version name', 'Remix year', 'First released']);

export function cardModel(song) {
  const { title, remix } = creditParts(song);
  const groups = cardTags(song?.tags);
  const genres = (groups.find((g) => g.key === 'genre')?.tags || []).map((t) => splitTag(t.tag).value);
  return {
    title,
    remix,
    sub: subtitle(song),
    album: albumOf(song),
    full: displayLine(song),
    groups,
    genreLines: genreLines(cachedTree(), genres),
    yearFact: yearFact(song),
    details: detailsLines(song).filter(({ label }) => !HIDDEN_DETAILS.has(label)).map(({ label, value }) => (label === 'Cover of' ? `Cover of ${value}` : `${label}: ${value}`)),
    albums: albumsOf(song),
    bpm: bpmLabel(song?.bpm),
    duration: song?.duration ? fmtTime(song.duration) : '',
    links: storedLinkStates(song),
  };
}

function fullRow(line) {
  const copy = el('button', {
    type: 'button',
    class: 'link-btn card-copy',
    title: 'Copy title',
    'aria-label': 'Copy title',
    onclick: async () => toast((await copyText(line)) ? 'Title copied' : 'Could not copy the title'),
  }, 'Copy');
  return el('div', { class: 'card-full-row' }, el('p', { class: 'card-full muted t-subhead' }, line), copy);
}

function headBlock(song, m) {
  const title = el('h2', { id: 'song-card-title', class: 't-title' }, titleNodes(song));
  const sub = m.sub ? el('p', { class: 'card-sub t-subhead' }, m.sub) : null;
  const full = m.full ? fullRow(m.full) : null;
  if (!song.cover) return [el('div', { class: 'card-head' }, title, sub, full)];
  const img = el('img', { class: 'cover card-cover', alt: '', src: api.coverUrl(song.id, song.cover_v) });
  const art = el('div', { class: 'card-art' }, img, el('div', { class: 'cover-text' }, title, sub));
  img.addEventListener('error', () => { img.removeAttribute('src'); art.classList.add('noart'); });
  return [art, full ? el('div', { class: 'card-head' }, full) : null];
}

function genreRows(name, lines) {
  return lines.map((line, i) => el('div', { class: 'chip-group card-genre-line' },
    el('span', { class: 'group-name t-caption', 'aria-hidden': i ? 'true' : null }, i ? '' : name),
    line.genres.map((g) => el('span', { class: 'tag ns t-caption', title: `genre:${g}` }, g))));
}

function tagBlock(groups, lines) {
  if (!groups.length) return null;
  return el('div', { class: 'chip-groups card-tags' }, groups.flatMap((g) => (g.key === 'genre' ? genreRows(g.name, lines) : [el('div', { class: 'chip-group' },
    el('span', { class: 'group-name t-caption' }, g.name),
    g.tags.map((t) => el('span', { class: 'tag ns t-caption', title: t.tag }, t.label)))])));
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
  const queued = player.inQueue(song.id);
  const view = autodl.view(song.id);
  const link = sourceLink(song);
  const btn = (label, run, cls = 'btn outline') => el('button', { class: cls, type: 'button', onclick: run }, label);
  const ib = (label, name, run, cls = 'icon round') => el('button', { class: cls, type: 'button', title: label, 'aria-label': label, onclick: run }, icon(name, 'nav'));
  const dl = audio && can('download') ? ib('Download', 'download', () => downloadSong(song))
    : !audio && can('fetch') && (view.kind === 'none' || view.kind === 'failed') ? ib('Download to server', 'download', () => autodl.request([song.id], { front: true })) : null;
  const icons = [
    queueable ? ib('Play next', 'playPlus', () => playNextInQueue(song)) : null,
    queueable ? el('button', { class: `icon round pl-toggle${queued ? ' on' : ''}`, type: 'button', title: queued ? 'In playlist - click to remove' : 'Add to playlist', 'aria-label': queued ? 'In playlist - click to remove' : 'Add to playlist', 'aria-pressed': String(queued), onclick: () => toggleQueue(song) }, icon('listAdd', 'nav')) : null,
    ib('Share link', 'share', () => openShareDialog(song)),
    dl,
    can('edit') ? ib('Edit', 'pencil', () => editDialog(song)) : null,
  ].filter(Boolean);
  return el('div', { class: 'card-actions' },
    icons.length ? el('div', { class: 'card-icons' }, ...icons) : null,
    !audio && !can('fetch') && link ? btn(link.label, () => window.open(link.url, '_blank', 'noopener')) : null);
}

const SIDE_KEYS = ['country'];

function detailsBlock(m) {
  const tagChip = (t) => el('span', { class: 'tag ns t-caption', title: t.tag }, t.label);
  const items = [
    ...m.groups.filter((g) => SIDE_KEYS.includes(g.key)).map((g) => el('span', { class: 'detail' }, `${g.name}: `, ...g.tags.map(tagChip))),
    m.bpm ? el('span', { class: 'detail' }, el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)' }, m.bpm, el('small', { 'aria-hidden': 'true' }, 'BPM'))) : null,
    m.duration ? el('span', { class: 'detail' }, `Length: ${m.duration}`) : null,
    m.yearFact ? el('span', { class: 'detail' }, `Year: ${m.yearFact}`) : null,
    ...m.details.map((d) => el('span', { class: 'detail' }, d)),
    m.albums.length ? el('span', { class: 'detail' }, `${m.albums.length === 1 ? 'Album' : 'Albums'}: ${m.albums.join(', ')}`) : null,
  ].filter(Boolean);
  return items.length ? el('p', { class: 'facts t-caption card-details' }, ...items) : null;
}

function paint(dlg, song, close, m) {
  const [art, head] = headBlock(song, m);
  const rest = m.groups.filter((g) => !SIDE_KEYS.includes(g.key));
  const parts = [
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    el('div', { class: 'dlg-head card-bar' }, el('span'), el('button', { type: 'button', class: 'link-btn t-headline card-close', onclick: close }, 'Close')),
    art,
    head,
    detailsBlock(m),
    tagBlock(rest, m.genreLines),
    linkBlock(m.links),
    actionRow(song),
  ];
  dlg.replaceChildren(...parts.filter(Boolean));
}

const actionButtons = (dlg) => [...dlg.querySelectorAll('.card-actions button')];

function repaint(dlg, song, close) {
  const m = cardModel(song);
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
  dlg.setAttribute('tabindex', '-1');
  let last = '';
  let live = true;
  const render = (force) => {
    const fresh = store.get(id);
    if (!fresh) { close(); return; }
    const sig = [hasAudio(fresh), autodl.view(id).kind, player.current?.id === id, player.playing, player.inQueue(id), autoDownloadOn()].join('|');
    if (force !== true && sig === last) return;
    last = sig;
    repaint(dlg, fresh, close);
  };
  const unsubs = [store.subscribe(() => render(true)), player.onChange(render), autodl.onChange(render)];
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => {
    live = false;
    for (const u of unsubs) u();
    dlg.replaceChildren();
    focusRow(id, opener);
  }, { once: true });
  render(true);
  if (!cachedTree()) loadGenreTree().then((t) => { if (t && live) render(true); });
  if (!dlg.open) dlg.showModal();
  dlg.focus();
}
