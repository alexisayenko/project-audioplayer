import { api } from './api.js';
import { store } from './store.js';
import { el } from './dom.js';
import { POLL_MS, candidateText, canStart, isFinal, isRunning, progressPercent, statusText } from './backfill.js';

export function bpmCard() {
  const lead = el('p', { class: 'muted t-subhead' }, 'Checking...');
  const fill = el('div', { class: 'bf-fill' });
  const bar = el('div', { class: 'bf-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'BPM detection progress', hidden: true }, fill);
  const note = el('p', { class: 't-caption', role: 'status', 'aria-live': 'polite' }, '');
  const start = el('button', { class: 'btn outline small', type: 'button', disabled: true }, 'Detect missing BPM');
  const stop = el('button', { class: 'btn danger small', type: 'button', hidden: true }, 'Cancel');
  const card = el('section', { class: 'card' }, el('h2', { class: 't-headline' }, 'BPM detection'), lead, bar, note, el('div', { class: 'head-actions' }, start, stop));
  let timer = null;
  let last = null;

  const render = (s) => {
    const running = isRunning(s);
    lead.textContent = candidateText(s.candidates);
    bar.hidden = !running;
    const pct = progressPercent(s);
    bar.setAttribute('aria-valuenow', String(pct));
    fill.style.width = `${pct}%`;
    note.textContent = statusText(s);
    start.disabled = !canStart(s);
    stop.hidden = !running;
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
      s = await api.backfillBpm();
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
      last = await api.startBackfillBpm();
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
      await api.cancelBackfillBpm();
    } catch (err) {
      note.textContent = err.message;
    }
    stop.disabled = false;
    await refresh();
  });

  void refresh();
  return card;
}
