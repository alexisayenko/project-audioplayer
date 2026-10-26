import { autodl, pump } from './autodl.js';
import { store } from './store.js';
import { hasAudio } from './playable.js';
import { el, plural, toast } from './dom.js';

let job = null;
let hooked = false;
const subs = new Set();

export function jobState() {
  if (!job) return null;
  let done = 0;
  let paused = 0;
  let failed = 0;
  let minutes = 0;
  for (const id of job.ids) {
    if (hasAudio(store.get(id))) { done += 1; continue; }
    const v = autodl.view(id);
    if (v.kind === 'paused') { paused += 1; minutes = Math.max(minutes, v.minutes || 1); } else if (v.kind === 'failed') failed += 1;
  }
  return { total: job.ids.length, done, paused, failed, minutes };
}

export function statusText(s) {
  if (!s) return '';
  if (s.paused) return `Paused: hourly limit, resumes in ${s.minutes} ${plural(s.minutes, 'minute', 'minutes')} (${s.done} of ${s.total} downloaded)`;
  if (s.failed && s.done + s.failed >= s.total) return `${s.failed} of ${s.total} downloads failed (${s.done} downloaded)`;
  return `Downloading ${s.done} of ${s.total}`;
}

function notify() {
  for (const f of subs) f();
}

function onChange() {
  if (!job) return;
  const s = jobState();
  if (s.done >= s.total) {
    const n = s.total;
    job = null;
    toast(`Downloaded ${n} ${plural(n, 'song', 'songs')}`);
    notify();
    return;
  }
  if (s.paused && !job.pausedSaid) {
    job.pausedSaid = true;
    toast(statusText(s));
  }
  if (!s.paused) job.pausedSaid = false;
  const settled = s.failed && s.done + s.failed >= s.total;
  if (settled && !job.failedSaid) {
    job.failedSaid = true;
    toast(statusText(s));
  }
  if (!settled) job.failedSaid = false;
  notify();
}

export async function startDownloads(ids) {
  if (!hooked) {
    hooked = true;
    autodl.onChange(onChange);
  }
  try { await store.refresh(); } catch { /* the queue still works from the ids */ }
  const missing = ids.filter((id) => !hasAudio(store.get(id)));
  if (!missing.length) { job = null; notify(); return 0; }
  job = { ids: [...ids], pausedSaid: false, failedSaid: false };
  autodl.request(missing);
  notify();
  return missing.length;
}

export function resumeDownloads() {
  if (!job) return;
  for (const id of job.ids) if (autodl.view(id).kind === 'failed') autodl.retry(id);
  pump();
}

export function mountDownloadStatus(host) {
  const line = el('p', { class: 'album-dl-status muted t-caption', role: 'status', hidden: true });
  const act = el('button', { class: 'link-btn t-caption', type: 'button', onclick: resumeDownloads }, 'Resume now');
  host.append(line);
  const paint = () => {
    const s = jobState();
    line.hidden = !s;
    if (!s) { line.replaceChildren(); return; }
    line.replaceChildren(statusText(s), ...(s.paused || s.failed ? [' ', act] : []));
  };
  subs.add(paint);
  paint();
  return () => { subs.delete(paint); line.remove(); };
}

export function resetForTests() {
  job = null;
  subs.clear();
}
