import { el } from './dom.js';
import { parseTrackList, startsOf, listLength, scaleStarts, mismatchText } from './album-tracklist.js';
import { rowOf, trackClock, renumber, formatClock } from './album-video-model.js';

const signature = (st) => JSON.stringify([st.endTime, st.rows.map((r) => [r.start, r.include, r.artists, r.title, r.version])]);

export function trackListPanel({ st, ctx }) {
  let baseline = signature(st);
  let sum = 0;
  let confirming = false;
  const area = el('textarea', { class: 'av-paste', rows: 9, 'aria-label': 'Track list with lengths', placeholder: '1 Artist - Title 9:18\n2 Title 8:12\nTotal length: 79:54' });
  const apply = el('button', { class: 'btn outline small', type: 'button' }, 'Use this list');
  const note = el('p', { class: 'muted t-caption', role: 'status', 'aria-live': 'polite' });
  const warn = el('p', { class: 'muted t-caption av-warn', role: 'status' });
  const scale = el('button', { class: 'link-btn t-caption', type: 'button', hidden: true }, 'Scale to video length');
  const mismatch = el('div', { class: 'av-tl-mismatch', hidden: true }, warn, scale);
  const panel = el('div', { class: 'av-tl-panel', hidden: true }, area, el('div', { class: 'av-tl-bar' }, apply), note);
  const toggle = el('button', { class: 'link-btn t-caption', type: 'button', 'aria-expanded': 'false' }, 'Paste a track list with lengths');

  const refresh = () => {
    ctx.drawRows();
    ctx.paint();
    baseline = signature(st);
  };
  const checkLength = () => {
    const text = mismatchText(sum, st.duration, trackClock);
    warn.textContent = text;
    mismatch.hidden = !text;
    scale.hidden = !text;
  };

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) area.focus();
  });
  area.addEventListener('input', () => { confirming = false; apply.textContent = 'Use this list'; note.textContent = ''; });

  apply.addEventListener('click', () => {
    const parsed = parseTrackList(area.value);
    if (!parsed.tracks.length) { note.textContent = 'No tracks found. Each line needs a title and a length like 9:18.'; return; }
    if (!confirming && signature(st) !== baseline) {
      confirming = true;
      apply.textContent = 'Replace my edits';
      note.textContent = 'You edited the tracks. Click again to replace them with this list.';
      return;
    }
    confirming = false;
    apply.textContent = 'Use this list';
    const fallback = st.album.albumArtist.trim();
    const starts = startsOf(parsed.tracks);
    sum = listLength(parsed.tracks);
    st.rows = parsed.tracks.map((t, i) => {
      const r = rowOf({ start: starts[i], title: t.title, artists: [t.artist || fallback].filter(Boolean), version: '', warnings: t.length === null ? ['No length: set its start time'] : [] }, i);
      r.include = true;
      return r;
    });
    renumber(st);
    st.endTime = starts.at(-1) + (parsed.tracks.at(-1).length || 0);
    st.source = 'pasted';
    refresh();
    note.textContent = [`${parsed.tracks.length} tracks, ${trackClock(sum)} in total.`, ...parsed.warnings].join(' ');
    checkLength();
  });

  scale.addEventListener('click', () => {
    const starts = scaleStarts(st.rows.map((r) => r.start), sum, st.duration);
    st.rows.forEach((r, i) => { r.start = starts[i]; r.startText = formatClock(starts[i]); });
    st.endTime = st.duration;
    sum = st.duration;
    refresh();
    checkLength();
  });

  return el('div', { class: 'av-tl' }, toggle, panel, mismatch);
}
