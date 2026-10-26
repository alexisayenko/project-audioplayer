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
import { dialogHead } from './edit-dialog.js';
import { artistLine, titleLine, displayLine, albumsOf, albumOf, releasedYear } from './credits.js';
import { openPlDialog, closePlDialog } from './playlist-dialogs.js';

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
const countOf = (a) => (a.tracks ? a.tracks.length : a.trackCount || 0);

export function totalTime(tracks) {
  const secs = (tracks || []).map((t) => t.durationS).filter((n) => Number.isFinite(n) && n >= 0);
  return secs.length ? fmtTime(secs.reduce((x, y) => x + y, 0)) : '';
}

export function bpmRange(tracks) {
  const v = (tracks || []).filter((t) => t.songId).map((t) => Number(store.get(t.songId)?.bpm)).filter((n) => Number.isFinite(n) && n > 0);
  if (!v.length) return '';
  const lo = Math.round(Math.min(...v));
  const hi = Math.round(Math.max(...v));
  return lo === hi ? `${lo} bpm` : `${lo} - ${hi} bpm`;
}

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

export function albumLinks(a) {
  const src = a.source;
  const raw = typeof src === 'string' ? src : src?.url;
  let url = httpUrl(raw);
  if (!url && typeof raw === 'string') {
    const m = /^discogs:(\d+)$/.exec(raw);
    if (m) url = `https://www.discogs.com/release/${m[1]}`;
  }
  if (!url || !/^https?:\/\/([a-z0-9-]+\.)*discogs\.com\//i.test(url)) return {};
  return { discogs: { on: true, url } };
}

export function albumFacts(a) {
  const n = countOf(a);
  const bpm = bpmRange(a.tracks);
  return [`${n} ${plural(n, 'track', 'tracks')}`, bpm, totalTime(a.tracks), a.year ? String(a.year) : ''].filter(Boolean).join(' · ');
}

export const RYM_ERROR = 'Use a rateyourmusic.com album or release address.';
const rymHref = (u) => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : '');

function rymBadge(url) {
  return el('a', { class: 'svc svc-rym on', href: url, target: '_blank', rel: 'noopener', title: 'RateYourMusic', 'aria-label': 'RateYourMusic' },
    el('span', { class: 't-caption', 'aria-hidden': 'true' }, 'RYM'));
}

function rymForm(album, onSaved) {
  const input = el('input', { type: 'text', placeholder: 'https://rateyourmusic.com/release/album/...', 'aria-label': 'RateYourMusic link', autocomplete: 'off', inputMode: 'url', value: album.rymUrl || '' });
  const save = el('button', { class: 'btn fill small', type: 'submit' }, 'Save');
  const err = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
  const form = el('form', { class: 'album-rym' },
    el('label', { class: 't-caption muted' }, 'RateYourMusic link'),
    el('div', { class: 'well' }, input, save), err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    save.disabled = true;
    try {
      onSaved(await api.patchAlbum(album.id, { rymUrl: input.value.trim() || null }));
    } catch (ex) {
      err.textContent = ex.status === 422 || ex.code === 'bad_rym_url' ? RYM_ERROR : ex.message;
      err.hidden = false;
      save.disabled = false;
    }
  });
  return form;
}

const fold = (s) => String(s ?? '').normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();
const songLength = (s) => (Number.isFinite(s?.duration) && s.duration > 0 ? fmtTime(s.duration) : '-');

export function candidateMeta(s) {
  const year = releasedYear(s);
  return [artistLine(s), albumOf(s), year ? String(year) : ''].filter(Boolean).join(' · ');
}

export function linkCandidates(album, track, songs = store.songs) {
  const taken = new Set((album.tracks || []).filter((t) => t.no !== track.no && t.songId).map((t) => t.songId));
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
  const list = linkCandidates(album, track);
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
  const buttons = [];
  const body = list.length
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
    : el('p', { class: 'muted t-subhead' }, 'No matching songs in your library');
  const sub = `${track.no}. ${track.title}${Number.isFinite(track.durationS) ? ` (${lengthText(track.durationS)})` : ''}`;
  openPlDialog('Link song', dialogHead('Link song', sub, closePlDialog), err, body);
}

export function openAlbumCard(album, opener = null) {
  const dlg = document.getElementById('song-card');
  const close = () => dlg.close();
  let cur = album;

  let openNo = null;
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
      const unlink = el('button', { type: 'button', class: 'x album-unlink', title: 'Unlink song', 'aria-label': `Unlink song from track ${t.no}`, onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { paint(await api.unlinkTrack(cur.id, t.no)); } catch (ex) { btn.disabled = false; toast(ex.message); }
      } }, icon('clear', 'inline'));
      panel = el('span', { class: 'album-linked t-caption' },
        el('span', { class: 'album-linked-name' }, linked ? displayLine(linked) : 'Linked song'),
        el('span', { class: 'album-len muted' }, songLength(linked)), unlink);
    } else {
      panel = el('button', { type: 'button', class: 'link-btn t-caption album-link-btn', onclick: () => openLinkPopup(cur, t, paint) }, 'Link song');
    }
    const btn = el('button', { type: 'button', class: 'album-row-btn', 'aria-expanded': String(on), 'aria-controls': panelId(t), onclick: () => setOpen(t.no) },
      el('span', { class: 'album-no muted t-caption' }, `${t.no}.`),
      el('span', { class: 'album-name t-subhead' }, t.title),
      el('span', { class: 'album-len muted t-caption' }, lengthText(t.durationS)));
    return el('li', { class: `album-track${on ? ' open' : ''}`, 'data-no': String(t.no) },
      btn, el('div', { class: 'album-panel', id: panelId(t), hidden: !on }, panel));
  }

  function paint(next) {
    if (next) { cur = next; window.dispatchEvent(new Event(ALBUMS_CHANGED)); }
    const closeBtn = el('button', { type: 'button', class: 'card-close', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('clear', 'nav'));
    const art = el('div', { class: 'card-art album-art' }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')), closeBtn);
    const links = albumLinks(cur);
    const rym = rymHref(cur.rymUrl);
    const svc = Object.keys(links).length || rym ? serviceIcons({ onlyOn: true }) : null;
    svc?.setState(links);
    if (rym) svc.node.append(rymBadge(rym));
    const genres = Array.isArray(cur.genres) ? cur.genres.filter(Boolean) : [];
    const tracks = cur.tracks || [];
    dlg.replaceChildren(...[
      el('span', { class: 'grab', 'aria-hidden': 'true' }),
      art,
      el('div', { class: 'card-head' },
        el('h2', { id: 'song-card-title', class: 't-title' }, [cur.artist, cur.title].filter(Boolean).join(' - ')),
        el('p', { class: 'card-sub t-subhead album-facts-line' }, albumFacts(cur))),
      genres.length ? el('div', { class: 'chips album-genres' }, genres.map((g) => el('span', { class: 'tag ns t-caption' }, g))) : null,
      svc?.node,
      rymForm(cur, paint),
      el('div', { class: 'card-actions album-card-actions' }, el('div', { class: 'card-icons' }, albumButtons(cur, true).all), plainDeleteButton(cur, close), deleteWithSongsButton(cur, close)),
      tracks.length ? el('ol', { class: 'album-tracks album-info-tracks' }, tracks.map(trackRow)) : null].filter(Boolean));
  }

  dlg.setAttribute('tabindex', '-1');
  paint();
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => { dlg.replaceChildren(); if (opener?.isConnected) opener.focus(); }, { once: true });
  if (!dlg.open) dlg.showModal();
  dlg.focus();
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

const FACETS = [
  { id: 'genres', name: 'Genres', of: (a) => (Array.isArray(a.genres) ? a.genres.filter(Boolean) : []) },
  { id: 'years', name: 'Years', of: (a) => (a.year ? [String(a.year)] : []) },
];

export function facetValues(albums, facet) {
  const counts = new Map();
  for (const a of albums) for (const v of new Set(facet.of(a))) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((x, y) => (facet.id === 'years' ? y.value.localeCompare(x.value) : x.value.localeCompare(y.value)));
}

export function matchesFacets(album, sel) {
  return FACETS.every((f) => !sel[f.id].size || anyOf(f.of(album), sel[f.id]));
}
const anyOf = (have, want) => have.some((v) => want.has(v));

function openFacetSheet(facet, opener, albums, sel, onApply) {
  const dlg = document.getElementById('filter-sheet');
  const values = facetValues(albums, facet);
  const chosen = sel[facet.id];
  const sub = el('p', { class: 't-caption muted' });
  const pills = el('div', { class: 'pills' });
  const refresh = () => {
    const n = albums.filter((a) => matchesFacets(a, sel)).length;
    sub.textContent = `${values.length} in your albums · ${chosen.size} selected · ${n} ${plural(n, 'album', 'albums')}`;
    for (const b of pills.children) {
      const on = chosen.has(b.dataset.key);
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    }
  };
  const apply = () => { refresh(); onApply(); };
  pills.append(...values.map((v) => el('button', {
    class: 'chip t-subhead', type: 'button', title: v.value, 'data-key': v.value, 'aria-pressed': 'false',
    onclick: () => { if (chosen.has(v.value)) chosen.delete(v.value); else chosen.add(v.value); apply(); },
  }, v.value, el('small', { class: 't-caption' }, v.count))));
  const clear = el('button', { class: 'link-btn t-subhead strong', type: 'button', onclick: () => { chosen.clear(); apply(); } }, 'Clear');
  dlg.replaceChildren(
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' }, el('div', {}, el('h2', { id: 'sheet-title', class: 't-title' }, facet.name), sub), clear),
    pills);
  refresh();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  pills.firstElementChild?.focus();
  dlg.addEventListener('close', () => {
    const back = opener.isConnected ? opener : document.querySelector(`.cat-chip[data-cat="${facet.id}"]`);
    back?.focus();
  }, { once: true });
}

function confirmDeleteAlbum(album, onDone) {
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete album');
  const form = el('form', { method: 'dialog' },
    dialogHead('Delete album?', album.title, closePlDialog),
    el('p', { class: 't-body' }, 'Your songs stay in the library.'),
    err,
    el('div', { class: 'row end' }, del));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    del.disabled = true;
    try {
      await api.deleteAlbum(album.id);
      closePlDialog();
      onDone();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      del.disabled = false;
    }
  });
  openPlDialog('Delete album?', form);
  del.focus();
}

const linkedIds = (a) => (a.tracks || []).filter((t) => t.songId).map((t) => t.songId);

function confirmDeleteAlbumAndSongs(album, onDone) {
  const ids = linkedIds(album);
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete album and songs');
  const form = el('form', { method: 'dialog' },
    dialogHead('Delete album and its songs?', album.title, closePlDialog),
    el('p', { class: 't-body' }, `Delete album '${album.title}' and ${ids.length} ${plural(ids.length, 'song', 'songs')} from your library? This cannot be undone.`),
    err,
    el('div', { class: 'row end' }, del));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    del.disabled = true;
    err.hidden = true;
    let done = 0;
    try {
      for (const id of ids) {
        try { await api.remove(id); } catch (ex) { if (ex.status !== 404) throw ex; } // NOSONAR songs go one at a time
        done += 1;
      }
    } catch (ex) {
      await store.refresh().catch(() => {});
      window.dispatchEvent(new Event(ALBUMS_CHANGED));
      err.textContent = `Deleted ${done} of ${ids.length} songs: ${ex.message}`;
      err.hidden = false;
      del.disabled = false;
      return;
    }
    try {
      await api.deleteAlbum(album.id);
    } catch (ex) {
      await store.refresh().catch(() => {});
      err.textContent = `Deleted ${done} of ${ids.length} songs, but the album could not be removed: ${ex.message}`;
      err.hidden = false;
      del.disabled = false;
      return;
    }
    await store.refresh().catch(() => {});
    closePlDialog();
    toast(`Deleted "${album.title}" and ${done} ${plural(done, 'song', 'songs')}`);
    window.dispatchEvent(new Event(ALBUMS_CHANGED));
    onDone();
  });
  openPlDialog('Delete album and its songs?', form);
  del.focus();
}

function plainDeleteButton(album, onDone) {
  return el('button', { class: 'btn danger small album-delete', type: 'button', onclick: () => confirmDeleteAlbum(album, () => { toast(`Deleted "${album.title}"`); window.dispatchEvent(new Event(ALBUMS_CHANGED)); onDone(); }) }, icon('trash', 'inline'), 'Delete album');
}

function deleteWithSongsButton(album, onDone) {
  if (!linkedIds(album).length) return null;
  return el('button', { class: 'btn danger small album-delete-all', type: 'button', onclick: () => confirmDeleteAlbumAndSongs(album, onDone) },
    icon('trash', 'inline'), 'Delete album and its tracks from the library');
}

const loadFail = (retry) => el('div', { class: 'state card' },
  el('p', { class: 'msg error', role: 'alert' }, 'Albums could not be loaded. Check the connection and try again.'),
  el('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry'));

export const linkedSongs = (tracks) => (tracks || []).filter((t) => t.songId).map((t) => store.get(t.songId)).filter(Boolean);

const NOT_YET = () => toast('Not implemented yet');

function albumButtons(a, box = false) {
  const songs = linkedSongs(a.tracks);
  const off = !songs.length;
  const btn = (name, label, run, cls = '') => el('button', {
    class: `${box ? 'icon round' : 'icon sq-btn'} album-act ${cls}`.trim(), type: 'button', disabled: off,
    title: off ? 'No songs linked yet' : label, 'aria-label': `${label}: ${a.title}`, onclick: run,
  }, icon(name, box ? 'nav' : 'inline'));
  const queue = btn('listAdd', 'Add to queue', () => {
    const { added, already, fetching } = player.addListed(songs, '');
    const note = already ? ` (${already} already in queue)` : '';
    const dl = fetching ? `, ${fetching} downloading` : '';
    toast(`Added ${added} ${plural(added, 'song', 'songs')}${dl}${note}`);
  }, 'act-queue album-queue');
  const rest = [
    btn('playPlus', 'Play next', NOT_YET, 'act-next'),
    playlistsOn() ? btn('playlistPlus', 'Add to playlist...', (e) => { void openPlaylistPicker(songs, e.currentTarget); }, 'act-pl') : null,
    btn('share', 'Share link', NOT_YET, 'act-share'),
    can('download') ? btn('download', 'Download', NOT_YET, 'act-download') : null,
    can('edit') ? btn('pencil', 'Edit', NOT_YET, 'act-edit') : null,
  ].filter(Boolean);
  return { queue, all: [rest[0], queue, ...rest.slice(1)] };
}

function albumRow(a) {
  const n = countOf(a);
  const time = totalTime(a.tracks);
  const bpm = bpmRange(a.tracks);
  const genres = Array.isArray(a.genres) ? a.genres.filter(Boolean) : [];
  const { queue } = albumButtons(a);
  return el('li', { class: 'song has-acts album-row', 'data-id': a.id },
    el('div', { class: 'row-acts' }, queue),
    el('span', { class: 'row-cover album-cover' }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder'))),
    el('div', { class: 'info album-text' },
      el('span', { class: 'album-title' },
        el('button', { class: 'open album-name-btn', type: 'button', title: 'Album info', onclick: (e) => openAlbumCard(a, e.currentTarget) }, `${a.title} · ${n} ${plural(n, 'track', 'tracks')}`)),
      el('span', { class: 'album-sub muted t-caption' }, [a.artist, a.year].filter(Boolean).join(' · '))),
    el('div', { class: 'album-facts muted t-caption' },
      time ? el('span', { class: 'album-time' }, time) : null,
      bpm ? el('span', { class: 'album-bpm' }, bpm) : null),
    el('div', { class: 'chips album-genres' }, genres.map((g) => el('span', { class: 'chip tint' }, g))));
}

export const ALBUMS_CHANGED = 'albums-changed';

export function openAddAlbum(opener = null) {
  const dlg = document.getElementById('add-dialog');
  const url = el('input', { type: 'text', placeholder: 'Discogs release address, https://www.discogs.com/release/...', 'aria-label': 'Discogs release address', autocomplete: 'off', inputMode: 'url' });
  const fetchBtn = el('button', { class: 'btn fill small', type: 'submit' }, 'Fetch');
  const form = el('form', { class: 'well' }, url, fetchBtn);
  const message = el('div', { role: 'alert' });
  const body = el('div', { class: 'add-body' });
  const say = (text, link) => message.replaceChildren(text ? el('p', { class: 'msg error' }, text, ...(link ? [' ', link] : [])) : '');
  let live = true;

  function paintPreview(preview) {
    const editor = genreEditor(preview.genres);
    const time = totalTime(preview.tracks);
    const rymInput = el('input', { type: 'text', placeholder: 'RateYourMusic link (optional)', 'aria-label': 'RateYourMusic link', autocomplete: 'off', inputMode: 'url' });
    const create = el('button', { class: 'btn primary glow', type: 'button' }, icon('plus', 'nav'), 'Create');
    const back = el('button', { class: 'btn outline', type: 'button', onclick: () => { body.replaceChildren(); say(''); form.hidden = false; url.focus(); } }, 'Back');
    create.addEventListener('click', async () => {
      editor.commit();
      say('');
      create.disabled = true;
      try {
        const rymUrl = rymInput.value.trim();
        const made = await api.createAlbum({ ...preview, genres: editor.get(), ...(rymUrl ? { rymUrl } : {}) });
        dlg.close();
        toast(`Added "${made.title}"`);
        window.dispatchEvent(new Event(ALBUMS_CHANGED));
      } catch (ex) {
        create.disabled = false;
        if (ex.status === 409 || ex.code === 'already_exists') {
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
      el('div', { class: 'field album-rym' }, el('label', { class: 't-caption muted' }, 'RateYourMusic link (optional)'), rymInput),
      trackList(preview.tracks || []),
      el('div', { class: 'add-foot' }, back, create)));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = url.value.trim();
    if (!address) { say('Paste a Discogs release address.'); url.focus(); return; }
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
  });

  dlg.onclose = () => {
    live = false;
    dlg.replaceChildren();
    dlg.onclose = null;
    dlg.onclick = null;
    if (opener?.isConnected) opener.focus();
  };
  dlg.replaceChildren(
    dialogHead('Add album from Discogs', 'Save the album\'s tracks; link your songs to them afterwards.', () => dlg.close()),
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
    const listSlot = el('div', { class: 'albums-list' }, el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading albums...'));
    const facetRow = el('div', { class: 'cats albums-facets', role: 'group', 'aria-label': 'Filter albums', hidden: true });
    const sel = { genres: new Set(), years: new Set() };
    let all = [];
    body.replaceChildren(facetRow, listSlot);
    const reload = () => { void loadList(); };
    window.addEventListener(ALBUMS_CHANGED, reload);
    cleanups.push(() => window.removeEventListener(ALBUMS_CHANGED, reload));

    async function loadList() {
      let albums;
      try { albums = await api.albums(); } catch { if (!gone) listSlot.replaceChildren(loadFail(loadList)); return; }
      const full = await Promise.all(albums.map((a) => api.album(a.id).then((d) => ({ ...a, ...d }), () => a)));
      if (gone) return;
      all = full;
      paintAll();
    }
    function paintAll() {
      for (const f of FACETS) for (const v of [...sel[f.id]]) if (!facetValues(all, f).some((x) => x.value === v)) sel[f.id].delete(v);
      facetRow.hidden = !all.length;
      facetRow.replaceChildren(...FACETS.map((f) => {
        const values = facetValues(all, f);
        const n = sel[f.id].size;
        const b = el('button', {
          class: `cat-chip${n ? ' on' : ''}`, type: 'button', disabled: !values.length, 'aria-haspopup': 'dialog', 'data-cat': f.id,
          onclick: () => openFacetSheet(f, b, all, sel, paintAll),
        }, f.name, el('small', { class: 't-caption' }, n || values.length));
        b.setAttribute('aria-label', n ? `${f.name}, ${n} selected` : `${f.name}, ${values.length}`);
        return b;
      }));
      const shown = all.filter((a) => matchesFacets(a, sel));
      listSlot.replaceChildren(!all.length
        ? el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, 'No albums yet. Press Add Album and paste a Discogs release address.'))
        : shown.length
          ? el('div', { class: 'group album-group' }, el('ul', { class: 'songs album-list' }, shown.map(albumRow)))
          : el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, 'No albums match. Clear the filters.')));
    }
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
