import { api } from './api.js';
import { el, plural } from './dom.js';

export const POLL_MS = 1500;
const LOST_AFTER = 4;

export function progressText(j) {
  const total = Number(j.total) || 0;
  const done = Number(j.done) || 0;
  if (j.state === 'queued') return 'Waiting for the server to start.';
  if (j.state === 'downloading') return 'Downloading the video audio.';
  if (j.state === 'splitting') {
    const now = j.current ? `: ${j.current}` : '';
    return `Cutting ${done} of ${total} ${plural(total, 'track', 'tracks')}${now}`;
  }
  if (j.state === 'done') return `Done: ${total} ${plural(total, 'track', 'tracks')} cut.`;
  return 'Stopped before all tracks were cut.';
}

export function fraction(j) {
  if (j.state === 'done') return 1;
  if (j.state === 'splitting' && j.total > 0) return Math.min(1, j.done / j.total);
  return 0;
}

export function mountSplitProgress({ host, jobId, onDone, onRetry, onOpen, pollMs = POLL_MS }) {
  const line = el('p', { class: 't-subhead', role: 'status' }, 'Waiting for the server to start.');
  const bar = el('div', { class: 'av-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Split progress' });
  const actions = el('div', { class: 'av-progress-actions' });
  const panel = el('div', { class: 'av-progress card' }, el('div', { class: 't-headline' }, 'Creating the album'), bar, line, actions);
  host.replaceChildren(panel);
  let stopped = false;
  let timer = 0;
  let misses = 0;

  const paint = (j) => {
    const f = fraction(j);
    bar.style.setProperty('--w', `${Math.round(f * 100)}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    line.textContent = progressText(j);
  };

  const fail = (text, retry) => {
    const buttons = [el('p', { class: 'msg error', role: 'alert' }, text)];
    if (retry) buttons.push(el('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Try again'));
    if (onOpen) buttons.push(el('button', { class: 'btn outline', type: 'button', onclick: onOpen }, 'Open the album'));
    actions.replaceChildren(...buttons);
  };

  async function tick() {
    if (stopped) return;
    let j;
    try {
      j = await api.job(jobId);
      misses = 0;
    } catch {
      misses += 1;
      if (misses >= LOST_AFTER) {
        fail('Lost contact with the server. The split may still be running.', () => { misses = 0; actions.replaceChildren(); schedule(); });
        return;
      }
      schedule();
      return;
    }
    if (stopped) return;
    paint(j);
    if (j.state === 'done') { onDone(j); return; }
    if (j.state === 'error') { fail(j.error || 'The split failed.', onRetry); return; }
    schedule();
  }

  function schedule() {
    timer = setTimeout(() => { void tick(); }, pollMs);
  }

  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
