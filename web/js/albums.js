import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { serviceIcons } from './service-icons.js';
import { can } from './guest.js';
import { playlistsOn } from './playlists-store.js';
import { openPlaylistPicker } from './lazy-ui.js';
import { el, fmtTime, plural, toast } from './dom.js';
import { icon } from './icons.js';
import { dialogHead } from './edit-dialog.js';
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

export function openAlbumCard(album, opener = null) {
  const dlg = document.getElementById('song-card');
  const close = () => dlg.close();
  const closeBtn = el('button', { type: 'button', class: 'card-close', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('clear', 'nav'));
  const art = el('div', { class: 'card-art album-art' }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')), closeBtn);
  const links = albumLinks(album);
  const svc = Object.keys(links).length ? serviceIcons({ onlyOn: true }) : null;
  svc?.setState(links);
  const genres = Array.isArray(album.genres) ? album.genres.filter(Boolean) : [];
  const tracks = album.tracks || [];
  dlg.setAttribute('tabindex', '-1');
  dlg.replaceChildren(...[
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    art,
    el('div', { class: 'card-head' },
      el('h2', { id: 'song-card-title', class: 't-title' }, [album.artist, album.title].filter(Boolean).join(' - ')),
      el('p', { class: 'card-sub t-subhead album-facts-line' }, albumFacts(album))),
    genres.length ? el('div', { class: 'chips album-genres' }, genres.map((g) => el('span', { class: 'tag ns t-caption' }, g))) : null,
    svc?.node,
    tracks.length ? el('ol', { class: 'album-tracks album-info-tracks' }, tracks.map((t) => el('li', { class: 'album-track' },
      el('span', { class: 'album-no muted t-caption' }, `${t.no}.`),
      el('span', { class: 'album-name t-subhead' }, t.title),
      el('span', { class: 'album-len muted t-caption' }, lengthText(t.durationS))))) : null].filter(Boolean));
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  dlg.addEventListener('close', () => { dlg.replaceChildren(); if (opener?.isConnected) opener.focus(); }, { once: true });
  if (!dlg.open) dlg.showModal();
  dlg.focus();
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

const loadFail = (retry) => el('div', { class: 'state card' },
  el('p', { class: 'msg error', role: 'alert' }, 'Albums could not be loaded. Check the connection and try again.'),
  el('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry'));

export const linkedSongs = (tracks) => (tracks || []).filter((t) => t.songId).map((t) => store.get(t.songId)).filter(Boolean);

const NOT_YET = () => toast('Not implemented yet');

function albumActions(a) {
  const songs = linkedSongs(a.tracks);
  const off = !songs.length;
  const btn = (name, label, run, cls = '') => el('button', {
    class: `icon sq-btn album-act ${cls}`.trim(), type: 'button', disabled: off,
    title: off ? 'No songs linked yet' : label, 'aria-label': `${label}: ${a.title}`, onclick: run,
  }, icon(name, 'inline'));
  const row = [
    btn('playPlus', 'Play next', NOT_YET, 'act-next'),
    btn('listAdd', 'Add to queue', () => {
      const { added, already, fetching } = player.addListed(songs, '');
      const note = already ? ` (${already} already in queue)` : '';
      const dl = fetching ? `, ${fetching} downloading` : '';
      toast(`Added ${added} ${plural(added, 'song', 'songs')}${dl}${note}`);
    }, 'act-queue album-queue'),
    playlistsOn() ? btn('playlistPlus', 'Add to playlist...', (e) => { void openPlaylistPicker(songs, e.currentTarget); }, 'act-pl') : null,
    btn('share', 'Share link', NOT_YET, 'act-share'),
    can('download') ? btn('download', 'Download', NOT_YET, 'act-download') : null,
    can('edit') ? btn('pencil', 'Edit', NOT_YET, 'act-edit') : null,
  ].filter(Boolean);
  return el('div', { class: 'album-acts' }, row);
}

function albumCard(a) {
  const tracks = a.tracks;
  return el('li', { class: 'card album-card' },
    albumActions(a),
    el('div', { class: 'album-body' },
      albumHead(a, 'span', (opener) => openAlbumCard(a, opener)),
      tracks ? trackList(tracks) : el('p', { class: 'muted t-caption' }, `${a.trackCount} ${plural(a.trackCount, 'track', 'tracks')}`),
      el('a', { class: 'link-btn album-page-link', href: `#/library/albums/${encodeURIComponent(a.id)}` }, 'Album page')));
}

export function mountAlbums(pane, id = albumIdOf(location.hash)) {
  let gone = false;
  const body = el('div', { class: 'albums' });
  pane.replaceChildren(body);

  async function showList() {
    let preview = null;
    const url = el('input', { class: 'albums-url', type: 'url', placeholder: 'Discogs release address, https://www.discogs.com/release/...', 'aria-label': 'Discogs release address', autocomplete: 'off' });
    const add = el('button', { class: 'btn primary glow', type: 'submit' }, 'Add Album', icon('plus', 'action'));
    const row = el('form', { class: 'albums-row' }, url, add);
    const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
    const previewSlot = el('div', { class: 'albums-preview' });
    const listSlot = el('div', { class: 'albums-list' }, el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading albums...'));
    const facetRow = el('div', { class: 'cats albums-facets', role: 'group', 'aria-label': 'Filter albums', hidden: true });
    const sel = { genres: new Set(), years: new Set() };
    let all = [];
    body.replaceChildren(row, err, facetRow, previewSlot, listSlot);

    const fail = (text, link) => {
      err.replaceChildren(text, ...(link ? [' ', link] : []));
      err.hidden = false;
    };
    const clearPreview = () => { preview = null; previewSlot.replaceChildren(); };

    function paintPreview() {
      const create = el('button', { class: 'btn primary', type: 'button' }, 'Create');
      const cancel = el('button', { class: 'btn outline', type: 'button', onclick: () => { clearPreview(); err.hidden = true; } }, 'Cancel');
      create.addEventListener('click', async () => {
        err.hidden = true;
        create.disabled = true;
        try {
          const made = await api.createAlbum(preview);
          clearPreview();
          url.value = '';
          toast(`Added "${made.title}"`);
          await loadList();
        } catch (ex) {
          create.disabled = false;
          if (ex.status === 409 || ex.code === 'already_exists') {
            const existing = ex.data?.id ?? ex.data?.detail?.id;
            fail('This album already exists.', existing ? el('a', { href: `#/library/albums/${encodeURIComponent(existing)}` }, 'Open it') : null);
          } else fail(ex.message || 'The album could not be created.');
        }
      });
      previewSlot.replaceChildren(el('div', { class: 'card album-card album-preview' },
        albumHead(preview),
        trackList(preview.tracks || []),
        el('div', { class: 'row end' }, cancel, create)));
    }

    row.addEventListener('submit', async (e) => {
      e.preventDefault();
      const address = url.value.trim();
      if (!address) { fail('Paste a Discogs release address.'); url.focus(); return; }
      err.hidden = true;
      clearPreview();
      add.disabled = true;
      try {
        preview = await api.albumPreview(address);
        paintPreview();
      } catch (ex) {
        fail(fetchErrorText(ex));
      } finally {
        add.disabled = false;
      }
    });

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
        ? el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, 'No albums yet. Paste a Discogs release address above and press Add Album.'))
        : shown.length
          ? el('ul', { class: 'album-grid' }, shown.map(albumCard))
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
    const del = el('button', { class: 'btn danger small', type: 'button', onclick: () => confirmDeleteAlbum(album, () => { toast(`Deleted "${album.title}"`); location.hash = '#/library/albums'; }) }, icon('trash', 'inline'), 'Delete album');
    body.replaceChildren(
      el('a', { class: 'link-btn album-back', href: '#/library/albums' }, icon('chevronLeft', 'inline'), 'Albums'),
      albumHead(album, 'h2', (opener) => openAlbumCard(album, opener)),
      el('div', { class: 'album-actions' }, del),
      trackList(tracks));
  }

  const started = id ? showPage() : showList();
  const unmount = () => { gone = true; };
  unmount.ready = started;
  return unmount;
}
