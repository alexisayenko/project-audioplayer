import { makeBuildScheduler } from './viz-timeline.js';

const CHUNK_ROWS = 64;
let sch = null;

const send = (type, from, view, win) => {
  const copy = view.slice();
  self.postMessage({ type, from, win, data: copy.buffer }, [copy.buffer]);
};

const sink = {
  rows: (from, v, win) => send('rows', from, v, win),
  parts: (from, v) => send('parts', from, v),
  pitch: (from, v) => send('pitch', from, v),
};

function tick() {
  if (!sch) return;
  try {
    if (sch.step(CHUNK_ROWS, sink)) setTimeout(tick, 0);
    else self.postMessage({ type: 'done' });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m?.type === 'focus') { sch?.focus(m.row); return; }
  if (m?.type !== 'build') return;
  try {
    sch = makeBuildScheduler(m);
    setTimeout(tick, 0);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
