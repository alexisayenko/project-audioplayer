import { api } from './api.js';
import { store } from './store.js';
import { el, plural, toast } from './dom.js';

export function genresResult(r) {
  const n = (k) => `${k} ${plural(k, 'song', 'songs')}`;
  const parts = [];
  if (r.applied) parts.push(`Set genres on ${n(r.applied)}`);
  if (r.unchanged) parts.push(`${n(r.unchanged)} already had these genres`);
  if (r.skipped) parts.push(`${n(r.skipped)} kept their own genres: click again to replace them`);
  if (r.failed) parts.push(`${n(r.failed)} failed`);
  return parts.join('. ') || 'No linked songs';
}

const genreError = (ex) => {
  if (ex?.status === 0) return 'Could not reach the server. Try again.';
  if (ex?.status === 409) return 'Add genres from the genre tree to the album first.';
  return ex?.message || 'Could not set the genres.';
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function albumGenresToSongs(album, editor) {
  const id = album.id;
  const saved = () => (Array.isArray(album.genres) ? album.genres.filter(Boolean) : []);
  const btn = el('button', { type: 'button', class: 'btn outline small album-genres-songs', onclick: () => { void run(); } }, 'Use for songs');
  const hint = el('p', { class: 't-caption muted album-genres-songs-hint', hidden: true });
  const msg = el('p', { class: 't-caption muted', role: 'status' });
  let busy = false;
  let replacing = 0;

  const linkedCount = () => (album.tracks || []).filter((t) => t.songId && store.get(t.songId)).length;
  const why = () => {
    if (!same(editor.get(), saved())) return 'Save the album to use the changed genres';
    if (!saved().length) return 'Add genres to the album first';
    if (!linkedCount()) return 'No linked songs';
    return '';
  };
  const paint = () => {
    const reason = why();
    btn.disabled = busy || !!reason;
    btn.textContent = replacing ? `Replace genres on ${replacing} ${plural(replacing, 'song', 'songs')}` : 'Use for songs';
    btn.title = replacing ? "Replace their genres with the album's genres" : 'Give these genres to all linked songs';
    hint.textContent = reason;
    hint.hidden = !reason;
  };

  async function run() {
    busy = true;
    msg.textContent = 'Working...';
    paint();
    try {
      const r = await api.albumGenresToSongs(id, replacing > 0);
      await store.refresh().catch(() => {});
      replacing = r.skipped;
      const text = genresResult(r);
      msg.textContent = text;
      if (r.applied) toast(text);
    } catch (ex) {
      replacing = 0;
      msg.textContent = genreError(ex);
    } finally {
      busy = false;
      paint();
    }
  }

  editor.subscribe(() => { replacing = 0; paint(); });
  paint();
  const node = el('div', { class: 'album-genres-songs-row' }, el('div', { class: 'album-genres-actions' }, btn), hint, msg);
  return { node, paint };
}
