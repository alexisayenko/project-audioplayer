import { FFT_SIZE, ANALYSER_SMOOTHING } from './viz-constants.js';

const listeners = new Set();
let graph = null;
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
export const getAnalyser = () => (graph?.ctx.state === 'running' ? graph.analyser : null);
export const getContext = () => graph?.ctx ?? null;
export const hasGraph = () => graph !== null;

export function onState(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function settle(ctx) {
  if (graph?.ctx === ctx) setState(ctx.state === 'running' ? 'running' : 'blocked');
}

function attempt(ctx) {
  return Promise.resolve(ctx.resume?.()).then(() => {}, () => {}).then(() => {
    settle(ctx);
    return ctx.state === 'running';
  });
}

export function resume() {
  if (!graph) return Promise.resolve(false);
  if (graph.ctx.state === 'running') return Promise.resolve(true);
  return attempt(graph.ctx);
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

function closeQuietly(ctx) {
  try { void ctx.close?.(); } catch { /* already closed */ }
}

export function unlock(audio, { win = globalThis } = {}) {
  if (graph) {
    void resume();
    return graph;
  }
  const Ctor = ctorOf(win);
  if (typeof Ctor !== 'function' || !audio) { setState('unsupported'); return null; }
  let ctx;
  try {
    ctx = new Ctor();
    graph = build(ctx, audio);
  } catch {
    if (ctx) closeQuietly(ctx);
    setState('failed');
    return null;
  }
  ctx.addEventListener?.('statechange', () => setState(ctx.state));
  setState(ctx.state);
  void attempt(ctx);
  return graph;
}

export function resetForTests() {
  graph = null;
  state = 'off';
  listeners.clear();
}
