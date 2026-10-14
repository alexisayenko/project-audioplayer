import { FFT_SIZE, ANALYSER_SMOOTHING, GRAPH_RESUME_TIMEOUT_MS } from './viz-constants.js';

const listeners = new Set();
let graph = null;
let pending = null;
let state = 'off';

function setState(next) {
  if (next === state) return;
  state = next;
  for (const cb of listeners) cb(next);
}

const ctorOf = (win) => win.AudioContext || win.webkitAudioContext;

export const isSupported = (win = globalThis) => typeof ctorOf(win) === 'function';
export const getState = () => state;
export const getGain = () => graph?.gain ?? null;
export const getAnalyser = () => (graph && graph.ctx.state === 'running' ? graph.analyser : null);
export const hasGraph = () => graph !== null;

export function onState(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function resume() {
  if (!graph || graph.ctx.state === 'running') return Promise.resolve(!!graph);
  return Promise.resolve(graph.ctx.resume?.()).then(() => graph.ctx.state === 'running', () => false);
}

function runningWithin(ctx, ms) {
  const settled = Promise.resolve(ctx.resume?.()).catch(() => {}).then(() => ctx.state === 'running');
  const timeout = new Promise((r) => { setTimeout(() => r(ctx.state === 'running'), ms); });
  return Promise.race([settled, timeout]);
}

function build(ctx, audio) {
  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
  gain.connect(analyser);
  analyser.connect(ctx.destination);
  const source = ctx.createMediaElementSource(audio);
  try {
    source.connect(gain);
  } catch {
    try { source.connect(ctx.destination); } catch { /* element stays routed to a context that cannot play */ }
    throw new Error('graph wiring failed');
  }
  return { ctx, gain, analyser, source };
}

async function create(audio, win, timeoutMs) {
  const Ctor = ctorOf(win);
  if (typeof Ctor !== 'function' || !audio) { setState('unsupported'); return null; }
  let ctx;
  try {
    ctx = new Ctor();
  } catch {
    setState('failed');
    return null;
  }
  if (!(await runningWithin(ctx, timeoutMs))) {
    try { void ctx.close?.(); } catch { /* already closed */ }
    setState('blocked');
    return null;
  }
  try {
    graph = build(ctx, audio);
  } catch {
    setState('failed');
    return null;
  }
  ctx.addEventListener?.('statechange', () => setState(ctx.state));
  setState(ctx.state);
  return graph;
}

export function enable(audio, { win = globalThis, timeoutMs = GRAPH_RESUME_TIMEOUT_MS } = {}) {
  if (graph) return Promise.resolve(graph);
  if (!pending) pending = create(audio, win, timeoutMs).finally(() => { pending = null; });
  return pending;
}

export function resetForTests() {
  graph = null;
  pending = null;
  state = 'off';
  listeners.clear();
}
