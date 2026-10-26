import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { chipField } from './chip-field.js';
import { serviceIcons } from './service-icons.js';
import { can } from './guest.js';
import { playlistsOn } from './playlists-store.js';
import { openPlaylistPicker } from './lazy-ui.js';
import { el, fmtTime, plural, toast } from './dom.js';
import { icon } from './icons.js';
import { genreChip } from './genre-chip.js';
import { loadGenreTree } from './genre-tree.js';
import { songMatches } from './song-match.js';
import { playlistLink, MIX_MESSAGE, PRIVATE_MESSAGE } from './playlist-link.js';
import { startDownloads, mountDownloadStatus } from './albums-youtube.js';
import { dialogHead } from './edit-dialog.js';
import { artistLine, titleLine, displayLine, albumsOf, albumOf, releasedYear } from './credits.js';
import { openPlDialog, closePlDialog } from './playlist-dialogs.js';
import { searchBox } from './search-box.js';
import { isRowControl, coverModel, coverButton, paintCover } from './row-cover.js';
import { openFilterSheet, openSongCard } from './lazy-ui.js';
import { marquee } from './marquee.js';
import { hasAudio } from './playable.js';
import { autoDownloadOn } from './autodl.js';
import { cachedTree } from './genre-tree.js';
import { prefs, savePrefs } from './library-data.js';
import { addAllToQueue, playAll } from './play-all.js';
import { scrollTarget } from './reveal.js';
import { ROW_FLASH_MS } from './constants.js';
import { countOf, totalTime, bpmRange, FACETS, facetValues, matchesFacets, matchesQuery, ALBUM_SORTS, albumPrefs, sortedAlbums, saveAlbumPrefs } from './albums-model.js';

export { totalTime, bpmRange, facetValues, matchesFacets };

export const albumIdOf = (hash) => {
  const m = /^#\/library\/albums\/([^/?#]+)$/.exec(hash || '');
  return m ? decodeURIComponent(m[1]) : '';
};

export function fetchErrorText(ex) {
  if (ex.status === 400 || ex.code === 'bad_url') return 'This is not a Discogs release link. Paste an address like discogs.com/release/545650-Derango-Tumult.';
  if (ex.status === 404 || ex.code === 'not_found') return 'Discogs has no release at this address.';
  if (ex.status === 503 || ex.code === 'discogs_unavailable') return 'Discogs is not available right now. Try again later.';
  return ex.message || 'The release could not be fetched.';
}

export const headline = (a) => [`${a.artist} - ${a.title}`, a.year].filter(Boolean).join(' · ');
export function albumHead(a, tag = 'span', onName = null) {
  const n = countOf(a);
  const time = totalTime(a.tracks);
  const bpm = bpmRange(a.tracks);
  const genres = Array.isArray(a.genres) ? a.genres.filter(Boolean) : [];
  return el('div', { class: 'album-head' },
    el('div', { class: 'album-head-row' },
      el('div', { class: 'album-head-text' },
        el(tag, { class: 'album-title t-headline' },
          onName ? el('button', { class: 'album-name-btn', type: 'button', title: 'Album info', onclick: (e) => onName(e.currentTarget) }, a.title) : a.title,
          ` · ${n} ${plural(n, 'track', 'tracks')}`),
        el('span', { class: 'album-sub muted t-subhead' }, [a.artist, a.year].filter(Boolean).join(' · '))),
      el('div', { class: 'album-facts muted t-caption' },
        time ? el('span', { class: 'album-time' }, time) : null,
        bpm ? el('span', { class: 'album-bpm' }, bpm) : null)),
    genres.length ? el('div', { class: 'chips album-genres' }, genres.map((g) => el('span', { class: 'chip tint' }, g))) : null);
}

const lengthText =(s) => (Number.isFinite(s) && s >= 0 ? fmtTime(s) : '');
const trackLine = (t) => el('li', { class: 'album-track' },
  el('span', { class: 'album-no muted t-caption' }, t.no),
  el('span', { class: 'album-name t-subhead' }, t.title),
  el('span', { class: 'album-len muted t-caption' }, lengthText(t.durationS)));
const trackList = (tracks) => el('ol', { class: 'album-tracks' }, tracks.map(trackLine));

const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);

export const LINK_KEYS = [
  { key: 'discogs', label: 'Discogs', placeholder: 'https://www.discogs.com/release/...' },
  { key: 'rateyourmusic', label: 'Rate Your Music', placeholder: 'https://rateyourmusic.com/release/album/...' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://www.youtube.com/playlist?list=...' },
  { key: 'wikipedia', label: 'Wikipedia', placeholder: 'https://en.wikipedia.org/wiki/...' },
];

export function albumLinks(a) {
  const stored = a?.links && typeof a.links === 'object' ? a.links : {};
  const out = {};
  for (const { key } of LINK_KEYS) {
    let url = httpUrl(stored[key]);
    if (!url && key === 'discogs' && !('discogs' in stored)) {
      const src = a?.source;
      const raw = typeof src === 'string' ? src : src?.url;
      url = httpUrl(raw);
      if (!url && typeof raw === 'string') {
        const m = /^discogs:(\d+)$/.exec(raw);
        if (m) url = `https://www.discogs.com/release/${m[1]}`;
      }
      if (url && !/^https?:\/\/([a-z0-9-]+\.)*discogs\.com\//i.test(url)) url = null;
    }
    if (!url && key === 'rateyourmusic' && !('rateyourmusic' in stored)) url = httpUrl(a?.rymUrl);
    if (url) out[key] = url;
  }
  return out;
}

export function albumFacts(a) {
  const n = countOf(a);
  const bpm = bpmRange(a.tracks);
  return [`${n} ${plural(n, 'track', 'tracks')}`, bpm, totalTime(a.tracks), a.year ? String(a.year) : ''].filter(Boolean).join(' · ');
}

export const linkErrorText = (label) => `This is not a valid ${label} address.`;

const linkIconRow = (links) => {
  const row = serviceIcons({ onlyOn: true });
  const { rateyourmusic, ...std } = links;
  row.setState(Object.fromEntries(Object.entries(std).map(([k, url]) => [k, { on: true, url }])));
  if (rateyourmusic) {
    row.node.append(el('a', { class: 'svc svc-rateyourmusic on', href: rateyourmusic, target: '_blank', rel: 'noopener', title: 'Rate Your Music', 'aria-label': 'Rate Your Music' }, icon('srcRym', 'nav')));
  }
  return row.node;
};

export function mergeLinks(prev, next) {
  const links = { ...(next.links || {}) };
  for (const { key } of LINK_KEYS) if (links[key] === undefined && prev.links?.[key]) links[key] = prev.links[key];
  return { ...next, links };
}

function linkFields(album) {
  const have = albumLinks(album);
  return LINK_KEYS.map(({ key, label, placeholder }) => {
    const input = el('input', { type: 'text', class: 'album-link-input', placeholder, 'aria-label': label, 'data-key': key, autocomplete: 'off', inputMode: 'url', value: have[key] || '' });
    const err = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
    return { key, label, input, err, have: have[key] || '', node: el('div', { class: 'field album-link-field' }, el('label', { class: 't-caption muted' }, label), input, err) };
  });
}

const fold = (s) => String(s ?? '').normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();
const songLength = (s) => (Number.isFinite(s?.duration) && s.duration > 0 ? fmtTime(s.duration) : '-');

export function candidateMeta(s) {
  const year = releasedYear(s);
  return [artistLine(s), albumOf(s), year ? String(year) : ''].filter(Boolean).join(' · ');
}

const takenIds = (album, track) => new Set((album.tracks || []).filter((t) => t.no !== track.no && t.songId).map((t) => t.songId));

export function searchSongs(album, track, query, songs = store.songs) {
  const taken = takenIds(album, track);
  return songs.filter((s) => !taken.has(s.id) && songMatches(s, query));
}

export function linkCandidates(album, track, songs = store.songs) {
  const taken = takenIds(album, track);
  const title = fold(track.title);
  const artist = fold(album.artist);
  const albumName = fold(album.title);
  const scored = [];
  for (const s of songs) {
    if (taken.has(s.id)) continue;
    const titleEq = fold(titleLine(s)) === title || fold(s.title) === title;
    const who = fold(artistLine(s));
    const artistEq = !!artist && !!who && (who === artist || who.includes(artist) || artist.includes(who));
    const inAlbum = !!albumName && albumsOf(s).some((x) => fold(x) === albumName);
    if (!((titleEq && artistEq) || inAlbum)) continue;
    scored.push({ s, rank: (titleEq ? 0 : 4) + (artistEq ? 0 : 2) + (inAlbum ? 0 : 1) });
  }
  return scored.sort((a, b) => a.rank - b.rank || fold(a.s.title).localeCompare(fold(b.s.title))).map((x) => x.s);
}

function openLinkPopup(album, track, onDone) {
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const slot = el('div', { class: 'album-link-results' });
  const pick = async (s, buttons) => {
    err.hidden = true;
    for (const b of buttons) b.disabled = true;
    try {
      const full = await api.linkTrack(album.id, track.no, s.id);
      closePlDialog();
      onDone(full);
    } catch (ex) {
      err.textContent = ex.status === 409 || ex.code === 'already_linked' ? 'This track is already linked.' : ex.message;
      err.hidden = false;
      for (const b of buttons) b.disabled = false;
    }
  };
  const paintList = (query) => {
    const text = query.trim();
    const list = text ? searchSongs(album, track, text) : linkCandidates(album, track);
    const buttons = [];
    slot.replaceChildren(list.length
      ? el('ul', { class: 'songs album-link-list' }, list.map((s) => {
        const full = titleLine(s);
        const meta = candidateMeta(s);
        const b = el('button', { class: 'open t-headline', type: 'button', title: [full, meta].filter(Boolean).join(' - '), onclick: () => pick(s, buttons) }, full);
        buttons.push(b);
        const row = el('li', { class: `song album-link-row${player.current?.id === s.id ? ' current' : ''}`, 'data-id': s.id },
          el('div', { class: 'info' },
            el('div', { class: 'title-line' }, b, el('span', { class: 'title-len t-time', title: 'Length' }, songLength(s))),
            el('div', { class: 'sub-line' }, el('span', { class: 'sub t-subhead' }, meta))));
        row.addEventListener('click', (e) => { if (e.target !== b && !b.disabled) b.click(); });
        return row;
      }))
      : el('p', { class: 'muted t-subhead' }, 'No matching songs in your library'));
  };
  const search = searchBox({ placeholder: 'Search your songs', label: 'Search your songs', onChange: paintList });
  paintList('');
  const sub = `${track.no}. ${track.title}${Number.isFinite(track.durationS) ? ` (${lengthText(track.durationS)})` : ''}`;
  openPlDialog('Link song', dialogHead('Link song', sub, closePlDialog), search.node, err, slot);
}

const bpmNumbers = (tracks) => bpmRange(tracks).replace(/ bpm$/, '');

function albumDetails(a) {
  const bpm = bpmNumbers(a.tracks);
  const time = totalTime(a.tracks);
  const n = countOf(a);
  const items = [
    bpm ? el('span', { class: 'detail' }, el('span', { class: 'bpm-badge', title: 'Beats per minute (estimated)', 'aria-label': `BPM ${bpm}` }, bpm, el('small', { 'aria-hidden': 'true' }, 'BPM'))) : null,
    n ? el('span', { class: 'detail' }, `Tracks: ${n}`) : null,
    time ? el('span', { class: 'detail' }, `Length: ${time}`) : null,
  ].filter(Boolean);
  return items.length ? el('p', { class: 'facts t-caption card-details album-facts-line' }, ...items) : null;
}

export function openAlbumCard(album, opener = null) {
  const dlg = document.getElementById('song-card');
  const close = () => dlg.close();
  let cur = album;
  let buttons = null;

  let openNo = null;
  const rowKeys = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const rows = [...dlg.querySelectorAll('.album-row-btn')];
    const at = rows.indexOf(e.currentTarget);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    rows[next].focus();
  };
  const panelId = (t) => `album-panel-${cur.id}-${t.no}`;

  function setOpen(no) {
    openNo = openNo === no ? null : no;
    for (const li of dlg.querySelectorAll('.album-info-tracks li')) {
      const on = Number(li.dataset.no) === openNo;
      li.querySelector('.album-row-btn').setAttribute('aria-expanded', String(on));
      li.querySelector('.album-panel').hidden = !on;
      li.classList.toggle('open', on);
    }
  }

  function trackRow(t) {
    const linked = t.songId ? store.get(t.songId) : null;
    const on = openNo === t.no;
    let panel;
    if (t.songId) {
      const unlink = el('button', { type: 'button', class: 'icon sq-btn album-unlink', title: 'Unlink song', 'aria-label': `Unlink song from track ${t.no}`, onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { paint(await api.unlinkTrack(cur.id, t.no)); } catch (ex) { btn.disabled = false; toast(ex.message); }
      } }, icon('unlink', 'inline'));
      const name = linked
        ? el('button', { type: 'button', class: 'link-btn t-caption album-linked-name', title: 'Song info', onclick: (e) => { void openSongCard(linked, e.currentTarget); } }, displayLine(linked))
        : el('span', { class: 'album-linked-name' }, 'Linked song');
      const play = linked && hasAudio(linked)
        ? el('button', { type: 'button', class: 'icon sq-btn album-play', title: 'Play', 'aria-label': `Play: ${displayLine(linked)}`, onclick: () => player.playNow(linked.id) }, icon('play', 'inline'))
        : null;
      panel = el('span', { class: 'album-linked t-caption' }, name,
        el('span', { class: 'album-len muted' }, songLength(linked)), play, unlink);
    } else {
      panel = el('button', { type: 'button', class: 'link-btn t-caption album-link-btn', onclick: () => openLinkPopup(cur, t, paint) }, 'Link song');
    }
    const btn = el('button', { type: 'button', class: 'album-row-btn', 'aria-expanded': String(on), 'aria-controls': panelId(t), onclick: () => setOpen(t.no), onkeydown: rowKeys },
      el('span', { class: 'album-no muted t-caption' }, `${t.no}.`),
      el('span', { class: 'album-name t-subhead' }, t.title),
      el('span', { class: 'album-len muted t-caption' }, lengthText(t.durationS)));
    return el('li', { class: `album-track${on ? ' open' : ''}`, 'data-no': String(t.no) },
      btn, el('div', { class: 'album-panel', id: panelId(t), hidden: !on }, panel));
  }

  function paint(next) {
    if (next) { cur = next; window.dispatchEvent(new Event(ALBUMS_CHANGED)); }
    const closeBtn = el('button', { type: 'button', class: 'card-close', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('clear', 'nav'));
    const links = albumLinks(cur);
    const genres = Array.isArray(cur.genres) ? cur.genres.filter(Boolean) : [];
    const tracks = cur.tracks || [];
    const sub = [cur.artist, cur.year].filter(Boolean).join(' · ');
    buttons = albumButtons(cur, { box: true, onEdit: () => openAlbumEdit(cur, (full) => paint(mergeLinks(cur, full)), close) });
    dlg.replaceChildren(...[
      el('span', { class: 'grab', 'aria-hidden': 'true' }),
      closeBtn,
      el('div', { class: 'card-head album-card-head' },
        el('h2', { id: 'song-card-title', class: 't-title' }, cur.title),
        sub ? el('p', { class: 'card-sub t-subhead' }, sub) : null),
      albumDetails(cur),
      genres.length ? el('div', { class: 'chip-groups card-tags' }, el('div', { class: 'chip-groups', role: 'group', 'aria-label': 'Genres' },
        el('div', { class: 'chip-group card-genre-line' }, genres.map((g) => genreChip(g))))) : null,
      Object.keys(links).length ? el('div', { class: 'album-links' }, linkIconRow(links)) : null,
      buttons.all.length ? el('div', { class: 'card-actions album-card-actions' }, el('div', { class: 'card-icons' }, buttons.all)) : null,
      tracks.length ? el('ol', { class: 'album-tracks album-info-tracks' }, tracks.map(trackRow)) : null].filter(Boolean));
  }

  dlg.setAttribute('tabindex', '-1');
  paint();
  const off = player.onChange(() => buttons?.repaint());
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => { off(); dlg.replaceChildren(); if (opener?.isConnected) opener.focus(); }, { once: true });
  if (!dlg.open) dlg.showModal();
  dlg.focus();
  if (!cachedTree()) loadGenreTree().then((t) => { if (t && dlg.open && dlg.querySelector('.album-card-head')) paint(); });
}

export const GENRE_MAX = 20;

function genreTags(list) {
  const out = [];
  for (const g of list || []) {
    const t = `genre:${String(g).trim()}`;
    if (t.length > 6 && out.length < GENRE_MAX && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

function genreEditor(initial) {
  let tags = genreTags(initial);
  const subs = new Set();
  const notify = () => { for (const f of subs) f(); };
  const editor = {
    peek: () => tags,
    addTags(add) {
      tags = genreTags([...tags, ...add].map((t) => t.slice(6)));
      notify();
    },
    removeTag(t) { tags = tags.filter((x) => x !== t); notify(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
  const field = chipField('genre', editor, { cap: GENRE_MAX });
  notify();
  return { node: field.node, get: () => tags.map((t) => t.slice(6)), commit: field.commit };
}

const linkedIds = (a) => (a.tracks || []).filter((t) => t.songId).map((t) => t.songId);

function busy(ui, on) { for (const b of ui.buttons) b.disabled = on; }

async function deleteOnly(album, ui) {
  busy(ui, true);
  try {
    await api.deleteAlbum(album.id);
    ui.close();
    toast(`Deleted "${album.title}"`);
    window.dispatchEvent(new Event(ALBUMS_CHANGED));
    ui.onDone();
  } catch (ex) {
    ui.err.textContent = ex.message;
    ui.err.hidden = false;
    busy(ui, false);
  }
}

async function deleteWithSongs(album, ui) {
  const ids = linkedIds(album);
  busy(ui, true);
  ui.err.hidden = true;
  let done = 0;
  try {
    for (const id of ids) {
      try { await api.remove(id); } catch (ex) { if (ex.status !== 404) throw ex; } // NOSONAR songs go one at a time
      done += 1;
    }
  } catch (ex) {
    await store.refresh().catch(() => {});
    window.dispatchEvent(new Event(ALBUMS_CHANGED));
    ui.err.textContent = `Deleted ${done} of ${ids.length} songs: ${ex.message}`;
    ui.err.hidden = false;
    busy(ui, false);
    return;
  }
  try {
    await api.deleteAlbum(album.id);
  } catch (ex) {
    await store.refresh().catch(() => {});
    ui.err.textContent = `Deleted ${done} of ${ids.length} songs, but the album could not be removed: ${ex.message}`;
    ui.err.hidden = false;
    busy(ui, false);
    return;
  }
  await store.refresh().catch(() => {});
  ui.close();
  toast(`Deleted "${album.title}" and ${done} ${plural(done, 'song', 'songs')}`);
  window.dispatchEvent(new Event(ALBUMS_CHANGED));
  ui.onDone();
}

const withSongsText = (album) => {
  const n = linkedIds(album).length;
  return `Delete album '${album.title}' and ${n} ${plural(n, 'song', 'songs')} from your library? This cannot be undone.`;
};

function confirmDeleteAlbum(album, onDone) {
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete album');
  const form = el('form', { method: 'dialog' },
    dialogHead('Delete album?', album.title, closePlDialog),
    el('p', { class: 't-body' }, 'Your songs stay in the library.'),
    err,
    el('div', { class: 'row end' }, del));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void deleteOnly(album, { err, buttons: [del], close: closePlDialog, onDone });
  });
  openPlDialog('Delete album?', form);
  del.focus();
}

function confirmDeleteAlbumAndSongs(album, onDone) {
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete album and songs');
  const form = el('form', { method: 'dialog' },
    dialogHead('Delete album and its songs?', album.title, closePlDialog),
    el('p', { class: 't-body' }, withSongsText(album)),
    err,
    el('div', { class: 'row end' }, del));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void deleteWithSongs(album, { err, buttons: [del], close: closePlDialog, onDone });
  });
  openPlDialog('Delete album and its songs?', form);
  del.focus();
}

function plainDeleteButton(album, onDone) {
  return el('button', { class: 'btn danger small album-delete', type: 'button', onclick: () => confirmDeleteAlbum(album, onDone) }, icon('trash', 'inline'), 'Delete album');
}

function deleteWithSongsButton(album, onDone) {
  if (!linkedIds(album).length) return null;
  return el('button', { class: 'btn danger small album-delete-all', type: 'button', onclick: () => confirmDeleteAlbumAndSongs(album, onDone) },
    icon('trash', 'inline'), 'Delete album and its songs from the library');
}

function deleteStep(album, dlg, onDone) {
  const ids = linkedIds(album);
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const ui = { err, buttons: [], close: () => dlg.close(), onDone };
  const only = el('button', { type: 'button', class: 'btn danger album-delete', onclick: () => { void deleteOnly(album, ui); } }, 'Delete album');
  const both = ids.length ? el('button', { type: 'button', class: 'btn danger album-delete-all', onclick: () => { void deleteWithSongs(album, ui); } }, 'Delete album and its songs') : null;
  ui.buttons.push(only, ...(both ? [both] : []));
  dlg.replaceChildren(el('form', { method: 'dialog', class: 'album-delete-step' },
    dialogHead('Delete album?', album.title, () => dlg.close()),
    el('p', { class: 't-body' }, ids.length ? `Keep its ${ids.length} ${plural(ids.length, 'song', 'songs')} in the library, or delete them with the album. Deleting songs cannot be undone.` : 'Your songs stay in the library.'),
    err,
    el('div', { class: 'row end album-delete-choice' }, only, both)));
  only.focus();
}

export const EDIT_LABELS = { title: 'Title', artist: 'Artist', year: 'Year', genres: 'Genres' };

export function openAlbumEdit(album, onSaved, closeCard = () => {}) {
  const dlg = document.getElementById('edit-dialog');
  const close = () => dlg.close();
  const inputs = {
    title: el('input', { type: 'text', 'aria-label': 'Title', autocomplete: 'off', value: album.title || '' }),
    artist: el('input', { type: 'text', 'aria-label': 'Artist', autocomplete: 'off', value: album.artist || '' }),
    year: el('input', { type: 'text', 'aria-label': 'Year', inputMode: 'numeric', autocomplete: 'off', value: album.year ? String(album.year) : '' }),
  };
  const genres = genreEditor(album.genres);
  const links = linkFields(album);
  const errs = {};
  const field = (key) => {
    errs[key] = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
    return el('div', { class: 'field' }, el('label', {}, EDIT_LABELS[key]), inputs[key], errs[key]);
  };
  errs.genres = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
  const general = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const showErr = (key, text) => { const e = errs[key]; if (e) { e.textContent = text; e.hidden = false; } else { general.textContent = text; general.hidden = false; } };
  const save = el('button', { type: 'submit', class: 'btn primary glow' }, 'Save');
  const form = el('form', { method: 'dialog', class: 'album-edit' },
    dialogHead('Edit album', [album.artist, album.title].filter(Boolean).join(' - '), close),
    field('title'), field('artist'), field('year'),
    el('div', {}, genres.node, errs.genres),
    el('div', { class: 'album-edit-links' }, links.map((f) => f.node)),
    general,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn danger del-left', onclick: () => deleteStep(album, dlg, closeCard) }, 'Delete album'),
      save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    genres.commit();
    for (const x of [...Object.values(errs), ...links.map((f) => f.err)]) x.hidden = true;
    general.hidden = true;
    const body = {};
    const title = inputs.title.value.trim();
    if (!title) { showErr('title', 'Title is required.'); return; }
    if (title !== (album.title || '')) body.title = title;
    const artist = inputs.artist.value.trim();
    if (artist !== (album.artist || '')) body.artist = artist;
    const yearText = inputs.year.value.trim();
    if (yearText && !/^\d{1,4}$/.test(yearText)) { showErr('year', 'Year must be a whole number.'); return; }
    const year = yearText ? Number(yearText) : null;
    if (year !== (album.year || null)) body.year = year;
    const next = genres.get();
    if (JSON.stringify(next) !== JSON.stringify(album.genres || [])) body.genres = next;
    const changed = {};
    for (const f of links) {
      const v = f.input.value.trim();
      if (v !== f.have) changed[f.key] = v || null;
    }
    if (Object.keys(changed).length) body.links = changed;
    if (!Object.keys(body).length) { close(); return; }
    save.disabled = true;
    try {
      const full = await api.patchAlbum(album.id, body);
      close();
      toast('Saved');
      onSaved(full);
    } catch (ex) {
      const key = ex.data?.key ?? ex.data?.detail?.key;
      const bad = links.find((f) => f.key === key);
      if ((ex.status === 422 || ex.code === 'bad_link') && bad) { bad.err.textContent = linkErrorText(bad.label); bad.err.hidden = false; }
      else if ((ex.status === 422 || ex.code === 'bad_field') && EDIT_LABELS[key]) showErr(key, `This ${EDIT_LABELS[key].toLowerCase()} is not valid.`);
      else showErr('', ex.message);
      save.disabled = false;
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  inputs.title.focus();
  return dlg;
}

const loadFail = (retry) => el('div', { class: 'state card' },
  el('p', { class: 'msg error', role: 'alert' }, 'Albums could not be loaded. Check the connection and try again.'),
  el('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry'));

export const linkedSongs = (tracks) => (tracks || []).filter((t) => t.songId).map((t) => store.get(t.songId)).filter(Boolean);

function playAlbumNext(songs) {
  if (!player.current) { playAll(songs); return; }
  let n = 0;
  for (const s of [...songs].reverse()) {
    const r = player.playNext(s.id);
    if (r === 'next' || r === 'now') n += 1;
  }
  toast(n ? `Playing ${n} ${plural(n, 'song', 'songs')} next` : 'Not available to play');
}

const queuedOf = (songs) => songs.filter((s) => player.inQueue(s.id)).length;

function paintQueue(btn, a, songs, box) {
  const n = queuedOf(songs);
  const all = songs.length > 0 && n === songs.length;
  const label = all ? 'Remove from queue' : 'Add to queue';
  let tip = 'Add to queue';
  if (all) tip = `In the queue, ${n} of ${songs.length} ${plural(songs.length, 'song', 'songs')}. Click to remove`;
  else if (n) tip = `${n} of ${songs.length} songs in the queue. Click to add the rest`;
  btn.classList.toggle('on', all);
  btn.title = tip;
  btn.setAttribute('aria-label', `${label}: ${a.title}`);
  btn.setAttribute('aria-pressed', String(all));
  btn.replaceChildren(icon(all ? 'playlist' : 'listAdd', box ? 'nav' : 'inline'));
}

export const playableSongs = (songs) => songs.filter((s) => hasAudio(s) || autoDownloadOn());

export function albumButtons(a, { box = false, onEdit = null } = {}) {
  const songs = playableSongs(linkedSongs(a.tracks));
  const make = (name, label, run, cls = '') => el('button', {
    class: `${box ? 'icon round' : 'icon sq-btn'} album-act ${cls}`.trim(), type: 'button',
    title: label, 'aria-label': `${label}: ${a.title}`, onclick: run,
  }, icon(name, box ? 'nav' : 'inline'));
  let queue = null;
  if (songs.length) {
    queue = make('listAdd', 'Add to queue', (e) => {
      e.stopPropagation();
      if (songs.length === queuedOf(songs)) {
        for (const s of songs) player.toggleInPlaylist(s.id);
        toast(`Removed ${songs.length} ${plural(songs.length, 'song', 'songs')} from queue`);
      } else addAllToQueue(songs);
      paintQueue(queue, a, songs, box);
    }, `act-queue album-queue${box ? ' pl-toggle' : ''}`);
    paintQueue(queue, a, songs, box);
  }
  const all = [
    box && songs.length ? make('play', 'Play album', () => playAll(songs), 'act-play') : null,
    box && songs.length ? make('playPlus', 'Play next', () => playAlbumNext(songs), 'act-next') : null,
    queue,
    songs.length && playlistsOn() ? make('playlistPlus', 'Add to playlist...', (e) => { void openPlaylistPicker(songs, e.currentTarget); }, 'act-pl') : null,
    can('edit') && onEdit ? el('button', { class: 'icon round album-act act-edit', type: 'button', title: 'Edit', 'aria-label': `Edit: ${a.title}`, onclick: onEdit }, icon('pencil', 'nav')) : null,
  ].filter(Boolean);
  return { queue, all, repaint: () => { if (queue) paintQueue(queue, a, songs, box); } };
}

const rowPaints = new WeakMap();

function albumRow(a) {
  const n = countOf(a);
  const time = totalTime(a.tracks);
  const bpm = bpmNumbers(a.tracks);
  const genres = Array.isArray(a.genres) ? a.genres.filter(Boolean) : [];
  const genreLine = genres.join(', ');
  const linked = linkedSongs(a.tracks);
  const songs = playableSongs(linked);
  const ids = new Set(linked.map((s) => s.id));
  const { queue, repaint } = albumButtons(a);
  const name = `album ${a.title}`;
  const hereNow = () => !!player.current && ids.has(player.current.id);
  const model = () => coverModel({ audio: true, queueable: songs.length > 0, here: hereNow(), playing: player.playing });
  const cover = coverButton(null, model(), name, { run: (action) => { if (action === 'pause' || action === 'resume') player.toggle(); else playAll(songs); } });
  const open = el('button', { class: 'open t-headline album-name-btn', type: 'button', title: 'Album info', 'aria-label': `Open: ${a.title}` },
    el('span', { class: 'ttl' }, a.title), ' ', el('span', { class: 'rmx' }, `· ${n} ${plural(n, 'track', 'tracks')}`));
  const row = el('li', { class: `song has-acts album-row${songs.length ? '' : ' unlinked'}`, 'data-id': a.id, 'data-songs': linked.map((s) => s.id).join(',') },
    el('div', { class: 'row-acts' }, queue),
    cover,
    el('div', { class: 'info album-text' },
      el('div', { class: 'title-line' }, open, time ? el('span', { class: 'title-len t-time album-time', title: 'Length' }, time) : null),
      el('div', { class: 'sub-line' },
        el('span', { class: 'sub t-subhead album-sub' }, [a.artist, a.year].filter(Boolean).join(' · ')),
        bpm ? el('span', { class: 'sub-end' }, el('span', { class: 'bpm-badge album-bpm', title: 'Beats per minute (estimated)', 'aria-label': `BPM ${bpm}` }, bpm, el('small', { 'aria-hidden': 'true' }, 'BPM'))) : null)),
    el('div', { class: 'c-genres t-subhead' }, el('span', { class: 'g-txt', title: genreLine || null }, genreLine)));
  let was = null;
  rowPaints.set(row, () => {
    const here = hereNow();
    row.classList.toggle('current', here);
    if (here) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    paintCover(cover, model(), name);
    repaint();
    if (here !== was) { was = here; marquee(open, { auto: here, host: row }); }
  });
  return row;
}

function paintCurrent(list) {
  for (const li of list.querySelectorAll('li.album-row')) rowPaints.get(li)?.();
}

export const ALBUMS_CHANGED = 'albums-changed';

const countOfList = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);

export function errorCode(ex) {
  const d = ex?.data?.detail;
  return ex?.code || (typeof d === 'string' ? d : d?.code) || '';
}

export function youtubeErrorText(ex) {
  const code = errorCode(ex);
  if (code === 'library_full_songs') return 'Your library is full. Remove some songs and try again.';
  if (code === 'bad_selection' || code === 'bad_mapping' || code === 'bad_album') return 'The selection could not be saved. Reload the playlist and try again.';
  if (ex.status === 400 || ex.code === 'bad_url') return 'This is not a valid YouTube playlist link.';
  if (ex.status === 404 || code === 'not_found') return 'YouTube has no playlist at this address, or it is private.';
  if (ex.status === 502 || code === 'youtube_failed') return 'YouTube could not be read right now. Try again later.';
  return ex.message || 'The playlist could not be read.';
}

const list = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

export function candidateLines(c) {
  const head = [c.artist, c.title].filter(Boolean).join(' - ');
  const tracks = c.trackCount ? `${c.trackCount} ${plural(c.trackCount, 'track', 'tracks')}` : '';
  const sub = [c.year, tracks].filter(Boolean).join(' · ');
  const labels = list(c.labels).join(', ');
  const label = labels ? `${labels}${c.catno ? ` (${c.catno})` : ''}` : (c.catno ? String(c.catno) : '');
  const meta = [list(c.formats).join(', '), label, c.country].filter(Boolean).join(' · ');
  return { head, sub, meta };
}

export function candidateBody(c) {
  const { head, sub, meta } = candidateLines(c);
  const art = el('span', { class: 'row-cover album-cand-cover' }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')));
  if (typeof c.thumb === 'string' && /^https?:\/\//i.test(c.thumb)) {
    const img = el('img', { class: 'cover', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: c.thumb });
    img.addEventListener('error', () => img.remove());
    art.append(img);
  }
  return [art,
    el('span', { class: 'info album-cand-text' },
      el('span', { class: 'album-cand-head' },
        el('span', { class: 'album-cand-title t-headline' }, head),
        c.best ? el('span', { class: 'chip tint album-best' }, 'Best match') : null),
      sub ? el('span', { class: 'album-cand-sub muted t-caption' }, sub) : null,
      meta ? el('span', { class: 'album-cand-meta muted t-caption' }, meta) : null)];
}

export function candidateRow(c, onPick) {
  const { head, sub, meta } = candidateLines(c);
  return el('button', { class: 'pl-pick-item album-cand', type: 'button', title: [head, sub, meta].filter(Boolean).join('\n'), onclick: onPick }, ...candidateBody(c));
}

export function matchMap(c) {
  const m = new Map();
  const raw = c?.matches && typeof c.matches === 'object' && !Array.isArray(c.matches) ? c.matches : {};
  const titles = new Map((Array.isArray(c?.tracks) ? c.tracks : []).map((t) => [t.no, t.title]));
  for (const [key, no] of Object.entries(raw)) {
    const pos = Number(key);
    if (Number.isInteger(pos) && Number.isInteger(no)) m.set(pos, { position: pos, no, title: titles.get(no) || '' });
  }
  return m;
}

export function autoMatch(tracks, candTracks) {
  const ct = Array.isArray(candTracks) ? candTracks : [];
  const used = new Set();
  const out = {};
  for (const t of tracks) {
    const hit = ct.find((x) => !used.has(x.no) && fold(x.title) === fold(t.title));
    if (hit) { used.add(hit.no); out[t.position] = hit.no; }
  }
  for (const t of tracks) {
    if (t.position in out) continue;
    const ft = fold(t.title);
    const hit = ct.find((x) => !used.has(x.no) && fold(x.title).length >= 3 && ft.includes(fold(x.title)));
    if (hit) { used.add(hit.no); out[t.position] = hit.no; }
  }
  if (!Object.keys(out).length && ct.length === tracks.length) tracks.forEach((t, i) => { out[t.position] = ct[i].no; });
  return out;
}

export function candidatePayload(c, playlistUrl) {
  return {
    title: c.title, artist: c.artist, year: c.year ?? null, genres: list(c.genres),
    ...(c.source && typeof c.source === 'object' ? { source: c.source } : {}),
    ...(Number.isInteger(c.discogsId) ? { discogsId: c.discogsId } : {}),
    tracks: Array.isArray(c.tracks) ? c.tracks : [],
    links: { ...(c.links || {}), discogs: c.url, youtube: playlistUrl },
  };
}

export const QUOTA_PER_HOUR = 20;

export function openAddAlbum(opener = null) {
  const dlg = document.getElementById('add-dialog');
  const url = el('input', { type: 'text', placeholder: 'Discogs release or YouTube playlist address', 'aria-label': 'Discogs release or YouTube playlist address', autocomplete: 'off', inputMode: 'url' });
  const fetchBtn = el('button', { class: 'btn fill small', type: 'submit' }, 'Fetch');
  const form = el('form', { class: 'well' }, url, fetchBtn);
  const message = el('div', { role: 'alert' });
  const body = el('div', { class: 'add-body' });
  const say = (text, link) => message.replaceChildren(text ? el('p', { class: 'msg error' }, text, ...(link ? [' ', link] : [])) : '');
  let live = true;
  let yt = null;
  let owner = false;

  function paintPreview(preview) {
    const editor = genreEditor(preview.genres);
    const time = totalTime(preview.tracks);
    const rymInput = el('input', { type: 'text', placeholder: 'Rate Your Music link (optional)', 'aria-label': 'Rate Your Music link', autocomplete: 'off', inputMode: 'url' });
    const create = el('button', { class: 'btn primary glow', type: 'button' }, icon('plus', 'nav'), 'Create');
    const back = el('button', { class: 'btn outline', type: 'button', onclick: () => { say(''); body.replaceChildren(); form.hidden = false; url.focus(); } }, 'Back');
    create.addEventListener('click', async () => {
      editor.commit();
      say('');
      create.disabled = true;
      try {
        const rymUrl = rymInput.value.trim();
        const made = await api.createAlbum({ ...preview, genres: editor.get(), ...(rymUrl ? { links: { rateyourmusic: rymUrl } } : {}) });
        dlg.close();
        toast(`Added "${made.title}"`);
        window.dispatchEvent(new Event(ALBUMS_CHANGED));
      } catch (ex) {
        create.disabled = false;
        if (ex.status === 409 && errorCode(ex) === 'already_exists') {
          const existing = ex.data?.id ?? ex.data?.detail?.id;
          say('This album already exists.', existing ? el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { void api.album(existing).then((full) => { dlg.close(); openAlbumCard(full); }, (ex2) => say(ex2.message)); } }, 'Open it') : null);
        } else say(ex.message || 'The album could not be created.');
      }
    });
    form.hidden = true;
    body.replaceChildren(el('div', { class: 'add-card album-preview' },
      el('div', { class: 'preview-meta' },
        el('div', { class: 't-headline album-headline' }, [`${preview.artist} - ${preview.title}`, preview.year].filter(Boolean).join(' · ')),
        time ? el('div', { class: 't-time muted album-time' }, time) : null),
      editor.node,
      el('div', { class: 'field album-rym' }, el('label', { class: 't-caption muted' }, 'Rate Your Music link (optional)'), rymInput),
      trackList(preview.tracks || []),
      el('div', { class: 'add-foot' }, back, create)));
  }

  async function loadPreview(address) {
    say('');
    body.replaceChildren();
    fetchBtn.disabled = true;
    try {
      const preview = await api.albumPreview(address);
      if (live) paintPreview(preview);
    } catch (ex) {
      if (live) say(fetchErrorText(ex));
    } finally {
      fetchBtn.disabled = false;
    }
  }

  const chosen = () => (yt && yt.sel >= 0 ? yt.candidates[yt.sel] || null : null);

  function applyDefaults() {
    const c = chosen();
    const mp = c ? matchMap(c) : null;
    for (const t of yt.tracks) {
      if (yt.manual.has(t.position)) continue;
      yt.checked[t.position] = mp ? mp.has(t.position) : true;
    }
  }

  function pickCandidate(i) {
    yt.sel = i;
    yt.expanded = false;
    applyDefaults();
    renderYt();
  }

  async function searchAgain() {
    yt.searching = true;
    renderYt();
    try {
      const r = await api.albumDiscogsSearch({
        artist: yt.searchArtist.trim() || undefined,
        album: yt.searchAlbum.trim() || undefined,
        trackCount: yt.tracks.length,
        durationsS: yt.tracks.map((t) => t.durationS),
        playlistTracks: yt.tracks.map(({ position, title, durationS }) => ({ position, title, durationS })),
      });
      if (!live) return;
      yt.candidates = Array.isArray(r?.candidates) ? r.candidates : [];
      yt.searchError = '';
      const best = yt.candidates.findIndex((c) => c.best);
      yt.sel = yt.candidates.length ? Math.max(0, best) : -1;
    } catch (ex) {
      if (!live) return;
      yt.searchError = ex.status === 503 || errorCode(ex) === 'discogs_unavailable' ? 'Discogs is not available right now.' : (ex.message || 'The search failed.');
      yt.candidates = [];
      yt.sel = -1;
    }
    yt.searching = false;
    yt.expanded = false;
    applyDefaults();
    renderYt();
  }

  async function addPasted(address) {
    say('');
    fetchBtn.disabled = true;
    try {
      const pv = await api.albumPreview(address);
      if (!live) return;
      const cand = {
        url: address, title: pv.title, artist: pv.artist, year: pv.year, trackCount: (pv.tracks || []).length, genres: pv.genres, source: pv.source,
        tracks: pv.tracks || [], links: { discogs: address }, matches: autoMatch(yt.tracks, pv.tracks),
      };
      yt.candidates = [cand, ...yt.candidates];
      yt.sel = 0;
      yt.expanded = false;
      form.hidden = true;
      url.value = '';
      applyDefaults();
      renderYt();
    } catch (ex) {
      if (live) say(fetchErrorText(ex));
    } finally {
      fetchBtn.disabled = false;
    }
  }

  async function commit(create) {
    const c = chosen();
    const positions = yt.tracks.filter((t) => yt.checked[t.position]).map((t) => t.position);
    const fallback = { title: yt.fb.title.trim(), artist: yt.fb.artist.trim(), year: /^\d{1,4}$/.test(yt.fb.year.trim()) ? Number(yt.fb.year.trim()) : null };
    if (!c && !fallback.title) { say('Give the album a title.'); return; }
    say('');
    create.disabled = true;
    try {
      let candidate = null;
      const mapping = {};
      if (c) {
        candidate = candidatePayload(c, yt.url);
        if (!candidate.tracks.length) {
          const pv = await api.albumPreview(c.url);
          candidate = { ...candidate, tracks: pv.tracks || [], genres: candidate.genres.length ? candidate.genres : list(pv.genres), source: candidate.source || pv.source };
        }
        const mp = matchMap(c);
        for (const pos of positions) if (mp.has(pos)) mapping[pos] = mp.get(pos).no;
      }
      const selected = yt.tracks.filter((t) => yt.checked[t.position]).map(({ position, videoId, title, durationS }) => ({ position, videoId, title, durationS: durationS ?? null }));
      const r = await api.albumYoutubeCommit({ playlistUrl: yt.url, selected, candidate, mapping, fallback });
      dlg.close();
      window.dispatchEvent(new Event(ALBUMS_CHANGED));
      const ids = (r.songs || []).map((s) => s.songId);
      const k = await startDownloads(ids);
      const linked = countOfList(r.linked);
      const unlinked = countOfList(r.unlinked);
      toast(`Album created, ${linked} ${plural(linked, 'song', 'songs')} linked, ${unlinked} not matched; downloading ${k} ${plural(k, 'track', 'tracks')}`);
    } catch (ex) {
      create.disabled = false;
      if (ex.status === 409 && errorCode(ex) === 'already_exists') {
        const existing = ex.data?.id ?? ex.data?.detail?.id;
        say('This album already exists.', existing ? el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { void api.album(existing).then((full) => { dlg.close(); openAlbumCard(full); }, (ex2) => say(ex2.message)); } }, 'Open it') : null);
      } else say(youtubeErrorText(ex));
    }
  }

  function candidateRadio(c, i, on) {
    const radio = el('input', { type: 'radio', name: 'album-cand', 'aria-label': `${candidateLines(c).head}`, checked: on, onchange: () => pickCandidate(i) });
    const { head, sub, meta } = candidateLines(c);
    return el('label', { class: 'pl-pick-item album-cand album-cand-radio', title: [head, sub, meta].filter(Boolean).join('\n') }, radio, ...candidateBody(c));
  }

  function renderPicker(c) {
    const box = el('div', { class: 'album-picker' });
    if (yt.searching) {
      box.append(el('p', { class: 'muted t-caption', role: 'status' }, 'Searching Discogs...'));
    } else if (yt.candidates.length) {
      const open = el('a', { class: 'btn outline small album-open-discogs', href: c?.url || '#', target: '_blank', rel: 'noopener' }, 'Open on Discogs');
      const change = el('button', { class: 'link-btn t-caption album-change', type: 'button', 'aria-expanded': String(yt.expanded), onclick: () => { yt.expanded = !yt.expanded; renderYt(); } }, yt.expanded ? 'Hide list' : 'Change');
      box.append(el('div', { class: 'album-picked', role: 'radiogroup', 'aria-label': 'Discogs release' },
        ...(yt.expanded ? yt.candidates.map((x, i) => el('div', { class: 'album-cand-item' }, candidateRadio(x, i, i === yt.sel))) : (c ? [candidateRadio(c, yt.sel, true)] : []))),
        el('div', { class: 'album-picker-actions' }, change, ...(c ? [open] : [])));
    } else {
      box.append(el('p', { class: 'muted t-subhead' }, yt.searchError || 'No matching releases found.'));
    }
    const artist = el('input', { type: 'text', 'aria-label': 'Artist', placeholder: 'Artist', autocomplete: 'off', value: yt.searchArtist });
    const album = el('input', { type: 'text', 'aria-label': 'Album', placeholder: 'Album', autocomplete: 'off', value: yt.searchAlbum });
    artist.addEventListener('input', () => { yt.searchArtist = artist.value; });
    album.addEventListener('input', () => { yt.searchAlbum = album.value; });
    const again = el('button', { class: 'btn outline small', type: 'submit', disabled: yt.searching }, 'Search again');
    const searchForm = el('form', { class: 'album-search' }, artist, album, again);
    searchForm.addEventListener('submit', (e) => { e.preventDefault(); void searchAgain(); });
    const paste = el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { form.hidden = false; url.focus(); } }, 'Paste a Discogs link');
    box.append(searchForm, paste);
    return box;
  }

  function renderFallback() {
    const field = (key, label, extra = {}) => {
      const input = el('input', { type: 'text', 'aria-label': label, placeholder: label, autocomplete: 'off', value: yt.fb[key], ...extra });
      input.addEventListener('input', () => { yt.fb[key] = input.value; });
      return input;
    };
    return el('div', { class: 'album-fallback' },
      el('p', { class: 't-caption muted' }, 'The album will be created from the playlist alone. Check its details:'),
      field('title', 'Title'), field('artist', 'Artist'), field('year', 'Year', { inputMode: 'numeric' }));
  }

  function renderYt() {
    const c = chosen();
    const mp = c ? matchMap(c) : new Map();
    const selected = yt.tracks.filter((t) => yt.checked[t.position]);
    const toDownload = selected.filter((t) => !t.songId).length;
    const guessLine = [[yt.guess.artist, yt.guess.album].filter(Boolean).join(' - '), yt.guess.year].filter(Boolean).join(' · ');
    const head = el('div', { class: 'album-yt-head' },
      el('div', { class: 't-headline' }, yt.playlist.title || 'YouTube playlist'),
      guessLine ? el('div', { class: 'muted t-caption album-guess' }, `Looks like: ${guessLine}`) : null);
    const allOn = yt.tracks.length > 0 && selected.length === yt.tracks.length;
    const toggleAll = el('button', { class: 'link-btn t-caption album-select-all', type: 'button', onclick: () => {
      for (const t of yt.tracks) { yt.checked[t.position] = !allOn; yt.manual.add(t.position); }
      renderYt();
    } }, allOn ? 'Select none' : 'Select all');
    const rows = yt.tracks.map((t) => {
      const box = el('input', { type: 'checkbox', checked: !!yt.checked[t.position], 'aria-label': `Track ${t.position}: ${t.title}`, onchange: (e) => { yt.checked[t.position] = e.currentTarget.checked; yt.manual.add(t.position); renderYt(); } });
      const m = mp.get(t.position);
      return el('li', { class: 'album-yt-track' }, el('label', { class: 'album-yt-row' },
        box,
        el('span', { class: 'album-no muted t-caption' }, `${t.position}.`),
        el('span', { class: 'album-yt-title t-subhead' }, t.title),
        t.songId ? el('span', { class: 'chip tint album-in-library' }, 'In library') : null,
        el('span', { class: 'album-len muted t-caption' }, lengthText(t.durationS)),
        c ? (m ? el('span', { class: 'album-match t-caption' }, `→ ${m.no}. ${m.title}`) : el('span', { class: 'album-match album-nomatch muted t-caption' }, 'no match')) : null));
    });
    const create = el('button', { class: 'btn primary glow', type: 'button' }, icon('plus', 'nav'), toDownload > 0 ? `Create album and download ${toDownload} ${plural(toDownload, 'track', 'tracks')}` : 'Create album');
    create.disabled = selected.length === 0 && !c;
    create.addEventListener('click', () => { void commit(create); });
    const cancel = el('button', { class: 'btn outline', type: 'button', onclick: () => dlg.close() }, 'Cancel');
    body.replaceChildren(el('div', { class: 'add-card album-yt' },
      head,
      renderPicker(c),
      c || yt.searching ? null : renderFallback(),
      el('div', { class: 'album-yt-bar' }, el('span', { class: 't-caption muted album-yt-count', role: 'status' }, `${selected.length} of ${yt.tracks.length} selected`), toggleAll),
      el('ul', { class: 'album-yt-tracks' }, rows),
      owner ? null : el('p', { class: 't-caption muted album-quota' }, `${toDownload} selected, up to ${QUOTA_PER_HOUR} fetches an hour, it pauses and resumes`),
      el('div', { class: 'add-foot' }, cancel, create)));
  }

  async function startYoutube(address) {
    say('');
    body.replaceChildren(el('p', { class: 'muted t-subhead', role: 'status' }, 'Reading the playlist...'));
    fetchBtn.disabled = true;
    try {
      const r = await api.albumYoutubePreview(address);
      if (!live) return;
      const tracks = Array.isArray(r.tracks) ? r.tracks : [];
      const guess = r.guess || {};
      const candidates = Array.isArray(r.candidates) ? r.candidates : [];
      const best = candidates.findIndex((c) => c.best);
      yt = {
        url: address, playlist: r.playlist || {}, guess, tracks, candidates,
        sel: candidates.length ? Math.max(0, best) : -1,
        searchError: r.searchError ? (r.searchError === 'discogs_unavailable' ? 'Discogs is not available right now.' : 'The Discogs search failed.') : '',
        expanded: false, searching: false, manual: new Set(), checked: {},
        searchArtist: guess.artist || '', searchAlbum: guess.album || '',
        fb: { title: guess.album || r.playlist?.title || '', artist: guess.artist || '', year: guess.year ? String(guess.year) : '' },
      };
      form.hidden = true;
      applyDefaults();
      renderYt();
      void api.me().then((m) => { if (live && m?.owner === true) { owner = true; renderYt(); } }, () => {});
    } catch (ex) {
      body.replaceChildren();
      if (live) say(youtubeErrorText(ex));
    } finally {
      fetchBtn.disabled = false;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = url.value.trim();
    if (!address) { say('Paste a Discogs release or YouTube playlist address.'); url.focus(); return; }
    const pl = playlistLink(address);
    if (pl?.kind === 'mix') { say(MIX_MESSAGE); return; }
    if (pl?.kind === 'private') { say(PRIVATE_MESSAGE); return; }
    if (pl) { await startYoutube(pl.url); return; }
    if (yt) { await addPasted(address); return; }
    await loadPreview(address);
  });

  dlg.onclose = () => {
    live = false;
    dlg.replaceChildren();
    dlg.onclose = null;
    dlg.onclick = null;
    if (opener?.isConnected) opener.focus();
  };
  dlg.replaceChildren(
    dialogHead('Add album', 'Save the tracks of a Discogs release, or pick the release a YouTube playlist matches. Nothing is saved until you press Create.', () => dlg.close()),
    form, message, body);
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  url.focus();
  return dlg;
}

export function mountAlbums(pane, id = albumIdOf(location.hash)) {
  let gone = false;
  const cleanups = [];
  const body = el('div', { class: 'albums' });
  pane.replaceChildren(body);

  async function showList() {
    const searchField = searchBox({
      placeholder: 'Search album, artist, genre or track', value: prefs.query,
      onChange: (text) => { prefs.query = text; savePrefs(); paintAll(); },
    });
    const sort = el('select', { 'aria-label': 'Sort', onchange: (e) => { albumPrefs.sort = e.target.value; saveAlbumPrefs(); paintAll(); } },
      ...Object.entries(ALBUM_SORTS).map(([k, [label]]) => el('option', { value: k, selected: k === albumPrefs.sort }, label)));
    const reverse = el('button', { class: 'icon sort-reverse', type: 'button', title: 'Reverse order', 'aria-label': 'Reverse order', 'aria-pressed': String(!!albumPrefs.reverse) }, icon('arrowUpDown', 'inline'));
    reverse.addEventListener('click', () => {
      albumPrefs.reverse = !albumPrefs.reverse;
      reverse.setAttribute('aria-pressed', String(albumPrefs.reverse));
      saveAlbumPrefs();
      paintAll();
    });
    const cats = el('div', { class: 'cats albums-facets', role: 'group', 'aria-label': 'Filter albums' });
    const summary = el('p', { class: 'muted t-caption', role: 'status' });
    const clearFilters = el('button', { class: 'btn outline small', type: 'button', hidden: true, 'aria-label': 'Clear the search and all filters' }, icon('clear', 'inline'), 'Clear filters');
    const playAllBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true });
    const addAllBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true });
    const showPlaying = el('button', { class: 'btn outline small', type: 'button', hidden: true, 'aria-label': 'Show the album of the playing song in the list' }, icon('crosshair', 'inline'), 'Show playing');
    const toolbar = el('div', { class: 'toolbar', hidden: true }, searchField.node, showPlaying, cats);
    const head = el('div', { class: 'table-head t-eyebrow', 'aria-hidden': 'true' },
      el('span'), el('span', {}, 'Album'), el('span', { class: 'c-genres' }, 'Genres'));
    const sortbar = el('div', { class: 'sortbar', hidden: true },
      el('label', { class: 'sort t-headline' }, sort, icon('chevron', 'inline')), reverse,
      summary, el('div', { class: 'sort-actions' }, clearFilters, playAllBtn, addAllBtn));
    const listSlot = el('div', { class: 'albums-list' }, el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading albums...'));
    const sel = albumPrefs.sel;
    let all = [];
    let shown = [];
    body.replaceChildren(toolbar, sortbar, listSlot);
    cleanups.push(mountDownloadStatus(body));
    body.prepend(body.lastChild);
    const reload = () => { void loadList(); };
    window.addEventListener(ALBUMS_CHANGED, reload);
    cleanups.push(() => window.removeEventListener(ALBUMS_CHANGED, reload));

    const filtered = () => !!(prefs.query.trim() || sel.genres.size || sel.years.size);
    const songsOf = () => shown.flatMap((a) => linkedSongs(a.tracks));
    const visible = () => sortedAlbums(all.filter((a) => matchesQuery(a, prefs.query) && matchesFacets(a, sel)));
    const albumOfSong = (id, from) => from.find((a) => linkedIds(a).includes(id)) || null;
    const clearAll = () => {
      prefs.query = '';
      sel.genres.clear();
      sel.years.clear();
      searchField.input.value = '';
      searchField.paintClear();
      savePrefs();
      saveAlbumPrefs();
      paintAll();
    };
    function scrollToAlbum(albumId) {
      const row = [...listSlot.querySelectorAll('li.album-row')].find((r) => r.dataset.id === albumId);
      if (!row) return;
      const r = row.getBoundingClientRect();
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({
        top: scrollTarget({ rowTop: r.top, rowHeight: r.height, scrollY: window.scrollY, viewportH: window.innerHeight, docH: document.documentElement.scrollHeight }),
        behavior: reduce ? 'auto' : 'smooth',
      });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), ROW_FLASH_MS);
    }
    showPlaying.addEventListener('click', () => {
      const id = player.current?.id;
      const album = id ? albumOfSong(id, all) : null;
      if (!album) return;
      if (shown.includes(album)) { scrollToAlbum(album.id); return; }
      toast('Album is hidden by the current filters', { label: 'Show', run: () => { clearAll(); scrollToAlbum(album.id); } });
    });
    playAllBtn.addEventListener('click', () => playAll(songsOf()));
    addAllBtn.addEventListener('click', () => addAllToQueue(songsOf()));
    clearFilters.addEventListener('click', clearAll);

    async function loadList() {
      let albums;
      try { albums = await api.albums(); } catch { if (!gone) listSlot.replaceChildren(loadFail(loadList)); return; }
      const full = await Promise.all(albums.map((a) => (Array.isArray(a.tracks) ? a : api.album(a.id).then((d) => ({ ...a, ...d }), () => a))));
      if (gone) return;
      all = full;
      paintAll();
    }

    function paintAll() {
      for (const f of FACETS) for (const v of [...sel[f.id]]) if (!facetValues(all, f).some((x) => x.value === v)) sel[f.id].delete(v);
      saveAlbumPrefs();
      shown = visible();
      toolbar.hidden = !all.length;
      sortbar.hidden = !all.length;
      window.dispatchEvent(new CustomEvent('albums-total', { detail: { text: all.length ? `${all.length} ${plural(all.length, 'album', 'albums')}` : '' } }));
      cats.replaceChildren(...FACETS.map((f) => {
        const values = facetValues(all, f);
        const n = sel[f.id].size;
        const b = el('button', {
          class: `cat-chip${n ? ' on' : ''}`, type: 'button', disabled: !values.length, 'aria-haspopup': 'dialog', 'data-cat': f.id,
          onclick: () => openFilterSheet({ id: f.id, name: f.name }, b, paintAll, {
            values: values.map((v) => ({ tag: v.value, count: v.count })),
            sel: sel[f.id],
            summary: (picked, total) => `${total} in your albums · ${picked} selected · ${visible().length} ${plural(visible().length, 'album', 'albums')}`,
          }),
        }, f.name, el('small', { class: 't-caption' }, n || values.length));
        b.setAttribute('aria-label', n ? `${f.name}, ${n} selected` : `${f.name}, ${values.length}`);
        return b;
      }));
      const songs = songsOf();
      const picked = [...sel.genres, ...sel.years].slice(0, 3);
      summary.textContent = all.length && filtered() ? `${shown.length} ${plural(shown.length, 'album matches', 'albums match')}${picked.length ? ` · ${picked.join(', ')}` : ''}` : '';
      showPlaying.hidden = !(player.current && albumOfSong(player.current.id, all));
      clearFilters.hidden = !(all.length && filtered());
      playAllBtn.hidden = !songs.length;
      playAllBtn.textContent = `Play all ${songs.length} linked`;
      addAllBtn.hidden = !(filtered() && songs.length);
      addAllBtn.textContent = `Add all ${songs.length} linked to queue`;
      if (!all.length) {
        listSlot.replaceChildren(el('div', { class: 'state card' },
          el('p', { class: 't-headline' }, 'No albums yet'),
          el('p', { class: 'muted t-subhead' }, 'Add an album from a Discogs release or a YouTube playlist address.'),
          can('add') ? el('button', { class: 'btn primary glow', type: 'button', onclick: (e) => openAddAlbum(e.currentTarget) }, icon('plus', 'action'), 'Add album') : null));
        return;
      }
      if (!shown.length) {
        listSlot.replaceChildren(el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, 'No albums match. Clear the search or the filters.')));
        return;
      }
      const list = el('ul', { class: 'songs album-list' }, shown.map(albumRow));
      list.addEventListener('click', (e) => {
        const row = e.target.closest('li.song');
        const album = row && !isRowControl(e.target) ? all.find((a) => a.id === row.dataset.id) : null;
        if (album) openAlbumCard(album, row.querySelector('.open'));
      });
      paintCurrent(list);
      listSlot.replaceChildren(el('div', { class: 'group album-group' }, head, list));
    }
    cleanups.push(player.onChange(() => {
      const ul = listSlot.querySelector('ul.album-list');
      if (ul) paintCurrent(ul);
      showPlaying.hidden = !(player.current && albumOfSong(player.current.id, all));
    }));
    await loadList();
  }

  async function showPage() {
    body.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading album...'));
    let album;
    try { album = await api.album(id); } catch (ex) {
      if (gone) return;
      body.replaceChildren(ex.status === 404
        ? el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, 'This album does not exist.'), el('a', { class: 'btn outline small', href: '#/library/albums' }, 'Back to Albums'))
        : loadFail(showPage));
      return;
    }
    if (gone) return;
    const tracks = album.tracks || [];
    const toList = () => { location.hash = '#/library/albums'; };
    const del = plainDeleteButton(album, toList);
    body.replaceChildren(
      el('a', { class: 'link-btn album-back', href: '#/library/albums' }, icon('chevronLeft', 'inline'), 'Albums'),
      albumHead(album, 'h2', (opener) => openAlbumCard(album, opener)),
      el('div', { class: 'album-actions' }, del, deleteWithSongsButton(album, toList)),
      trackList(tracks));
  }

  const started = id ? showPage() : showList();
  const unmount = () => { gone = true; for (const f of cleanups) f(); };
  unmount.ready = started;
  return unmount;
}
