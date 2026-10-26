import { api } from './api.js';
import { el, field, toast } from './dom.js';
import { icon } from './icons.js';
import {
  ALBUM_TYPES, FADE_TYPES, stateOf, endOf, formatClock, parseClock, rowIssue, issues, summary, offsetAll, sortRows, isSorted,
  addRow, renumber, payload, youtubeAt, previewErrorText, createErrorText,
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
    const editor = genreEditor([]);
    const ui = new Map();
    const stat = el('p', { class: 't-subhead av-summary', role: 'status' });
    const problems = el('p', { class: 't-caption muted av-problems', role: 'status' });
    const create = el('button', { class: 'btn primary glow', type: 'button' }, icon('plus', 'nav'), 'Create album');
    const rows = el('ul', { class: 'av-rows' });
    const sortBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true, onclick: () => { sortRows(st); drawRows(); paint(); } }, 'Sort by start time');
    const toggleAll = el('button', { class: 'link-btn t-caption av-select-all', type: 'button' });
    const fadesBox = el('input', { type: 'checkbox', checked: st.fades, onchange: () => { st.fades = fadesBox.checked; st.fadesTouched = true; } });

    function paint() {
      stat.textContent = summary(st);
      const all = issues(st);
      problems.textContent = all.length ? all[0] : '';
      create.disabled = all.length > 0;
      const allOn = st.rows.length > 0 && st.rows.every((r) => r.include);
      toggleAll.textContent = allOn ? 'Select none' : 'Select all';
      sortBtn.hidden = isSorted(st);
      st.rows.forEach((r, i) => {
        const u = ui.get(r.key);
        if (!u) return;
        u.no.textContent = `${r.no}.`;
        const bad = rowIssue(st, i);
        u.issue.textContent = bad;
        u.issue.hidden = !bad;
        u.start.setAttribute('aria-invalid', String(!!bad));
        if (u.end.tagName === 'SPAN') u.end.textContent = `to ${formatClock(endOf(st, i))}`;
        u.link.href = youtubeAt(st.videoId, r.start);
      });
    }

    function startField(r) {
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
    }

    function endField() {
      const input = el('input', { type: 'text', class: 'av-end-input', value: formatClock(st.endTime), inputMode: 'numeric', autocomplete: 'off', 'aria-label': 'End of the last track', placeholder: '00:00:00' });
      input.addEventListener('input', () => {
        const t = parseClock(input.value);
        st.badEnd = t === null;
        if (t !== null) st.endTime = t;
        paint();
      });
      input.addEventListener('change', () => { if (!st.badEnd) input.value = formatClock(st.endTime); });
      return input;
    }

    function textField(r, key, label, extra = {}) {
      const input = el('input', { type: 'text', value: r[key], autocomplete: 'off', 'aria-label': `${label} of track ${r.no}`, placeholder: label, ...extra });
      input.addEventListener('input', () => { r[key] = input.value; paint(); });
      return input;
    }

    function rowNode(r, i) {
      let use = null;
      const box = el('input', { type: 'checkbox', checked: r.include, 'aria-label': `Include track ${r.no}` });
      box.addEventListener('change', () => { r.include = box.checked; if (!r.include) { r.useExisting = false; if (use) use.checked = false; } paint(); });
      const u = {
        no: el('span', { class: 'album-no muted t-caption' }),
        start: startField(r),
        end: i === st.rows.length - 1 ? endField() : el('span', { class: 'muted t-caption av-end' }),
        issue: el('p', { class: 'av-issue t-caption', role: 'alert', hidden: true }),
        link: el('a', { class: 'link-btn t-caption', href: youtubeAt(st.videoId, r.start), target: '_blank', rel: 'noopener' }, 'Open in YouTube at this time'),
      };
      const meta = [];
      if (r.match) {
        use = el('input', { type: 'checkbox', checked: r.useExisting, 'aria-label': `Use the existing song for track ${r.no}` });
        use.addEventListener('change', () => { r.useExisting = use.checked; if (use.checked) { r.include = true; box.checked = true; } paint(); });
        meta.push(el('span', { class: 'chip tint album-in-library', title: [r.match.title, (r.match.artists || []).join(' & ')].filter(Boolean).join(' - ') }, 'In library'),
          el('label', { class: 't-caption av-use' }, use, 'Use existing'));
      }
      for (const w of r.warnings) meta.push(el('span', { class: 't-caption muted av-warn' }, w));
      const remove = el('button', { class: 'link-btn t-caption', type: 'button', 'aria-label': `Remove track ${r.no}`, onclick: () => {
        st.rows.splice(st.rows.indexOf(r), 1);
        renumber(st);
        drawRows();
        paint();
      } }, 'Remove');
      ui.set(r.key, u);
      return el('li', { class: 'av-row' },
        el('label', { class: 'av-inc' }, box),
        u.no, u.start, u.end,
        textField(r, 'artists', 'Artist', { class: 'av-artist' }),
        textField(r, 'title', 'Title', { class: 'av-title' }),
        textField(r, 'version', 'Version', { class: 'av-version' }),
        el('div', { class: 'av-meta' }, ...meta, u.link, remove),
        u.issue);
    }

    function drawRows() {
      ui.clear();
      rows.replaceChildren(...st.rows.map(rowNode));
    }

    toggleAll.addEventListener('click', () => {
      const on = !st.rows.every((r) => r.include);
      for (const r of st.rows) { r.include = on; if (!on) r.useExisting = false; }
      drawRows();
      paint();
    });

    const delta = el('input', { type: 'number', class: 'av-delta', value: '1', min: '0', step: '1', inputMode: 'numeric', 'aria-label': 'Seconds to shift' });
    const shift = (sign) => {
      const n = Math.floor(Number(delta.value));
      if (!Number.isFinite(n) || n <= 0) { delta.focus(); return; }
      offsetAll(st, sign * n);
      drawRows();
      paint();
    };
    const earlier = el('button', { class: 'btn outline small', type: 'button', onclick: () => shift(-1) }, 'Earlier');
    const later = el('button', { class: 'btn outline small', type: 'button', onclick: () => shift(1) }, 'Later');
    const artistAll = el('button', { class: 'btn outline small', type: 'button', onclick: () => {
      if (!st.album.albumArtist.trim()) { say('Type the album artist first.'); return; }
      say('');
      for (const r of st.rows) r.artists = st.album.albumArtist;
      drawRows();
      paint();
    } }, 'Use album artist for all tracks');
    const addBtn = el('button', { class: 'btn outline small', type: 'button', onclick: () => {
      const r = addRow(st);
      drawRows();
      paint();
      ui.get(r.key)?.start.focus();
    } }, icon('plus', 'inline'), 'Add a track');
    const paste = el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => showPaste(address, st.rawText, 'Edit the track list and read it again. Your table edits are replaced.') }, 'Paste a track list instead');

    const albumInput = (key, label, extra = {}) => {
      const input = el('input', { type: 'text', value: st.album[key], autocomplete: 'off', 'aria-label': label, placeholder: label, ...extra });
      input.addEventListener('input', () => { st.album[key] = input.value; paint(); });
      return input;
    };
    const typeSel = el('select', { 'aria-label': 'Album type' }, ...ALBUM_TYPES.map(([k, label]) => el('option', { value: k, selected: k === st.album.type }, label)));
    typeSel.addEventListener('change', () => {
      st.album.type = typeSel.value;
      if (!st.fadesTouched) { st.fades = FADE_TYPES.has(st.album.type); fadesBox.checked = st.fades; }
    });

    const head = el('div', { class: 'av-head' },
      el('div', { class: 't-headline' }, st.videoTitle || 'YouTube video'),
      el('div', { class: 'muted t-caption' }, [st.uploader, st.duration ? formatClock(st.duration) : '', SOURCE_NOTE[st.source]].filter(Boolean).join(' · ')),
      ...st.warnings.map((w) => el('div', { class: 'muted t-caption av-warn' }, w)));

    const header = el('div', { class: 'av-form' },
      field('Album title', albumInput('title', 'Album title')),
      field('Album artist', albumInput('albumArtist', 'Album artist')),
      field('Type', typeSel),
      field('Year', albumInput('year', 'Year', { inputMode: 'numeric' })),
      el('div', { class: 'field av-genres' }, el('label', {}, 'Genres'), editor.node));

    const tools = el('div', { class: 'av-tools' },
      el('div', { class: 'av-shift' }, el('label', { class: 't-caption' }, 'Shift all times by'), delta, el('span', { class: 't-caption muted' }, 's'), earlier, later),
      artistAll, sortBtn);

    const cancel = el('button', { class: 'btn outline', type: 'button', onclick: () => { say(''); onBack(); } }, 'Back');

    async function submit() {
      editor.commit();
      st.album.genres = editor.get();
      say('');
      const data = payload(st);
      create.disabled = true;
      let made;
      try {
        made = await api.albumFromVideo(data);
      } catch (ex) {
        paint();
        say(createErrorText(ex));
        return;
      }
      if (!isLive()) return;
      const finish = () => { toast(`Added "${data.album.title}"`); onCreated(made.albumId); };
      body.replaceChildren();
      stopProgress = mountSplitProgress({
        host: body, jobId: made.jobId, pollMs,
        onDone: finish,
        onRetry: () => { void submit(); },
        onOpen: () => onCreated(made.albumId),
      });
    }
    create.addEventListener('click', () => { void submit(); });

    body.replaceChildren(el('div', { class: 'add-card album-video' },
      head, header,
      el('div', { class: 'av-bar-row' }, stat, toggleAll),
      tools,
      rows,
      el('div', { class: 'av-bottom' }, addBtn, paste),
      el('label', { class: 'av-fades t-subhead' }, fadesBox, 'Fade each track in and out for 1 s'),
      problems,
      el('p', { class: 't-caption muted' }, 'Tick the tracks to create. The whole split counts as one add.'),
      el('div', { class: 'add-foot' }, cancel, create)));
    drawRows();
    paint();
  }

  return { start, dispose: reset };
}
