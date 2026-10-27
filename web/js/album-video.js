import { api } from './api.js';
import { el, toast } from './dom.js';
import { serviceIcon } from './service-icons.js';
import { albumFields } from './album-form.js';
import { discogsFinder } from './album-discogs.js';
import { icon } from './icons.js';
import {
  stateOf, endOf, formatClock, parseClock, rowIssue, trackLabel, issues, summary, sortRows, isSorted,
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
    const editor = genreEditor(st.album.genres);
    const ui = new Map();
    const stat = el('p', { class: 't-subhead av-summary', role: 'status' });
    const problems = el('p', { class: 't-caption muted av-problems', role: 'status' });
    const create = el('button', { class: 'btn primary glow', type: 'button' }, icon('plus', 'nav'), 'Create album');
    const rows = el('ul', { class: 'av-rows' });
    const sortBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true, onclick: () => { sortRows(st); drawRows(); paint(); } }, 'Sort by start time');
    const toggleAll = el('button', { class: 'link-btn t-caption av-select-all', type: 'button' });

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
        const lab = trackLabel(st, i);
        u.name.textContent = lab.name;
        u.version.textContent = lab.version ? `[${lab.version}]` : '';
        u.version.hidden = !lab.version;
        u.len.textContent = `(${lab.length})`;
        u.flag.hidden = !bad;
        u.issue.textContent = bad;
        u.issue.hidden = !bad;
        u.start.setAttribute('aria-invalid', String(!!bad));
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
        name: el('span', { class: 'av-name' }),
        version: el('span', { class: 'av-ver muted', hidden: true }),
        len: el('span', { class: 'av-len muted' }),
        flag: el('span', { class: 'av-flag', title: 'Needs attention', 'aria-label': 'Needs attention', hidden: true }, '!'),
        issue: el('p', { class: 'av-issue t-caption', role: 'alert', hidden: true }),
        link: el('a', { class: 'icon sq-btn av-yt', href: youtubeAt(st.videoId, r.start), target: '_blank', rel: 'noopener', title: 'Open in YouTube at this time', 'aria-label': 'Open in YouTube at this time' }, serviceIcon('youtube', { size: 'inline' })),
      };
      const meta = [];
      if (r.match) {
        use = el('input', { type: 'checkbox', checked: r.useExisting, 'aria-label': `Use the existing song for track ${r.no}` });
        use.addEventListener('change', () => { r.useExisting = use.checked; if (use.checked) { r.include = true; box.checked = true; } paint(); });
        meta.push(el('span', { class: 'chip tint album-in-library', title: [r.match.title, (r.match.artists || []).join(' & ')].filter(Boolean).join(' - ') }, 'In library'),
          el('label', { class: 't-caption av-use' }, use, 'Use existing'));
      }
      for (const w of r.warnings) meta.push(el('span', { class: 't-caption muted av-warn' }, w));
      const remove = el('button', { class: 'icon sq-btn av-remove', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: () => {
        st.rows.splice(st.rows.indexOf(r), 1);
        renumber(st);
        drawRows();
        paint();
      } }, icon('clear', 'inline'));
      const edit = el('button', { class: 'icon sq-btn av-edit', type: 'button', title: 'Edit track', 'aria-label': 'Edit track', 'aria-expanded': String(!!r.editing) }, icon('pencil', 'inline'));
      const line2 = el('div', { class: 'av-line2', hidden: !r.editing },
        u.start,
        textField(r, 'artists', 'Artist', { class: 'av-artist' }),
        textField(r, 'title', 'Title', { class: 'av-title' }),
        textField(r, 'version', 'Version', { class: 'av-version' }));
      const setEditing = (on) => {
        r.editing = on;
        line2.hidden = !on;
        edit.setAttribute('aria-expanded', String(on));
      };
      edit.addEventListener('click', () => setEditing(!r.editing));
      line2.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        setEditing(false);
      });
      ui.set(r.key, u);
      return el('li', { class: 'av-row' },
        el('div', { class: 'av-line1' },
          el('label', { class: 'av-inc' }, box),
          u.no,
          el('span', { class: 'av-label t-body' }, u.name, ' ', u.version, ' ', u.len),
          u.flag,
          el('span', { class: 'av-icons' }, edit, u.link, remove)),
        line2,
        meta.length ? el('div', { class: 'av-meta' }, ...meta) : null,
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

    const artistAll = el('button', { class: 'btn outline small', type: 'button', onclick: () => {
      if (!st.album.albumArtist.trim()) { say('Type the album artist first.'); return; }
      say('');
      for (const r of st.rows) r.artists = st.album.albumArtist;
      drawRows();
      paint();
    } }, 'Use album artist for all tracks');
    const addBtn = el('button', { class: 'btn outline small', type: 'button', onclick: () => {
      const r = addRow(st);
      r.editing = true;
      drawRows();
      paint();
      ui.get(r.key)?.start.focus();
    } }, icon('plus', 'inline'), 'Add a track');
    const paste = el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => showPaste(address, st.rawText, 'Edit the track list and read it again. Your table edits are replaced.') }, 'Paste a track list instead');

    const form = albumFields({ title: st.album.title, artist: st.album.albumArtist, year: st.album.year, type: st.album.type, genres: editor, links: st.album.links, linksId: 'album-links-add' });
    const syncAlbum = () => {
      st.album.title = form.title();
      st.album.albumArtist = form.artist();
      st.album.year = form.year();
      st.album.links = form.links.get();
      paint();
    };
    for (const n of [form.titleF, form.artistsF, form.yearIn, ...Object.values(form.links.inputs)]) n.addEventListener('input', syncAlbum);
    form.typeSel.addEventListener('change', () => {
      st.album.type = form.typeSel.value;
    });

    const coverImg = el('img', { class: 'cover av-cover', alt: 'Album cover', width: '96', height: '96' });
    const paintCover = () => {
      if (st.album.coverUrl) coverImg.src = st.album.coverUrl;
      coverImg.hidden = !st.album.coverUrl;
    };
    coverImg.addEventListener('error', () => { coverImg.hidden = true; });
    paintCover();
    const finder = discogsFinder({ form, editor, onPick: (c) => { if (c.cover) { st.album.coverUrl = c.cover; paintCover(); } } });
    const matched = st.discogsMatch ? el('div', { class: 'muted t-caption av-matched' }, 'Matched on Discogs: ', el('a', { href: st.discogsMatch, target: '_blank', rel: 'noopener noreferrer' }, st.discogsMatch.replace('https://www.', ''))) : null;
    const head = el('div', { class: 'av-head' },
      el('div', { class: 't-headline' }, st.videoTitle || 'YouTube video'),
      el('div', { class: 'muted t-caption' }, [st.uploader, st.duration ? formatClock(st.duration) : '', SOURCE_NOTE[st.source]].filter(Boolean).join(' · ')),
      ...st.warnings.map((w) => el('div', { class: 'muted t-caption av-warn' }, w)));

    const cancel = el('button', { class: 'btn outline', type: 'button', onclick: () => { say(''); onBack(); } }, 'Back');

    async function submit() {
      editor.commit();
      st.album.genres = editor.get();
      syncAlbum();
      form.links.paint();
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
      const finish = (job) => { toast(job?.message || `Added "${data.album.title}"`); onCreated(made.albumId); };
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
      head, ...(matched ? [matched] : []), coverImg, form.node, finder.node,
      el('div', { class: 'av-bar-row' }, stat, toggleAll),
      rows,
      el('div', { class: 'av-bottom' }, addBtn, artistAll, sortBtn, paste),
      problems,
      el('p', { class: 't-caption muted' }, 'Tick the tracks to create. The whole split counts as one add.'),
      el('div', { class: 'add-foot' }, cancel, create)));
    drawRows();
    paint();
  }

  return { start, dispose: reset };
}
