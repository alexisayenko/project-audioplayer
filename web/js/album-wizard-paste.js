import { api } from './api.js';
import { el } from './dom.js';
import {
  applyTracks, normalisePasted, offline, unreachable, OFFLINE_MESSAGE, NO_TRACKLIST, NO_TRACKS_TEXT,
} from './album-wizard-model.js';

export const PASTE_EMPTY_LABEL = 'No time codes? Paste a track list';
export const PASTE_EDIT_LABEL = 'Edit or paste a track list';
export const PASTE_PLACEHOLDER = '00:00 Artist - Title\n03:45 Artist - Title\n\nOr with lengths: 1 Artist - Title 9:18';

export function mountPaste(ctx, { empty }) {
  const { draft } = ctx;
  const area = el('textarea', { class: 'av-paste', rows: 8, 'aria-label': 'Track list', placeholder: PASTE_PLACEHOLDER, value: draft.pasteText || draft.st.rawText || '' });
  const note = el('p', { class: 't-caption muted wiz-paste-note', role: 'status' });
  const apply = el('button', { class: 'btn outline small wiz-paste-apply', type: 'button' }, 'Use this list');
  const box = el('div', { class: 'wiz-paste', hidden: true }, el('p', { class: 'muted t-subhead' }, NO_TRACKLIST), area, apply, note);
  const toggle = el('button', { class: 'link-btn t-caption wiz-paste-toggle', type: 'button', 'aria-expanded': 'false' }, empty ? PASTE_EMPTY_LABEL : PASTE_EDIT_LABEL);
  toggle.addEventListener('click', () => {
    box.hidden = !box.hidden;
    toggle.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) area.focus();
  });

  apply.addEventListener('click', async () => {
    const text = area.value.trim();
    note.textContent = '';
    if (!text) { note.textContent = NO_TRACKS_TEXT; return; }
    if (offline()) { note.textContent = OFFLINE_MESSAGE; return; }
    ctx.busy(true, 'Reading the track list...');
    try {
      const preview = await api.albumVideoPreviewText({ url: draft.url, text: normalisePasted(text).text });
      if (!ctx.live()) return;
      if (!Array.isArray(preview?.tracks) || !preview.tracks.length) { note.textContent = NO_TRACKS_TEXT; return; }
      applyTracks(draft, preview, area.value);
      ctx.go('review');
    } catch (ex) {
      if (!ctx.live()) return;
      if (ex.status === 422) note.textContent = NO_TRACKS_TEXT;
      else if (unreachable(ex)) note.textContent = offline() ? OFFLINE_MESSAGE : 'The server could not be reached. Check the connection and try again.';
      else note.textContent = 'The track list could not be read. Try again.';
    } finally {
      ctx.busy(false);
    }
  });

  return { node: el('div', { class: 'wiz-paste-wrap' }, toggle, box) };
}
