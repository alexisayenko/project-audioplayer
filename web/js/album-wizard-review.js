import { api } from './api.js';
import { el } from './dom.js';
import { createErrorText } from './album-video-model.js';
import { youtubeErrorText, errorCode, QUOTA_PER_HOUR } from './album-candidates.js';
import {
  artistName, buildReview, createIssues, createPayload, createLabel, summaryText, reviewRows, fieldIssues, offline, unreachable,
  OFFLINE_MESSAGE,
} from './album-wizard-model.js';
import { mountRows } from './album-wizard-rows.js';
import { artPicker, genreArea, typeSelect } from './album-wizard-extras.js';

export const NETWORK_MESSAGE = 'The server could not be reached. Check the connection and try again.';

function failure(ctx, ex) {
  const { draft } = ctx;
  if (unreachable(ex)) { ctx.say(offline() ? OFFLINE_MESSAGE : NETWORK_MESSAGE); return; }
  const code = errorCode(ex);
  if (ex.status === 409 && code === 'already_exists') {
    const id = ex.data?.id ?? ex.data?.detail?.id;
    ctx.say('This album already exists.', id ? ctx.openExisting(id) : null);
    return;
  }
  if (draft.kind === 'video' && code === 'unknown_song') {
    for (const s of draft.review.state.values()) s.useExisting = false;
    ctx.say(createErrorText(ex));
    return;
  }
  ctx.say(draft.kind === 'video' ? createErrorText(ex) : youtubeErrorText(ex));
}

export function mountReview(ctx) {
  const { draft } = ctx;
  if (!draft.review) buildReview(draft);
  let owner = false;
  const strip = el('div', { class: 'wiz-strip' },
    el('div', { class: 'wiz-strip-text' },
      el('div', { class: 't-headline' }, [artistName(draft.fields.artist), draft.fields.album.trim()].filter(Boolean).join(' - '), draft.fields.year ? ` · ${draft.fields.year}` : ''),
      el('label', { class: 'wiz-type t-caption muted' }, 'Type ', typeSelect(ctx))));
  const art = artPicker({ ...ctx, repaint: () => {} });
  const genres = genreArea(ctx);
  const stat = el('p', { class: 't-subhead av-summary', role: 'status' });
  const toggle = el('button', { class: 'link-btn t-caption av-select-all', type: 'button' });
  const problems = el('p', { class: 't-caption muted av-problems', role: 'status' });
  const quota = el('p', { class: 't-caption muted album-quota', hidden: draft.kind !== 'playlist' });
  const rows = mountRows(ctx, (redraw, focus) => { if (redraw) rows.draw(focus); paint(); });

  function paint() {
    const issues = createIssues(draft);
    stat.textContent = summaryText(draft);
    problems.textContent = issues[0] || '';
    toggle.textContent = rows.allOn() ? 'Select none' : 'Select all';
    rows.paintRows();
    const label = createLabel(draft);
    ctx.setNext(label, issues.length > 0);
    const k = reviewRows(draft).filter((r) => r.src && r.st.include && !r.src.songId).length;
    quota.textContent = `${k} selected, up to ${QUOTA_PER_HOUR} fetches an hour, it pauses and resumes.`;
    quota.hidden = draft.kind !== 'playlist' || owner;
  }
  toggle.addEventListener('click', () => { rows.setAll(!rows.allOn()); ctx.touch(); paint(); });
  void api.me().then((m) => { if (ctx.live() && m?.owner === true) { owner = true; paint(); } }, () => {});

  const node = el('div', { class: 'wiz-step wiz-review' },
    strip, art, genres.node,
    el('section', { class: 'wiz-sec' },
      el('h3', { class: 't-headline' }, 'Tracks'),
      el('p', { class: 'muted t-caption' }, draft.review.disc.length
        ? 'The Discogs tracklist, with the matching track from the YouTube address under each. Pick another, or skip a track.'
        : 'The tracks found at the YouTube address.'),
      el('div', { class: 'av-bar-row' }, stat, toggle),
      rows.node,
      problems,
      draft.kind === 'video'
        ? el('p', { class: 't-caption muted' }, 'Tick the tracks to import. The whole split counts as one add.')
        : quota));
  rows.draw();
  paint();

  return {
    node, back: true,
    nextLabel: createLabel(draft),
    async run() {
      genres.commit();
      draft.album.type = draft.album.type || 'album';
      const bad = [...fieldIssues(draft.fields), ...createIssues(draft)];
      if (bad.length) { ctx.say(bad[0]); return; }
      if (offline()) { ctx.say(OFFLINE_MESSAGE); return; }
      ctx.say('');
      ctx.busy(true, draft.kind === 'video' ? 'Starting the import...' : 'Importing the album...');
      const body = createPayload(draft);
      try {
        if (draft.kind === 'video') {
          const made = await api.albumFromVideo(body);
          draft.job = { kind: 'video', jobId: made.jobId, albumId: made.albumId, body };
        } else {
          const done = await api.albumYoutubeCommit(body);
          draft.job = { kind: 'playlist', result: done, body };
        }
        if (ctx.live()) ctx.go('run');
      } catch (ex) {
        if (ctx.live()) { failure(ctx, ex); paint(); }
      } finally {
        ctx.busy(false);
      }
    },
  };
}
