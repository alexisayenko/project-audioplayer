import { api } from './api.js';
import { el, plural, toast } from './dom.js';
import { icon } from './icons.js';
import { startDownloads } from './albums-youtube.js';
import { ALBUMS_CHANGED, QUOTA_PER_HOUR, errorCode, youtubeErrorText, countOfList } from './album-candidates.js';
import { mountAlbumDraft, headBlock } from './album-draft-view.js';
import { playlistState, rowIssue, issues, summary, trackLabel, toDownload, payload } from './album-youtube-model.js';

export function createYoutubeFlow({ body, say, close, isLive, setBusy, hideForm, showForm, genreEditor, openAlbumCard }) {
  let started = false;
  let owner = false;

  function commitError(ex) {
    if (ex.status !== 409 || errorCode(ex) !== 'already_exists') { say(youtubeErrorText(ex)); return; }
    const existing = ex.data?.id ?? ex.data?.detail?.id;
    say('This album already exists.', existing ? el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { void api.album(existing).then((full) => { close(); openAlbumCard(full); }, (error_) => say(error_.message)); } }, 'Open it') : null);
  }

  function show(preview, address) {
    const st = playlistState(preview, address);
    const editor = genreEditor(st.album.genres);
    const label = el('span');
    const quota = el('p', { class: 't-caption muted album-quota' });
    let ctx = null;

    const hooks = {
      summary, issues, rowIssue, label: trackLabel,
      link: (r) => r.url,
      linkTitle: 'Open the video in YouTube',
      paintAll: (s, c) => {
        const k = toDownload(s);
        label.textContent = k > 0 ? `Create album and download ${k} ${plural(k, 'track', 'tracks')}` : 'Create album';
        quota.textContent = `${k} selected, up to ${QUOTA_PER_HOUR} fetches an hour, it pauses and resumes`;
        quota.hidden = owner;
        if (c) c.create.replaceChildren(icon('plus', 'nav'), label);
      },
      meta: (r) => (r.songId ? [el('span', { class: 'chip tint album-in-library' }, 'In library')] : []),
    };

    async function submit(c) {
      try {
        const r = await api.albumYoutubeCommit(payload(st));
        close();
        window.dispatchEvent(new Event(ALBUMS_CHANGED));
        const ids = (r.songs || []).map((s) => s.songId);
        const k = await startDownloads(ids);
        const linked = countOfList(r.linked);
        toast(`Album created, ${linked} ${plural(linked, 'song', 'songs')} added; downloading ${k} ${plural(k, 'track', 'tracks')}`);
      } catch (ex) {
        c.paint();
        commitError(ex);
      }
    }

    hideForm();
    const info = [st.playlist.uploader, `${st.rows.length} ${plural(st.rows.length, 'track', 'tracks')}`, 'Tracks from the playlist'].filter(Boolean).join(' · ');
    ctx = mountAlbumDraft({
      body, st, editor, say, hooks, submit,
      onBack: () => { started = false; body.replaceChildren(); showForm(); },
      head: headBlock(st.playlist.title || 'YouTube playlist', info),
      createLabel: label,
      footNote: quota,
    });
    void api.me().then((m) => { if (isLive() && m?.owner === true) { owner = true; ctx.paint(); } }, () => {});
  }

  async function start(address) {
    say('');
    body.replaceChildren(el('p', { class: 'muted t-subhead', role: 'status' }, 'Reading the playlist...'));
    setBusy(true);
    try {
      const r = await api.albumYoutubePreview(address);
      if (!isLive()) return;
      started = true;
      show(r, address);
    } catch (ex) {
      body.replaceChildren();
      if (isLive()) say(youtubeErrorText(ex));
    } finally {
      setBusy(false);
    }
  }

  return { start, active: () => started };
}
