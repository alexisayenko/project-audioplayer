import { api } from './api.js';
import { store } from './store.js';
import { el } from './dom.js';
import { metaButton, metaLead, metaNormalize, metaStatus } from './bulk.js';
import { POLL_MS, candidateText, canStart, isFinal, isRunning, progressPercent, statusText } from './backfill.js';

export const BPM = {
  title: 'BPM detection',
  label: 'BPM detection progress',
  button: () => 'Detect missing BPM',
  lead: (s) => candidateText(s.candidates),
  status: statusText,
  percent: progressPercent,
  api: { get: () => api.backfillBpm(), start: () => api.startBackfillBpm(), cancel: () => api.cancelBackfillBpm() },
};

export const META = {
  title: 'Metadata for downloaded songs',
  label: 'Metadata progress',
  button: metaButton,
  lead: (s) => metaLead(s.candidates),
  status: metaStatus,
  percent: progressPercent,
  api: {
    get: async () => metaNormalize(await api.backfillMetadata()),
    start: async () => metaNormalize(await api.startBackfillMetadata()),
    cancel: async () => metaNormalize(await api.cancelBackfillMetadata()),
  },
};

export const bpmCard = (onState) => backfillCard(BPM, onState);
export const metadataCard = (onState) => backfillCard(META, onState);

export function backfillCard(cfg, onState) {
  const lead = el('p', { class: 'muted t-subhead' }, 'Checking...');
  const fill = el('div', { class: 'bf-fill' });
  const bar = el('div', { class: 'bf-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': cfg.label, hidden: true }, fill);
  const note = el('p', { class: 't-caption', role: 'status', 'aria-live': 'polite' }, '');
  const start = el('button', { class: 'btn outline small', type: 'button', disabled: true }, cfg.button({ candidates: 1 }));
  const stop = el('button', { class: 'btn danger small', type: 'button', hidden: true }, 'Cancel');
  const card = el('section', { class: 'card' }, el('h2', { class: 't-headline' }, cfg.title), lead, bar, note, el('div', { class: 'head-actions' }, start, stop));
  let timer = null;
  let last = null;

  const render = (s) => {
    const running = isRunning(s);
    lead.textContent = cfg.lead(s);
    bar.hidden = !running;
    const pct = cfg.percent(s);
    bar.setAttribute('aria-valuenow', String(pct));
    fill.style.width = `${pct}%`;
    note.textContent = cfg.status(s);
    start.textContent = cfg.button(s);
    start.disabled = !canStart(s);
    stop.hidden = !running;
    onState?.(s);
  };

  const stopPolling = () => { clearTimeout(timer); timer = null; };

  const schedule = () => {
    stopPolling();
    timer = setTimeout(poll, POLL_MS);
  };

  async function poll() {
    timer = null;
    if (!card.isConnected) return;
    if (document.hidden) {
      document.addEventListener('visibilitychange', resume, { once: true });
      return;
    }
    await refresh();
  }

  function resume() {
    if (card.isConnected && !timer && isRunning(last)) void poll();
  }

  async function refresh() {
    let s;
    try {
      s = await cfg.api.get();
    } catch (err) {
      note.textContent = err.message;
      return;
    }
    const wasRunning = isRunning(last);
    last = s;
    render(s);
    if (isRunning(s)) schedule();
    else if (wasRunning && isFinal(s)) store.refresh().catch(() => {});
  }

  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      last = await cfg.api.start();
      render(last);
      if (isRunning(last)) schedule();
    } catch (err) {
      note.textContent = err.message;
      await refresh();
    }
  });

  stop.addEventListener('click', async () => {
    stop.disabled = true;
    try {
      await cfg.api.cancel();
    } catch (err) {
      note.textContent = err.message;
    }
    stop.disabled = false;
    await refresh();
  });

  void refresh();
  return card;
}
