import { api } from './api.js';
import { el, plural, toast } from './dom.js';
import { icon } from './icons.js';
import { startDownloads } from './albums-youtube.js';
import {
  ALBUMS_CHANGED, QUOTA_PER_HOUR, errorCode, youtubeErrorText, searchErrorText, countOfList, list, lengthText, matchMark,
  candidateLines, candidateBody, matchMap, autoMatch, candidatePayload, fetchErrorText,
} from './album-candidates.js';

export function createYoutubeFlow({ body, say, close, isLive, setBusy, hideForm, showForm, clearUrl, openAlbumCard }) {
  let yt = null;
  let owner = false;

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
      if (!isLive()) return;
      yt.candidates = Array.isArray(r?.candidates) ? r.candidates : [];
      yt.searchError = '';
      const best = yt.candidates.findIndex((c) => c.best);
      yt.sel = yt.candidates.length ? Math.max(0, best) : -1;
    } catch (ex) {
      if (!isLive()) return;
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
    setBusy(true);
    try {
      const pv = await api.albumPreview(address);
      if (!isLive()) return;
      const cand = {
        url: address, title: pv.title, artist: pv.artist, year: pv.year, trackCount: (pv.tracks || []).length, genres: pv.genres, source: pv.source,
        tracks: pv.tracks || [], links: { discogs: address }, matches: autoMatch(yt.tracks, pv.tracks),
      };
      yt.candidates = [cand, ...yt.candidates];
      yt.sel = 0;
      yt.expanded = false;
      hideForm();
      clearUrl();
      applyDefaults();
      renderYt();
    } catch (ex) {
      if (isLive()) say(fetchErrorText(ex));
    } finally {
      setBusy(false);
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
      const { candidate, mapping } = await candidateWithMapping(c, positions);
      const selected = yt.tracks.filter((t) => yt.checked[t.position]).map(({ position, videoId, title, durationS }) => ({ position, videoId, title, durationS: durationS ?? null }));
      const r = await api.albumYoutubeCommit({ playlistUrl: yt.url, selected, candidate, mapping, fallback });
      close();
      window.dispatchEvent(new Event(ALBUMS_CHANGED));
      const ids = (r.songs || []).map((s) => s.songId);
      const k = await startDownloads(ids);
      const linked = countOfList(r.linked);
      const unlinked = countOfList(r.unlinked);
      toast(`Album created, ${linked} ${plural(linked, 'song', 'songs')} linked, ${unlinked} not matched; downloading ${k} ${plural(k, 'track', 'tracks')}`);
    } catch (ex) {
      create.disabled = false;
      sayCommitError(ex);
    }
  }

  async function candidateWithMapping(c, positions) {
    if (!c) return { candidate: null, mapping: {} };
    let candidate = candidatePayload(c, yt.url);
    if (!candidate.tracks.length) {
      const pv = await api.albumPreview(c.url);
      candidate = { ...candidate, tracks: pv.tracks || [], genres: candidate.genres.length ? candidate.genres : list(pv.genres), source: candidate.source || pv.source };
    }
    const mapping = {};
    const mp = matchMap(c);
    for (const pos of positions) if (mp.has(pos)) mapping[pos] = mp.get(pos).no;
    return { candidate, mapping };
  }

  function sayCommitError(ex) {
    if (ex.status !== 409 || errorCode(ex) !== 'already_exists') { say(youtubeErrorText(ex)); return; }
    const existing = ex.data?.id ?? ex.data?.detail?.id;
    say('This album already exists.', existing ? el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { void api.album(existing).then((full) => { close(); openAlbumCard(full); }, (error_) => say(error_.message)); } }, 'Open it') : null);
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
      let radios = c ? [candidateRadio(c, yt.sel, true)] : [];
      if (yt.expanded) radios = yt.candidates.map((x, i) => el('div', { class: 'album-cand-item' }, candidateRadio(x, i, i === yt.sel)));
      box.append(el('div', { class: 'album-picked', role: 'radiogroup', 'aria-label': 'Discogs release' },
        ...radios),
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
    const paste = el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { showForm(); } }, 'Paste a Discogs link');
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
        matchMark(c, m)));
    });
    const create = el('button', { class: 'btn primary glow', type: 'button' }, icon('plus', 'nav'), toDownload > 0 ? `Create album and download ${toDownload} ${plural(toDownload, 'track', 'tracks')}` : 'Create album');
    create.disabled = selected.length === 0 && !c;
    create.addEventListener('click', () => { void commit(create); });
    const cancel = el('button', { class: 'btn outline', type: 'button', onclick: () => close() }, 'Cancel');
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
    setBusy(true);
    try {
      const r = await api.albumYoutubePreview(address);
      if (!isLive()) return;
      const tracks = Array.isArray(r.tracks) ? r.tracks : [];
      const guess = r.guess || {};
      const candidates = Array.isArray(r.candidates) ? r.candidates : [];
      const best = candidates.findIndex((c) => c.best);
      yt = {
        url: address, playlist: r.playlist || {}, guess, tracks, candidates,
        sel: candidates.length ? Math.max(0, best) : -1,
        searchError: searchErrorText(r.searchError),
        expanded: false, searching: false, manual: new Set(), checked: {},
        searchArtist: guess.artist || '', searchAlbum: guess.album || '',
        fb: { title: guess.album || r.playlist?.title || '', artist: guess.artist || '', year: guess.year ? String(guess.year) : '' },
      };
      hideForm();
      applyDefaults();
      renderYt();
      void api.me().then((m) => { if (isLive() && m?.owner === true) { owner = true; renderYt(); } }, () => {});
    } catch (ex) {
      body.replaceChildren();
      if (isLive()) say(youtubeErrorText(ex));
    } finally {
      setBusy(false);
    }
  }

  return { start: startYoutube, addPasted, active: () => !!yt };
}
