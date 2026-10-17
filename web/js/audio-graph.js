import { FFT_SIZE, ANALYSER_SMOOTHING } from './viz-constants.js';

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
export const getAnalyser = () => (graph?.ctx.state === 'running' ? graph.analyser : null);
export const getContext = () => graph?.ctx ?? pending?.ctx ?? null;
export const hasGraph = () => graph !== null;

export function onState(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const BLOCKED_AFTER_MS = 250;

function callResume(ctx) {
  try {
    return Promise.resolve(ctx.resume?.()).then(() => {}, () => {});
  } catch {
    return Promise.resolve();
  }
}

function closeQuietly(ctx) {
  try { void ctx.close?.(); } catch { /* already closed */ }
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
  } catch (err) {
    try { source.connect(ctx.destination); } catch { /* element stays routed to a context that cannot play */ }
    err.attached = true;
    throw err;
  }
  return { ctx, gain, analyser, source };
}

function finish(p) {
  let built;
  try {
    built = build(p.ctx, p.audio);
  } catch (err) {
    pending = null;
    if (!err?.attached) closeQuietly(p.ctx);
    setState('failed');
    return false;
  }
  pending = null;
  graph = built;
  setState(p.ctx.state);
  return true;
}

function settlePending(p) {
  if (pending !== p) return graph !== null;
  if (p.ctx.state !== 'running') {
    setState('blocked');
    return false;
  }
  return finish(p);
}

function attemptPending(p) {
  const timer = setTimeout(() => {
    if (pending === p && p.ctx.state !== 'running') setState('blocked');
  }, BLOCKED_AFTER_MS);
  return callResume(p.ctx).then(() => {
    clearTimeout(timer);
    return settlePending(p);
  });
}

function attempt(ctx) {
  return callResume(ctx).then(() => {
    if (graph?.ctx === ctx) setState(ctx.state === 'running' ? 'running' : 'blocked');
    return ctx.state === 'running';
  });
}

export function resume() {
  if (pending) return attemptPending(pending);
  if (!graph) return Promise.resolve(false);
  if (graph.ctx.state === 'running') return Promise.resolve(true);
  return attempt(graph.ctx);
}

export function unlock(audio, { win = globalThis } = {}) {
  if (graph) {
    void resume();
    return graph;
  }
  if (pending) {
    void attemptPending(pending);
    return graph;
  }
  const Ctor = ctorOf(win);
  if (typeof Ctor !== 'function' || !audio) { setState('unsupported'); return null; }
  let ctx;
  try {
    ctx = new Ctor();
  } catch {
    setState('failed');
    return null;
  }
  const p = { ctx, audio };
  pending = p;
  ctx.addEventListener?.('statechange', () => {
    if (graph?.ctx === ctx) setState(ctx.state);
    else if (pending === p && ctx.state === 'running') finish(p);
  });
  if (ctx.state === 'running') {
    finish(p);
    return graph;
  }
  void attemptPending(p);
  return null;
}

export function resetForTests() {
  graph = null;
  pending = null;
  state = 'off';
  listeners.clear();
}
