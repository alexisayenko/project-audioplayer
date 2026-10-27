import { api } from './api.js';
import { el } from './dom.js';
import { previewErrorText } from './album-video-model.js';
import { youtubeErrorText } from './album-candidates.js';
import {
  classifyAddress, applyPreview, sameSource, needsRestart, normalisePasted, offline, unreachable,
  OFFLINE_MESSAGE, NO_TRACKLIST, NO_TRACKS_TEXT,
} from './album-wizard-model.js';

export const RESTART_MESSAGE = 'Start over from this link? Your edits to the album and tracks will be replaced.';
const PLAYLIST_EMPTY = 'This playlist has no playable videos.';

export function mountLink(ctx) {
  const { draft } = ctx;
  let confirming = false;
  const input = el('input', {
    type: 'text', id: 'wiz-url', placeholder: 'YouTube playlist or video address', 'aria-label': 'YouTube playlist or video address',
    autocomplete: 'off', inputMode: 'url', value: draft.address,
  });
  const area = el('textarea', { class: 'av-paste', rows: 8, 'aria-label': 'Track list', placeholder: '00:00 Artist - Title\n03:45 Artist - Title\n\nOr with lengths: 1 Artist - Title 9:18', value: draft.pasteText });
  const intro = el('p', { class: 'muted t-subhead' }, NO_TRACKLIST);
  const pasteBox = el('div', { class: 'wiz-paste', hidden: !draft.needPaste }, intro, area);
  const toggle = el('button', { class: 'link-btn t-caption', type: 'button', 'aria-expanded': String(!!draft.needPaste) }, 'No time codes? Paste a track list');
  const showPaste = (on, text) => {
    draft.needPaste = on;
    pasteBox.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (text) intro.textContent = text;
    if (on) area.focus();
  };
  toggle.addEventListener('click', () => showPaste(pasteBox.hidden, NO_TRACKLIST));
  input.addEventListener('input', () => { if (confirming) { confirming = false; ctx.setNext('Next'); ctx.say(''); } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.submit(); } });

  async function read(c, text) {
    const video = c.kind === 'video';
    ctx.busy(true, video ? 'Reading the video...' : 'Reading the playlist...');
    try {
      let preview;
      if (!video) preview = await api.albumYoutubePreview(c.url);
      else if (text) preview = await api.albumVideoPreviewText({ url: c.url, text: normalisePasted(text).text });
      else preview = await api.albumVideoPreview(c.url);
      if (!ctx.live()) return;
      const tracks = Array.isArray(preview?.tracks) ? preview.tracks : [];
      if (!tracks.length) {
        if (video) { showPaste(true, text ? NO_TRACKS_TEXT : NO_TRACKLIST); if (text) ctx.say(NO_TRACKS_TEXT); else ctx.say(''); return; }
        ctx.say(PLAYLIST_EMPTY);
        return;
      }
      draft.address = input.value.trim();
      draft.pasteText = area.value;
      draft.pastedUsed = text;
      applyPreview(draft, c.kind, c.url, preview);
      ctx.go('details');
    } catch (ex) {
      if (!ctx.live()) return;
      if (video && ex.status === 422) {
        showPaste(true, text ? NO_TRACKS_TEXT : NO_TRACKLIST);
        ctx.say(text ? NO_TRACKS_TEXT : '');
      } else if (unreachable(ex)) ctx.say(offline() ? OFFLINE_MESSAGE : 'The server could not be reached. Check the connection and try again.');
      else ctx.say(video ? previewErrorText(ex) : youtubeErrorText(ex));
    } finally {
      ctx.busy(false);
    }
  }

  const node = el('div', { class: 'wiz-step wiz-link' },
    el('div', { class: 'field' }, el('label', { for: 'wiz-url' }, 'YouTube playlist or video'), el('div', { class: 'well' }, input)),
    el('p', { class: 'muted t-caption' }, 'A playlist gives one track per video. A video needs time codes in its chapters or description.'),
    toggle, pasteBox);

  return {
    node, back: false, focus: () => input.focus(), nextLabel: 'Fetch',
    async run() {
      if (offline()) { ctx.say(OFFLINE_MESSAGE); return; }
      const address = input.value.trim();
      const c = classifyAddress(address);
      if (!c.ok) {
        ctx.say(c.error, null, c.hint);
        input.focus();
        return;
      }
      const text = c.kind === 'video' ? area.value.trim() : '';
      const unchanged = sameSource(draft, address) && (draft.pastedUsed || '') === text;
      if (unchanged) { ctx.go('details'); return; }
      if (!confirming && draft.preview && draft.edited && (needsRestart(draft, address) || sameSource(draft, address))) {
        confirming = true;
        ctx.say(RESTART_MESSAGE);
        ctx.setNext('Replace my edits');
        return;
      }
      confirming = false;
      ctx.say('');
      await read(c, text);
    },
  };
}
