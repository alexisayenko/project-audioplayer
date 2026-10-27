import { api } from './api.js';
import { el, toast } from './dom.js';
import { mountAlbumDraft, headBlock } from './album-draft-view.js';
import { icon } from './icons.js';
import {
  stateOf, formatClock, parseClock, rowIssue, trackLabel, issues, summary, sortRows, isSorted,
  addRow, payload, youtubeAt, previewErrorText, createErrorText,
} from './album-video-model.js';
import { mountSplitProgress } from './album-video-progress.js';

const SOURCE_NOTE = { chapters: 'Tracks from the video chapters', description: 'Tracks from the video description', pasted: 'Tracks from the pasted text' };

export function createVideoFlow({ body, say, genreEditor, isLive, setBusy, hideForm, onCreated, onBack, pollMs }) {
  let run = 0;
  let stopProgress = null;

  const stale = (mine) => mine !== run || !isLive();
  const note = (text) => el('p', { class: 'muted t-subhead', role: 'status' }, text);

  function reset() {
    run += 1;
    if (stopProgress) { stopProgress(); stopProgress = null; }
  }

  async function start(address) {
    reset();
    const mine = run;
    say('');
    body.replaceChildren(note('Reading the video...'));
    setBusy(true);
    try {
      const preview = await api.albumVideoPreview(address);
      if (stale(mine)) return;
      if (!Array.isArray(preview.tracks) || !preview.tracks.length) { showPaste(address, preview.rawText || '', 'No track list was found in this video. Paste it below.'); return; }
      showTable(preview, address);
    } catch (ex) {
      if (stale(mine)) return;
      if (ex.status === 422) { showPaste(address, '', 'No track list was found in this video. Paste it below.'); return; }
      body.replaceChildren();
      say(previewErrorText(ex));
    } finally {
      setBusy(false);
    }
  }

  function showPaste(address, text, intro) {
    reset();
    const area = el('textarea', { class: 'av-paste', rows: 10, 'aria-label': 'Track list', placeholder: '00:00 Artist - Title\n03:45 Artist - Title', value: text });
    const read = el('button', { class: 'btn primary', type: 'submit' }, 'Read the track list');
    const back = el('button', { class: 'btn outline', type: 'button', onclick: () => { say(''); onBack(); } }, 'Back');
    const form = el('form', { class: 'add-card album-video' }, el('p', { class: 'muted t-subhead' }, intro), area, el('div', { class: 'add-foot' }, back, read));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = area.value.trim();
      if (!value) { say('Paste the track list first.'); area.focus(); return; }
      say('');
      read.disabled = true;
      const mine = ++run;
      try {
        const preview = await api.albumVideoPreviewText({ url: address, text: value });
        if (stale(mine)) return;
        if (!Array.isArray(preview.tracks) || !preview.tracks.length) { say('No tracks found in this text. Each line needs a time, like 03:45 Artist - Title.'); return; }
        showTable(preview, address);
      } catch (ex) {
        if (stale(mine)) return;
        say(ex.status === 422 ? 'No tracks found in this text. Each line needs a time, like 03:45 Artist - Title.' : previewErrorText(ex));
      } finally {
        read.disabled = false;
      }
    });
    hideForm();
    body.replaceChildren(form);
    area.focus();
  }

  function showTable(preview, address) {
    reset();
    hideForm();
    const st = stateOf(preview, address);
    const editor = genreEditor(st.album.genres);
    const sortBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true }, 'Sort by start time');
    let ctx = null;

    const startField = (r, paint) => {
      const input = el('input', { type: 'text', class: 'av-start', value: r.startText, inputMode: 'numeric', autocomplete: 'off', 'aria-label': `Start of track ${r.no}`, placeholder: '00:00:00' });
      input.addEventListener('input', () => {
        const t = parseClock(input.value);
        r.badStart = t === null;
        if (t !== null) { r.start = t; r.startText = input.value; }
        paint();
      });
      input.addEventListener('change', () => {
        if (!r.badStart) { input.value = formatClock(r.start); r.startText = input.value; }
      });
      return input;
    };

    const hooks = {
      summary, issues,
      rowIssue: (s, i) => rowIssue(s, i),
      label: (s, i) => trackLabel(s, i),
      link: (r) => youtubeAt(st.videoId, r.start),
      linkTitle: 'Open in YouTube at this time',
      paintAll: (s) => { sortBtn.hidden = isSorted(s); },
      editFields: (r, paint) => {
        const start = startField(r, paint);
        return { nodes: [start], start, paint: (_r, bad) => start.setAttribute('aria-invalid', String(!!bad)) };
      },
      onExclude: (r) => {
        r.useExisting = false;
        if (r.useBox) r.useBox.checked = false;
      },
      meta: (r, { box, paint }) => {
        const meta = [];
        if (r.match) {
          const use = el('input', { type: 'checkbox', checked: r.useExisting, 'aria-label': `Use the existing song for track ${r.no}` });
          r.useBox = use;
          use.addEventListener('change', () => { r.useExisting = use.checked; if (use.checked) { r.include = true; box.checked = true; } paint(); });
          meta.push(el('span', { class: 'chip tint album-in-library', title: [r.match.title, (r.match.artists || []).join(' & ')].filter(Boolean).join(' - ') }, 'In library'),
            el('label', { class: 't-caption av-use' }, use, 'Use existing'));
        }
        for (const w of r.warnings) meta.push(el('span', { class: 't-caption muted av-warn' }, w));
        return meta;
      },
      bottom: (c) => [el('button', { class: 'btn outline small', type: 'button', onclick: () => {
        const r = addRow(st);
        r.editing = true;
        c.drawRows();
        c.paint();
        c.ui.get(r.key)?.extra.start.focus();
      } }, icon('plus', 'inline'), 'Add a track')],
      bottomAfter: () => [
        sortBtn,
        el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => showPaste(address, st.rawText, 'Edit the track list and read it again. Your table edits are replaced.') }, 'Paste a track list instead'),
      ],
    };
    sortBtn.addEventListener('click', () => { sortRows(st); ctx.drawRows(); ctx.paint(); });

    async function submit(c) {
      const data = payload(st);
      let made;
      try {
        made = await api.albumFromVideo(data);
      } catch (ex) {
        c.paint();
        say(createErrorText(ex));
        return;
      }
      if (!isLive()) return;
      const finish = (job) => { toast(job?.message || `Added "${data.album.title}"`); onCreated(made.albumId); };
      body.replaceChildren();
      stopProgress = mountSplitProgress({
        host: body, jobId: made.jobId, pollMs,
        onDone: finish,
        onRetry: () => { void c.run(); },
        onOpen: () => onCreated(made.albumId),
      });
    }

    ctx = mountAlbumDraft({
      body, st, editor, say, onBack, hooks, submit,
      head: headBlock(st.videoTitle || 'YouTube video', [st.uploader, st.duration ? formatClock(st.duration) : '', SOURCE_NOTE[st.source]].filter(Boolean).join(' · '), st.warnings),
      createLabel: 'Create album',
      footNote: 'Tick the tracks to create. The whole split counts as one add.',
    });
  }

  return { start, dispose: reset };
}
