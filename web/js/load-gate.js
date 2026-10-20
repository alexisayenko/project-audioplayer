import { PREFETCH_RESUME_MS } from './constants.js';

let active = 0;
let timer = null;
let waiters = [];

const open = () => active === 0 && timer === null;

function release() {
  timer = null;
  if (!open()) return;
  const w = waiters;
  waiters = [];
  for (const r of w) r();
}

/** A click is loading a module: the background load starts no new batch until it settles plus a short delay. */
export function beginClickLoad() {
  active += 1;
  clearTimeout(timer);
  timer = null;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    active -= 1;
    if (active === 0) timer = setTimeout(release, PREFETCH_RESUME_MS);
  };
}

export function whenGateOpen() {
  return open() ? Promise.resolve() : new Promise((resolve) => { waiters.push(resolve); });
}
