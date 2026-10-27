import { api } from './api.js';
import { el } from './dom.js';
import { previewErrorText } from './album-video-model.js';
import { youtubeErrorText } from './album-candidates.js';
import {
  classifyAddress, applyPreview, sameSource, needsRestart, offline, unreachable,
  OFFLINE_MESSAGE,
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
  const fetchBtn = el('button', { class: 'btn fill small wiz-fetch', type: 'button' }, 'Fetch');
  let busy = false;
  const paintFetch = () => { fetchBtn.disabled = busy || !input.value.trim(); };
  ctx.watchBusy((on) => { busy = on; fetchBtn.toggleAttribute('aria-busy', on); paintFetch(); });
  fetchBtn.addEventListener('click', () => ctx.submit());
  paintFetch();
  input.addEventListener('input', () => {
    paintFetch();
    if (confirming) { confirming = false; fetchBtn.textContent = 'Fetch'; fetchBtn.removeAttribute('aria-label'); ctx.say(''); }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.submit(); } });

  async function read(c) {
    const video = c.kind === 'video';
    ctx.busy(true, video ? 'Reading the video...' : 'Reading the playlist...');
    try {
      const preview = video ? await api.albumVideoPreview(c.url, true) : await api.albumYoutubePreview(c.url);
      if (!ctx.live()) return;
      const tracks = Array.isArray(preview?.tracks) ? preview.tracks : [];
      if (!tracks.length && !video) {
        ctx.say(PLAYLIST_EMPTY);
        return;
      }
      draft.address = input.value.trim();
      applyPreview(draft, c.kind, c.url, preview);
      ctx.go('details');
    } catch (ex) {
      if (!ctx.live()) return;
      if (unreachable(ex)) ctx.say(offline() ? OFFLINE_MESSAGE : 'The server could not be reached. Check the connection and try again.');
      else ctx.say(video ? previewErrorText(ex) : youtubeErrorText(ex));
    } finally {
      ctx.busy(false);
    }
  }

  const node = el('div', { class: 'wiz-step wiz-link' },
    el('div', { class: 'field' }, el('label', { for: 'wiz-url' }, 'YouTube playlist or video'), el('div', { class: 'well wiz-well' }, input, fetchBtn)),
    el('p', { class: 'muted t-caption' }, 'A playlist gives one track per video. A video gives its tracks from the time codes in its chapters or description; without them you can paste the list on the Review step.'));

  return {
    node, back: false, hideNext: true, focus: () => input.focus(),
    async run() {
      if (offline()) { ctx.say(OFFLINE_MESSAGE); return; }
      const address = input.value.trim();
      const c = classifyAddress(address);
      if (!c.ok) {
        ctx.say(c.error, null, c.hint);
        input.focus();
        return;
      }
      if (sameSource(draft, address)) { ctx.go('details'); return; }
      if (!confirming && draft.preview && draft.edited && needsRestart(draft, address)) {
        confirming = true;
        ctx.say(RESTART_MESSAGE);
        fetchBtn.textContent = 'Replace';
        fetchBtn.setAttribute('aria-label', 'Replace my edits');
        return;
      }
      confirming = false;
      fetchBtn.textContent = 'Fetch';
      fetchBtn.removeAttribute('aria-label');
      ctx.say('');
      await read(c);
    },
  };
}
