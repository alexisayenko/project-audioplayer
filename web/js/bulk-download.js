import { api } from './api.js';
import { store } from './store.js';
import { autodl } from './autodl.js';
import { el } from './dom.js';
import { hasAudio } from './playable.js';
import { STREAK_STOP, confirmText, downloadLead, failedList, longText, missingAudio, newRun, splitLong, runPercent, runText, settle, streak } from './bulk.js';

let run = null;
let finished = true;
let unsub = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

const unresolved = () => run.ids.filter((id) => !run.results[id]);
const inFlight = () => unresolved().some((id) => autodl.view(id).kind !== 'none');

function evaluate() {
  if (!run) return;
  for (const id of unresolved()) {
    const v = autodl.view(id);
    if (v.kind === 'failed') run = settle(run, id, 'failed', v.error);
    else if (v.kind === 'none' && !store.get(id)) run = settle(run, id, 'skipped');
    else if (v.kind === 'none' && hasAudio(store.get(id))) run = settle(run, id, 'done');
  }
  if (!run.stopped && streak(run) >= STREAK_STOP) {
    run = { ...run, stopped: true };
    autodl.cancel(unresolved());
  }
  if (!inFlight()) {
    finished = true;
    unsub?.();
    unsub = null;
  }
  notify();
}

export const bulkDownload = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  state: () => ({ run, running: !!run && !finished }),
  start(ids, longSkipped = 0) {
    if (!finished || !ids.length) return;
    run = newRun(ids, longSkipped);
    finished = false;
    unsub = autodl.onChange(evaluate);
    for (const id of ids) if (autodl.view(id).kind === 'failed') autodl.retry(id);
    autodl.request(ids);
    evaluate();
  },
  cancel() {
    if (!run || finished) return;
    run = { ...run, cancelled: true };
    autodl.cancel(unresolved());
    evaluate();
  },
  reset() {
    unsub?.();
    unsub = null;
    run = null;
    finished = true;
  },
};

async function copy(text, area) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    area.select();
    return false;
  }
}

export function downloadAllRow() {
  const lead = el('span', { class: 'muted t-caption bulk-lead' }, '');
  const fill = el('div', { class: 'bf-fill' });
  const bar = el('div', { class: 'bf-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Download progress', hidden: true }, fill);
  const note = el('p', { class: 't-caption', role: 'status', 'aria-live': 'polite' }, '');
  const list = el('textarea', { class: 'bf-list t-caption', readonly: true, rows: '4', 'aria-label': 'Failed songs', hidden: true });
  const start = el('button', { class: 'btn outline small', type: 'button', disabled: true }, 'Download all');
  const go = el('button', { class: 'btn outline small', type: 'button', hidden: true }, 'Start');
  const back = el('button', { class: 'btn outline small', type: 'button', hidden: true }, 'Back');
  const stop = el('button', { class: 'btn danger small', type: 'button', hidden: true }, 'Cancel');
  const longBox = el('input', { type: 'checkbox', id: 'bulk-long' });
  const longRow = el('label', { class: 'check-row', for: 'bulk-long', hidden: true }, longBox, el('span', { class: 't-subhead' }, 'Include long songs'));
  const copyBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true }, 'Copy failed songs');
  const card = el('div', { class: 'bulk-row' },
    el('div', { class: 'cell' }, lead, el('div', { class: 'bulk-actions' }, start, go, back, stop, copyBtn)),
    bar, note, longRow, list);
  let confirming = false;
  let confirmNote = '';
  let longNote = '';
  const chosen = () => {
    const { short, long } = splitLong(missingAudio(store.songs));
    return { ids: (longBox.checked ? [...short, ...long] : short).map((s) => s.id), skipped: longBox.checked ? 0 : long.length };
  };
  const confirmFor = (usage) => {
    const { long } = splitLong(missingAudio(store.songs));
    longNote = long.length ? longText(long) : '';
    const longSuffix = longNote ? ` ${longNote}` : '';
    confirmNote = `${confirmText(chosen().ids.length, usage)}${longSuffix}`;
  };
  let usageNow = null;

  const render = () => {
    const { run: r, running } = bulkDownload.state();
    const ids = missingAudio(store.songs).map((s) => s.id);
    lead.textContent = downloadLead(ids.length);
    const failed = r && !running ? failedList(r, store.songs) : [];
    const pct = r ? runPercent(r) : 0;
    bar.hidden = !running;
    bar.setAttribute('aria-valuenow', String(pct));
    fill.style.width = `${pct}%`;
    const paused = running ? Math.max(0, ...r.ids.map((id) => autodl.view(id).minutes || 0)) : 0;
    let noteText = '';
    if (confirming) noteText = confirmNote;
    else if (r) noteText = runText(r, { running, pausedMinutes: paused });
    note.textContent = noteText;
    list.hidden = !failed.length;
    list.value = failed.join('\n');
    copyBtn.hidden = !failed.length;
    start.hidden = confirming;
    longRow.hidden = !confirming || !longNote;
    start.disabled = running || !ids.length;
    start.textContent = ids.length || running ? 'Download all' : 'Nothing to do';
    go.hidden = back.hidden = !confirming;
    go.disabled = confirming && !chosen().ids.length;
    stop.hidden = !running;
  };

  const sync = () => {
    if (!card.isConnected) return false;
    render();
    return true;
  };
  const watch = (sub) => { const off = sub(() => { if (!sync()) off(); }); };
  watch((fn) => bulkDownload.onChange(fn));
  watch((fn) => store.subscribe(fn));
  watch((fn) => autodl.onChange(fn));

  start.addEventListener('click', async () => {
    start.disabled = true;
    longBox.checked = false;
    try { usageNow = await api.usage(); } catch { usageNow = null; }
    confirmFor(usageNow);
    confirming = true;
    render();
  });
  longBox.addEventListener('change', () => { confirmFor(usageNow); render(); });
  back.addEventListener('click', () => { confirming = false; render(); });
  go.addEventListener('click', () => {
    confirming = false;
    const { ids, skipped } = chosen();
    bulkDownload.start(ids, skipped);
    render();
  });
  stop.addEventListener('click', () => bulkDownload.cancel());
  copyBtn.addEventListener('click', async () => {
    const ok = await copy(list.value, list);
    note.textContent = ok ? 'Copied.' : 'Select and copy the list.';
  });

  render();
  return card;
}
