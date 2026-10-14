import { api } from './api.js';
import { store } from './store.js';
import * as D from './dl-queue.js';

const KEY = 'ap2.autodl';
const MAX_RUNNING = 1;
const TICK = 30000;
const POLL_FAILS = 4;

export function autoDownloadOn() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setAutoDownload(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

let st = D.empty();
let wake = 0;
const listeners = new Set();
const polling = new Set();

function set(next) {
  if (next === st) return;
  st = next;
  listeners.forEach((fn) => fn());
}

function schedule() {
  clearTimeout(wake);
  const left = D.pausedFor(st, Date.now());
  if (left > 0) wake = setTimeout(pump, Math.min(left + 50, TICK));
}

async function run(id) {
  set(D.started(st, id));
  try {
    const r = await api.fetchAudio(id);
    if (r?.status !== 'done') await poll(id);
  } catch (ex) {
    if (ex.code === 'hourly_limit') {
      set(D.limited(st, id, Date.now(), ex.retryMinutes || 1));
    } else {
      set(D.failed(st, id, ex.message));
    }
    pump();
    return;
  }
  set(D.done(st, id));
  try { await store.refresh(); } catch { /* the next refresh will show it */ }
  pump();
}

async function poll(id) {
  let calm = 0;
  let fails = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, D.backoff(calm)));
    let s;
    try {
      s = await api.songStatus(id);
      fails = 0;
    } catch (ex) {
      if (++fails >= POLL_FAILS) throw ex;
      continue;
    }
    if (s.status === 'done') return;
    if (s.status === 'error') throw new Error(s.error || 'Download failed');
    const before = st.jobs.find((j) => j.id === id)?.progress;
    set(D.progress(st, id, s.progress));
    calm = st.jobs.find((j) => j.id === id)?.progress === before ? calm + 1 : 0;
  }
}

export function pump() {
  set(D.resume(st, Date.now()));
  for (const id of D.startable(st, Date.now(), MAX_RUNNING)) void run(id);
  schedule();
  if (D.pausedFor(st, Date.now()) > 0) listeners.forEach((fn) => fn());
}

export const autodl = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  view: (id) => D.view(st, id, Date.now()),
  request(ids, { front = false } = {}) {
    const before = st.jobs.length;
    let next = D.enqueue(st, ids, front);
    if (front) for (const id of ids) next = D.prioritize(next, id);
    set(next);
    pump();
    return st.jobs.length - before;
  },
  retry(id) {
    set(D.prioritize(D.retry(st, id), id));
    pump();
  },
  prune(keepIds) { set(D.prune(st, keepIds)); },
};
