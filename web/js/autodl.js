import { api } from './api.js';
import { store } from './store.js';
import * as D from './dl-queue.js';
import { storeGet, storeSet } from './storage.js';

const KEY = 'ap2.autodl';
const MAX_RUNNING = 1;
const TICK = 30000;
const POLL_FAILS = 4;
const FINISH_HOLD = 600;

export function autoDownloadOn() {
  return storeGet(KEY) === '1';
}

export function setAutoDownload(on) {
  storeSet(KEY, on ? '1' : '0');
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
    set(D.finishing(st, id));
    await new Promise((resolve) => setTimeout(resolve, FINISH_HOLD));
  } catch (ex) {
    if (ex.code === 'hourly_limit') {
      set(D.limited(st, id, Date.now(), ex.retryMinutes || 1));
    } else {
      set(D.failed(st, id, ex.message));
    }
    pump();
    return;
  }
  try { await store.refresh(); } catch { /* the next refresh will show it */ }
  set(D.done(st, id));
  pump();
}

const hidden = () => typeof document !== 'undefined' && document.hidden;

// Resolves after ms, or at once when the tab becomes visible again (the poll then resumes with a fresh request).
function sleep(ms) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
      resolve();
    };
    const onShow = () => { if (!document.hidden) finish(); };
    const timer = setTimeout(finish, ms);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);
  });
}

function whenVisible() {
  if (!hidden()) return Promise.resolve();
  return new Promise((resolve) => {
    const onShow = () => {
      if (hidden()) return;
      document.removeEventListener('visibilitychange', onShow);
      resolve();
    };
    document.addEventListener('visibilitychange', onShow);
  });
}

async function poll(id) {
  let calm = 0;
  let fails = 0;
  for (;;) {
    await sleep(D.backoff(calm));
    await whenVisible();
    let s;
    try {
      s = await api.songStatus(id);
      fails = 0;
    } catch (ex) {
      if (++fails >= POLL_FAILS) throw ex;
      continue;
    }
    const remote = s.state || (s.status === 'error' ? 'failed' : s.status);
    if (remote === 'done') return;
    if (remote === 'failed') throw new Error(s.error || 'Download failed');
    const was = st.jobs.find((j) => j.id === id);
    set(D.progress(st, id, s.progress, { converting: remote === 'converting', remote, speed: s.speed, eta: s.eta }));
    const now = st.jobs.find((j) => j.id === id);
    const moved = !was || was.progress !== now.progress || was.remote !== now.remote || was.converting !== now.converting;
    calm = moved || (remote === 'downloading' && now.speed) ? 0 : calm + 1;
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
