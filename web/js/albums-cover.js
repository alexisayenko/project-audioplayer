import { api } from './api.js';
import { store } from './store.js';
import { el, plural, toast } from './dom.js';
import { fileProblem, coverError, COVER_TYPES } from './cover-edit.js';

export function albumCoverImg(album, alt = '', cls = 'cover') {
  const img = el('img', { class: cls, alt, loading: 'lazy' });
  if (album?.coverUrl) img.src = album.coverUrl;
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

const sizeText = (c) => (c.width && c.height ? `${c.width}×${c.height}` : '');
const labelOf = (c) => c.label || ({ discogs: 'Discogs', wikipedia: 'Wikipedia', youtube: 'YouTube' }[c.source] || c.source || 'Image');

export function sourceNote(album) {
  if (album.coverFrom === 'album') {
    const s = album.cover?.source;
    const from = s ? ` (${{ discogs: 'Discogs', wikipedia: 'Wikipedia', youtube: 'YouTube', url: 'an address', upload: 'an upload' }[s] || s})` : '';
    return `Own cover${from}`;
  }
  if (album.coverFrom === 'song') return 'Showing the cover of the first linked song';
  return 'No cover yet';
}

export function songsResult(r) {
  const n = (k) => `${k} ${plural(k, 'song', 'songs')}`;
  const parts = [];
  if (r.applied) parts.push(`Set art on ${n(r.applied)}`);
  if (r.unchanged) parts.push(`${n(r.unchanged)} already had this art`);
  if (r.skipped) parts.push(`${n(r.skipped)} kept their own art: click again to replace it`);
  if (r.failed) parts.push(`${n(r.failed)} failed`);
  return parts.join('. ') || 'No linked songs';
}

const CHANGED = ['cover', 'coverUrl', 'coverFrom'];

export function albumCoverSection(album, onChanged = () => {}) {
  const id = album.id;
  const img = el('img', { class: 'cover cover-edit-img', alt: '' });
  const note = el('p', { class: 't-caption muted album-cover-note' });
  const msg = el('p', { class: 't-caption muted', role: 'status' });
  const cands = el('div', { class: 'album-cover-cands', 'aria-label': 'Cover suggestions', role: 'group' });
  const file = el('input', { type: 'file', accept: COVER_TYPES.join(','), hidden: true, tabindex: '-1' });
  const upload = el('button', { type: 'button', class: 'btn outline small album-cover-upload', onclick: () => file.click() }, 'Upload image');
  const remove = el('button', { type: 'button', class: 'btn outline small album-cover-remove', onclick: () => void apply(() => api.removeAlbumCover(id), 'Cover removed') }, 'Remove cover');
  const toSongs = el('button', { type: 'button', class: 'btn outline small album-cover-songs', title: 'Use this cover for all linked songs', onclick: () => { void useForSongs(); } }, 'Use for songs');
  const hint = el('p', { class: 't-caption muted album-cover-songs-hint', hidden: true });
  let found = [];
  let busy = false;
  let replacing = 0;

  const linkedCount = () => (album.tracks || []).filter((t) => t.songId && store.get(t.songId)).length;
  const paintSongs = () => {
    const why = album.coverFrom !== 'album' ? 'Set a cover of its own first' : !linkedCount() ? 'No linked songs' : '';
    toSongs.disabled = busy || !!why;
    toSongs.textContent = replacing ? `Replace art on ${replacing} ${plural(replacing, 'song', 'songs')}` : 'Use for songs';
    hint.textContent = why;
    hint.hidden = !why;
  };

  const paint = () => {
    if (album.coverUrl) img.src = album.coverUrl; else img.removeAttribute('src');
    img.classList.toggle('noart', !album.coverUrl);
    note.textContent = sourceNote(album);
    remove.hidden = album.coverFrom !== 'album';
    replacing = 0;
    paintSongs();
    paintCands();
  };

  const setBusy = (on) => {
    busy = on;
    for (const b of [upload, remove, ...cands.querySelectorAll('button')]) b.disabled = on;
    if (on) msg.textContent = 'Working...';
    paintSongs();
  };

  async function useForSongs() {
    setBusy(true);
    try {
      const r = await api.albumCoverToSongs(id, replacing > 0);
      if (r.applied) api.bumpCovers();
      await store.refresh().catch(() => {});
      replacing = r.skipped;
      const text = songsResult(r);
      msg.textContent = text;
      if (r.applied) toast(text);
    } catch (ex) {
      replacing = 0;
      msg.textContent = ex.status === 409 ? 'Set a cover of its own first.' : coverError(ex);
    } finally {
      setBusy(false);
    }
  }

  async function apply(run, done) {
    setBusy(true);
    try {
      const full = await run();
      for (const k of CHANGED) album[k] = full[k];
      msg.textContent = done;
      toast(done);
      paint();
      onChanged(full);
    } catch (ex) {
      msg.textContent = coverError(ex);
    } finally {
      setBusy(false);
    }
  }

  function paintCands() {
    cands.replaceChildren(...found.map((c) => {
      const on = !!album.cover?.url && album.cover.url === c.url;
      const thumb = el('img', { class: 'cover album-cover-thumb', alt: '', loading: 'lazy', src: c.thumb || c.url, referrerpolicy: 'no-referrer' });
      thumb.addEventListener('error', () => thumb.removeAttribute('src'));
      return el('button', {
        type: 'button', class: 'album-cover-cand', 'aria-pressed': String(on), title: `${labelOf(c)} ${sizeText(c)}`.trim(), disabled: busy,
        onclick: () => { void apply(() => api.setAlbumCover(id, { source: c.source, url: c.url }), 'Cover updated'); },
      }, thumb, el('span', { class: 't-caption' }, labelOf(c)), sizeText(c) ? el('span', { class: 't-caption muted' }, sizeText(c)) : null);
    }));
  }

  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    const bad = fileProblem(f);
    if (bad) { msg.textContent = bad; return; }
    void apply(() => api.uploadAlbumCover(id, f), 'Cover updated');
  });

  const status = el('p', { class: 't-caption muted', role: 'status' }, 'Looking for covers...');
  api.albumCoverCandidates(id).then((r) => {
    found = Array.isArray(r?.candidates) ? r.candidates : [];
    status.textContent = found.length ? '' : 'No covers found.';
    paintCands();
  }, () => { status.textContent = 'Could not load cover suggestions.'; });

  paint();
  const node = el('div', { class: 'cover-edit album-cover-edit' }, img,
    el('div', { class: 'cover-edit-body' },
      el('p', { class: 't-subhead' }, 'Cover'), note, status, cands,
      el('div', { class: 'album-cover-actions' }, upload, remove, toSongs), hint, msg, file));
  return { node, paint };
}
