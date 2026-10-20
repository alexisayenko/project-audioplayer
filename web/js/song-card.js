import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, fmtTime, toast } from './dom.js';
import { hasAudio, sourceLink } from './playable.js';
import { can, isGuest } from './guest.js';
import { cachedListening, getListening, hasListening, listeningRows, formatTotal, formatDay, WINDOWS } from './listening-stats.js';
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
import { lineParts, partInfo } from './part-info.js';
import { togglePartPopover, closePartPopover, initPartPopovers } from './part-popover.js';
import { prefs } from './library-data.js';
import * as audioGraph from './audio-graph.js';
import { createLiveBpmController } from './live-bpm-ctl.js';

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

function filterByArtist(name) {
  prefs.query = name;
  prefs.sel.clear();
  document.getElementById('song-card')?.close();
  if (/^#?\/?(library)?$/.test(location.hash)) window.dispatchEvent(new Event('hashchange'));
  else location.hash = '#/library';
}

function partNodes(song, line) {
  const parts = lineParts(song);
  if (parts.map((p) => p.text).join('') !== line) return [line];
  return parts.map((p) => {
    if (p.kind === 'text') return document.createTextNode(p.text);
    const btn = el('button', { type: 'button', class: `tp-part tp-${p.kind}`, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, p.text);
    btn.onclick = () => {
      const info = partInfo(song, p);
      togglePartPopover(btn, { ...info, filter: info.filter ? { run: () => filterByArtist(info.filter) } : null });
    };
    return btn;
  });
}

function fullRow(line, song) {
  const copy = el('button', { type: 'button', class: 'icon round card-copy', title: 'Copy title', 'aria-label': 'Copy title' }, icon('copy', 'nav'));
  const note = el('span', { class: 'card-copy-note muted t-caption', role: 'status', 'aria-live': 'polite' });
  let timer = 0;
  copy.onclick = async () => {
    const ok = await copyText(line);
    note.textContent = ok ? 'Title copied' : 'Could not copy the title';
    if (ok) copy.replaceChildren(icon('check', 'nav'));
    clearTimeout(timer);
    timer = setTimeout(() => {
      note.textContent = '';
      copy.replaceChildren(icon('copy', 'nav'));
    }, 1800);
  };
  const nodes = partNodes(song, line);
  if (typeof nodes[0] === 'string') {
    const at = line.search(/\S+$/);
    nodes.splice(0, 1, line.slice(0, at), line.slice(at));
  }
  const glued = (n) => !/^\s|\s$/.test(typeof n === 'string' ? n : n.textContent || 'x');
  let from = nodes.length;
  while (from > 0 && glued(nodes[from - 1])) from -= 1;
  if (from === nodes.length) from -= 1;
  const tail = el('span', { class: 'card-full-tail' }, ...nodes.slice(from), copy);
  return el('div', { class: 'card-full-row' }, el('p', { class: 'card-full muted t-subhead' }, ...nodes.slice(0, from), tail), note);
}

function headBlock(song, m) {
  const title = el('h2', { id: 'song-card-title', class: 't-title' }, titleNodes(song));
  const sub = m.sub ? el('p', { class: 'card-sub t-subhead' }, m.sub) : null;
  const full = m.full ? fullRow(m.full, song) : null;
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

function downloadIcon(song, audio, view, ib) {
  if (audio) return can('download') ? ib('Download', 'download', () => downloadSong(song)) : null;
  const fetchable = can('fetch') && (view.kind === 'none' || view.kind === 'failed');
  return fetchable ? ib('Download to server', 'download', () => autodl.request([song.id], { front: true })) : null;
}

function actionRow(song) {
  const audio = hasAudio(song);
  const queueable = audio || autoDownloadOn();
  const queued = player.inQueue(song.id);
  const view = autodl.view(song.id);
  const link = sourceLink(song);
  const btn = (label, run, cls = 'btn outline') => el('button', { class: cls, type: 'button', onclick: run }, label);
  const ib = (label, name, run, cls = 'icon round') => el('button', { class: cls, type: 'button', title: label, 'aria-label': label, onclick: run }, icon(name, 'nav'));
  const qp = queued ? player.queuePosition(song.id) : null;
  const plLabel = queued ? `In playlist${qp ? `, position ${qp.pos} of ${qp.total}` : ''} - click to remove` : 'Add to playlist';
  const icons = [
    queueable ? ib('Play next', 'playPlus', () => playNextInQueue(song)) : null,
    queueable ? el('button', { class: `icon round pl-toggle${queued ? ' on' : ''}`, type: 'button', title: plLabel, 'aria-label': plLabel, 'aria-pressed': String(queued), onclick: () => toggleQueue(song) }, icon(queued ? 'playlist' : 'listAdd', 'nav')) : null,
    ib('Share link', 'share', () => openShareDialog(song)),
    downloadIcon(song, audio, view, ib),
    can('edit') ? ib('Edit', 'pencil', () => editDialog(song)) : null,
  ].filter(Boolean);
  return el('div', { class: 'card-actions' },
    icons.length ? el('div', { class: 'card-icons' }, ...icons) : null,
    !audio && !can('fetch') && link ? btn(link.label, () => window.open(link.url, '_blank', 'noopener')) : null);
}

const SIDE_KEYS = new Set(['country']);

function albumsLabel(albums) {
  return albums.length === 1 ? 'Album' : 'Albums';
}

let liveCtl = null;

export function liveBpm() {
  if (!liveCtl) {
    liveCtl = createLiveBpmController({
      audio: document.getElementById('audio'),
      player,
      getAnalyser: () => audioGraph.getAnalyser(),
      getSampleRate: () => audioGraph.getContext()?.sampleRate,
    });
  }
  return liveCtl;
}

export function resetLiveBpmForTests() {
  liveCtl?.dispose();
  liveCtl = null;
}

function bpmView(stored, songId) {
  const ctl = liveBpm();
  if (!ctl.on) return { text: stored, label: `BPM ${stored}`, on: false };
  const live = player.current?.id === songId ? ctl.value : null;
  return { text: live === null ? `~${stored}` : String(live), label: live === null ? `Live BPM, about ${stored}` : `Live BPM ${live}`, on: true };
}

function paintBpmBadge(btn) {
  const v = bpmView(btn.getAttribute('data-stored'), btn.getAttribute('data-id'));
  btn.firstChild.data = v.text;
  btn.setAttribute('aria-pressed', String(v.on));
  btn.setAttribute('aria-label', v.label);
  btn.title = v.on ? 'Live BPM measured while the song plays (click for the stored value)' : 'Stored BPM (click to measure live while playing)';
  btn.classList.toggle('on', v.on);
}

function bpmBadge(stored, songId) {
  const btn = el('button', { class: 'bpm-badge bpm-toggle', type: 'button', 'data-stored': stored, 'data-id': songId, onclick: () => liveBpm().setOn(!liveBpm().on) }, stored, el('small', { 'aria-hidden': 'true' }, 'BPM'));
  paintBpmBadge(btn);
  return btn;
}

function detailsBlock(m, songId) {
  const tagChip = (t) => el('span', { class: 'tag ns t-caption', title: t.tag }, t.label);
  const items = [
    ...m.groups.filter((g) => SIDE_KEYS.has(g.key)).map((g) => el('span', { class: 'detail' }, `${g.name}: `, ...g.tags.map(tagChip))),
    m.bpm ? el('span', { class: 'detail' }, bpmBadge(m.bpm, songId)) : null,
    m.duration ? el('span', { class: 'detail' }, `Length: ${m.duration}`) : null,
    m.yearFact ? el('span', { class: 'detail' }, `Year: ${m.yearFact}`) : null,
    ...m.details.map((d) => el('span', { class: 'detail' }, d)),
    m.albums.length ? el('span', { class: 'detail' }, `${albumsLabel(m.albums)}: ${m.albums.join(', ')}`) : null,
  ].filter(Boolean);
  return items.length ? el('p', { class: 'facts t-caption card-details' }, ...items) : null;
}

export function listeningNode(entry) {
  if (!hasListening(entry)) return el('p', { class: 'card-listen-none muted t-caption' }, 'Not listened yet');
  const head = el('tr', {}, el('td', {}), ...WINDOWS.map(([, label]) => el('th', { scope: 'col' }, label)));
  const body = listeningRows(entry).map((r) => el('tr', {}, el('th', { scope: 'row' }, r.label), ...r.cells.map((c) => el('td', {}, c))));
  const last = entry.last_listened ? el('span', { class: 'detail' }, `Last listened: ${formatDay(entry.last_listened)}`) : null;
  return el('div', {},
    el('table', { class: 'card-listen-table t-caption' }, el('thead', {}, head), el('tbody', {}, ...body)),
    el('p', { class: 'facts t-caption' }, el('span', { class: 'detail' }, `Total listened: ${formatTotal(entry.total_listened_s)}`), last));
}

function listeningBlock(songId) {
  if (isGuest()) return null;
  const box = el('section', { class: 'card-listen', 'aria-label': 'Listening' }, el('h3', { class: 'card-listen-title t-caption muted' }, 'Listening'));
  const body = el('div', { class: 'card-listen-body' });
  box.append(body);
  const show = (songs) => body.replaceChildren(listeningNode(songs[songId]));
  const seen = cachedListening();
  if (seen) show(seen);
  getListening().then(show, () => { if (!seen) box.remove(); });
  return box;
}

function paint(dlg, song, close, m) {
  closePartPopover();
  const [art, head] = headBlock(song, m);
  const rest = m.groups.filter((g) => !SIDE_KEYS.has(g.key));
  const closeBtn = el('button', { type: 'button', class: 'card-close', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('clear', 'nav'));
  if (art.classList.contains('card-art')) art.append(closeBtn);
  const parts = [
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    art.classList.contains('card-art') ? null : closeBtn,
    art,
    head,
    detailsBlock(m, song.id),
    tagBlock(rest, m.genreLines),
    linkBlock(m.links),
    listeningBlock(song.id),
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
    const sig = [hasAudio(fresh), autodl.view(id).kind, player.current?.id === id, player.playing, player.inQueue(id), JSON.stringify(player.queuePosition(id)), autoDownloadOn()].join('|');
    if (force !== true && sig === last) return;
    last = sig;
    repaint(dlg, fresh, close);
  };
  const paintBadges = () => { for (const b of dlg.querySelectorAll('.bpm-toggle')) paintBpmBadge(b); };
  const unsubs = [store.subscribe(() => render(true)), player.onChange(render), autodl.onChange(render), liveBpm().onChange(paintBadges)];
  initPartPopovers();
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => {
    live = false;
    closePartPopover();
    for (const u of unsubs) u();
    dlg.replaceChildren();
    focusRow(id, opener);
  }, { once: true });
  render(true);
  if (!cachedTree()) loadGenreTree().then((t) => { if (t && live) render(true); });
  if (!dlg.open) dlg.showModal();
  dlg.focus();
}
