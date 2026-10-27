import { api } from './api.js';
import { el, plural, toast } from './dom.js';
import { mountSplitProgress } from './album-video-progress.js';
import { createErrorText } from './album-video-model.js';
import { startDownloads, mountDownloadStatus } from './albums-youtube.js';
import { countOfList } from './album-candidates.js';

export function mountRun(ctx, { pollMs } = {}) {
  const { draft } = ctx;
  const job = draft.job;
  return job.kind === 'video' ? videoRun(ctx, job, pollMs) : playlistRun(ctx, job);
}

function videoRun(ctx, job, pollMs) {
  const host = el('div', { class: 'wiz-progress' });
  const note = el('p', { class: 'muted t-caption' }, 'You can close this. The split continues on the server.');
  const close = el('button', { class: 'btn outline', type: 'button' }, 'Close');
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  let stop = null;
  const start = (jobId) => {
    stop?.();
    stop = mountSplitProgress({
      host, jobId, pollMs,
      onDone: (j) => { toast(j?.message || `Added "${job.body.album.title}"`); ctx.finish(job.albumId, true); },
      onRetry: () => { void retry(); },
      onOpen: () => ctx.finish(job.albumId, true),
    });
  };
  async function retry() {
    err.hidden = true;
    try {
      const made = await api.albumFromVideo(job.body);
      if (ctx.live()) start(made.jobId);
    } catch (ex) {
      err.textContent = createErrorText(ex);
      err.hidden = false;
    }
  }
  close.addEventListener('click', () => {
    stop?.();
    toast('The split continues on the server');
    ctx.finish(job.albumId, false);
  });
  start(job.jobId);
  return {
    node: el('div', { class: 'wiz-step wiz-run' }, host, err, note, el('div', { class: 'row end' }, close)),
    back: false, hideNext: true, dispose: () => stop?.(), focus: () => close.focus(),
  };
}

function playlistRun(ctx, job) {
  const r = job.result || {};
  const album = r.album || {};
  const linked = countOfList(r.linked);
  const line = el('p', { class: 't-body', role: 'status' }, `Album created, ${linked} ${plural(linked, 'song', 'songs')} added. Starting the downloads...`);
  const open = el('button', { class: 'btn primary', type: 'button', onclick: () => ctx.finish(album.id, true) }, 'Open the album');
  const close = el('button', { class: 'btn outline', type: 'button', onclick: () => ctx.finish(album.id, false) }, 'Close');
  const status = el('div', { class: 'wiz-dl' });
  const off = mountDownloadStatus(status);
  const ids = (r.songs || []).map((s) => s.songId);
  void startDownloads(ids).then((k) => {
    if (!ctx.live()) return;
    line.textContent = `Album created, ${linked} ${plural(linked, 'song', 'songs')} added; downloading ${k} ${plural(k, 'track', 'tracks')}.`;
  }, () => {
    line.textContent = `Album created, ${linked} ${plural(linked, 'song', 'songs')} added. The downloads could not start; open the album to retry.`;
  });
  return {
    node: el('div', { class: 'wiz-step wiz-run' },
      el('div', { class: 'card av-progress' }, el('div', { class: 't-headline' }, 'Importing the album'), line, status,
        el('p', { class: 'muted t-caption' }, 'Audio downloads one song at a time, up to 20 an hour. They continue if you close this.')),
      el('div', { class: 'row end' }, close, open)),
    back: false, hideNext: true, dispose: off, focus: () => open.focus(),
  };
}
