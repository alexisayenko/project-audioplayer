import { api } from './api.js';
import { store } from './store.js';
import { el, fmtTime, toast } from './dom.js';
import { icon } from './icons.js';
import { artistLine, subtitle, titleLine, titleNodes, yearText } from './credits.js';
import { KIND_LABELS } from './song-form-credits.js';
import { genreText } from './genre-cell.js';
import {
  DETAIL_BATCH, DETAIL_PARALLEL, RATE_LIMIT_NOTE, addLabel, canTick, counterText, defaultChecked, isListed, markOf, markUnavailable, mergeDetails, playlistNote, quotaNote, quotaPlan,
  runAdd, summaryText,
} from './playlist-model.js';

const MARK_ICON = { added: 'check', library: 'check', failed: 'warning', unavailable: 'warning' };
const COLUMNS = ['Title', 'Artists', 'Version', 'Year', 'Genres', 'Length', 'Status'];

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const aborted = (ex) => ex?.name === 'AbortError';

function versionText(row) {
  const v = row.version;
  if (!v?.type) return '';
  const by = (v.artists || []).join(', ');
  const kind = KIND_LABELS[v.type] ?? v.type;
  return by ? `${kind} by ${by}` : kind;
}

/** The import view for one YouTube playlist link: a curated table of its videos and an "Add N songs" button. */
export function playlistImport({ link, onBack, onSingle }) {
  const ctl = new AbortController();
  let rows = [];
  let playlist = null;
  let busy = false;
  let destroyed = false;
  let detailsDone = Promise.resolve();
  const checked = new Set();
  const touched = new Set();
  const outcomes = new Map();

  const heading = el('h3', { class: 't-headline imp-title-head' });
  const note = el('p', { class: 'muted t-caption' });
  const back = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Change link');
  back.addEventListener('click', () => onBack?.());
  const single = onSingle ? el('button', { class: 'link-btn t-caption', type: 'button' }, 'Add just this video') : null;
  single?.addEventListener('click', () => onSingle());
  const head = el('div', { class: 'imp-head' }, el('div', {}, heading, note), el('div', { class: 'imp-links' }, single, back));

  const selectAll = el('button', { class: 'btn outline small', type: 'button' }, 'Select all');
  const selectNone = el('button', { class: 'btn outline small', type: 'button' }, 'Select none');
  const counter = el('span', { class: 'imp-count t-caption', role: 'status', 'aria-live': 'polite' });
  const addBtn = el('button', { class: 'btn primary glow small', type: 'button' }, icon('plus', 'nav'), 'Add 0 songs');
  const bar = el('div', { class: 'imp-bar' }, el('div', { class: 'imp-pick' }, selectAll, selectNone, counter), addBtn);

  const progress = el('progress', { class: 'imp-progress', max: 1, value: 0, hidden: true, 'aria-label': 'Adding songs' });
  const status = el('p', { class: 'imp-status t-caption muted', role: 'status', 'aria-live': 'polite' });
  const message = el('div', { class: 'imp-msg' });
  const say = (text, kind = '') => message.replaceChildren(text ? el('p', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text) : '');

  const cols = el('div', { class: 'imp-cols', 'aria-hidden': 'true' }, el('span', { class: 'imp-h-check' }), ...COLUMNS.map((c, i) => el('span', { class: `imp-h-${['title', 'artists', 'version', 'year', 'genres', 'dur', 'mark'][i]}` }, c)));
  const list = el('ul', { class: 'songs imp-list', 'aria-label': 'Playlist videos' });
  const table = el('div', { class: 'group imp-table', hidden: true }, cols, list);
  const loading = el('p', { class: 'imp-loading t-subhead muted', role: 'status' }, el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Reading the playlist...');
  const node = el('section', { class: 'imp', 'aria-label': 'Import a YouTube playlist' }, head, loading, message, bar, progress, status, table);
  bar.hidden = true;

  const listed = () => rows.filter((r) => canTick(r, outcomes.get(r.id)));
  const picked = () => listed().filter((r) => checked.has(r.id));

  function paintCount() {
    const n = picked().length;
    counter.textContent = counterText(n, listed().length);
    addBtn.replaceChildren(icon('plus', 'nav'), addLabel(n));
    addBtn.disabled = busy || n === 0;
    selectAll.disabled = busy;
    selectNone.disabled = busy;
  }

  function rowNode(row) {
    const outcome = outcomes.get(row.id);
    const mark = markOf(row, outcome);
    const tick = canTick(row, outcome);
    const full = [titleLine(row), artistLine(row)].filter(Boolean).join(' by ');
    const box = el('input', { type: 'checkbox', 'aria-label': `Select ${full}`, disabled: !tick || busy });
    box.checked = tick && checked.has(row.id);
    box.addEventListener('change', () => {
      touched.add(row.id);
      if (box.checked) checked.add(row.id); else checked.delete(row.id);
      paintCount();
    });
    const sub = isListed(row) ? subtitle(row) : `${row.reason || 'Unavailable'} video`;
    const markNode = mark
      ? el('span', { class: `imp-mark ${mark.kind}`, title: mark.tip || null }, MARK_ICON[mark.kind] ? icon(MARK_ICON[mark.kind], 'inline') : null, mark.text)
      : null;
    return el('li', { class: `imp-row${mark ? ` is-${mark.kind}` : ''}`, 'data-id': row.id, 'aria-busy': busy && picked().includes(row) ? 'true' : null },
      el('label', { class: 'imp-check' }, box),
      el('div', { class: 'info' },
        el('div', { class: 'title-line' }, el('span', { class: 'open imp-title', title: titleLine(row) }, titleNodes(row))),
        sub ? el('small', { class: 'sub t-subhead', title: sub }, sub) : null),
      el('span', { class: 'imp-artists t-subhead', title: artistLine(row) || null }, artistLine(row)),
      el('span', { class: 'imp-version t-subhead' }, versionText(row)),
      el('span', { class: 'imp-year t-time' }, yearText(row)),
      el('span', { class: 'imp-genres t-subhead', title: genreText(row.tags) || null }, genreText(row.tags)),
      el('span', { class: `c-dur t-time imp-dur${row.long ? ' over' : ''}` }, row.duration ? fmtTime(row.duration) : ''),
      el('span', { class: 'imp-c-mark' }, markNode));
  }

  function paintList() {
    list.replaceChildren(...rows.map(rowNode));
    paintCount();
  }

  function swapRow(id) {
    const row = rows.find((r) => r.id === id);
    const old = Array.from(list.children).find((li) => li.getAttribute('data-id') === id);
    if (!row || !old) return;
    const hadFocus = old.contains(globalThis.document?.activeElement);
    const next = rowNode(row);
    old.replaceWith(next);
    if (hadFocus) next.querySelector('input')?.focus();
  }

  function setDefaults() {
    checked.clear();
    for (const r of rows) if (defaultChecked(r)) checked.add(r.id);
  }

  function applyDetails(entries, unavailable = []) {
    const merged = mergeDetails(rows, entries);
    const gone = markUnavailable(merged.rows, unavailable);
    rows = gone.rows;
    for (const id of gone.changed) {
      checked.delete(id);
      swapRow(id);
    }
    for (const id of merged.changed) {
      const row = rows.find((r) => r.id === id);
      if (!touched.has(id)) {
        if (defaultChecked(row)) checked.add(id); else checked.delete(id);
      }
      swapRow(id);
    }
    paintCount();
  }

  async function loadDetails() {
    const batches = chunk(rows.filter(isListed).map((r) => r.id), DETAIL_BATCH);
    const total = batches.reduce((n, b) => n + b.length, 0);
    let done = 0;
    let problem = '';
    const paint = () => { status.textContent = done < total ? `Reading year and genres: ${done} of ${total}...` : problem; };
    paint();
    const worker = async () => {
      while (batches.length && !destroyed) {
        const batch = batches.shift();
        try {
          const got = await api.playlistDetails(batch, ctl.signal);
          if (destroyed) return;
          applyDetails(got.entries || [], got.unavailable || []);
          if (got.rate_limited) {
            problem = `${RATE_LIMIT_NOTE}. Year and genre details are missing for some songs.`;
            batches.length = 0;
          }
        } catch (ex) {
          if (aborted(ex) || destroyed) return;
          problem = `Year and genre details are missing for some songs: ${ex.message}`;
          if (ex.status === 429) batches.length = 0;
        }
        done += batch.length;
        if (!destroyed) paint();
      }
    };
    await Promise.all(Array.from({ length: DETAIL_PARALLEL }, worker));
    if (!destroyed) {
      done = total;
      paint();
    }
  }

  async function show(got) {
    playlist = got.playlist;
    rows = got.entries.map((e) => ({ ...e }));
    heading.textContent = playlist.title || 'YouTube playlist';
    note.textContent = playlistNote(playlist);
    loading.hidden = true;
    if (!rows.length) {
      say('This playlist has no videos.', 'error');
      return;
    }
    setDefaults();
    table.hidden = false;
    bar.hidden = false;
    paintList();
    detailsDone = loadDetails();
    await detailsDone;
  }

  async function open() {
    try {
      if (!store.loaded) await store.refresh().catch(() => {});
      const got = await api.playlist(link.url, ctl.signal);
      if (destroyed) return;
      await show(got);
    } catch (ex) {
      if (aborted(ex) || destroyed) return;
      loading.hidden = true;
      const retry = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Try again');
      retry.addEventListener('click', () => { loading.hidden = false; say(''); void open(); });
      message.replaceChildren(el('p', { class: 'msg error', role: 'alert' }, ex.message, ' ', retry));
    }
  }

  async function addSelected() {
    if (busy) return;
    busy = true;
    say('');
    paintList();
    status.textContent = 'Waiting for the last details...';
    await detailsDone;
    if (destroyed) return;
    const chosen = picked();
    let usage = null;
    try { usage = await api.usage(); } catch { usage = null; }
    const plan = quotaPlan(chosen.length, usage);
    if (!plan.allowed) {
      busy = false;
      status.textContent = '';
      say(quotaNote(plan) || 'Nothing selected.', 'error');
      paintList();
      return;
    }
    const todo = chosen.slice(0, plan.allowed);
    if (plan.over) say(quotaNote(plan));
    progress.hidden = false;
    progress.max = todo.length;
    progress.value = 0;
    const res = await runAdd(todo, (...args) => api.addSong(...args), {
      signal: ctl.signal,
      onStart: (row, i, n) => { status.textContent = `Adding ${i + 1} of ${n}: ${titleLine(row)}`; },
      onDone: (row, out) => {
        if (out.kind === 'added' || out.kind === 'failed') outcomes.set(row.id, out);
        if (out.kind === 'library') {
          row.duplicate = 'id';
          checked.delete(row.id);
        }
        if (out.kind === 'added') checked.delete(row.id);
        progress.value += 1;
        if (!destroyed) swapRow(row.id);
      },
    });
    if (destroyed) return;
    if (res.added.length) await store.refresh().catch(() => {});
    progress.hidden = true;
    status.textContent = '';
    busy = false;
    const text = summaryText(res, plan.over);
    say(text, res.stop || res.failed.length ? 'error' : '');
    toast(text);
    paintList();
  }

  selectAll.addEventListener('click', () => {
    for (const r of listed()) checked.add(r.id);
    paintList();
  });
  selectNone.addEventListener('click', () => {
    checked.clear();
    paintList();
  });
  addBtn.addEventListener('click', addSelected);

  const opened = open();

  return {
    node,
    destroy() {
      destroyed = true;
      ctl.abort();
    },
    get rows() { return rows; },
    get selected() { return picked().map((r) => r.id); },
    ready: () => opened,
  };
}
