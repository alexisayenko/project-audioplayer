import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as graph from './audio-graph.js';

function makeWin({ state = 'suspended', resumeTo = 'running', failSource = false, failCtor = false } = {}) {
  const log = { ctors: 0, sources: 0, resumes: 0, closed: 0, connects: [] };
  class Ctx {
    constructor() {
      if (failCtor) throw new Error('no audio');
      log.ctors += 1;
      this.state = state;
      this.destination = { name: 'dest' };
      this.handlers = [];
      log.last = this;
    }
    resume() { log.resumes += 1; this.state = resumeTo; return Promise.resolve(); }
    close() { log.closed += 1; return Promise.resolve(); }
    addEventListener(t, fn) { this.handlers.push(fn); }
    emit(s) { this.state = s; this.handlers.forEach((h) => h()); }
    createGain() { return { name: 'gain', connect: (n) => log.connects.push(['gain', n.name]) }; }
    createAnalyser() { return { name: 'analyser', connect: (n) => log.connects.push(['analyser', n.name]) }; }
    createMediaElementSource() {
      if (failSource) throw new Error('already connected');
      log.sources += 1;
      return { name: 'source', connect: (n) => log.connects.push(['source', n.name]) };
    }
  }
  return { win: { AudioContext: Ctx }, log };
}

const audio = { id: 'audio' };

beforeEach(() => graph.resetForTests());

test('nothing is created at import or by queries', () => {
  const { win, log } = makeWin();
  assert.equal(graph.isSupported(win), true);
  assert.equal(graph.getAnalyser(), null);
  assert.equal(graph.getGain(), null);
  assert.equal(graph.getState(), 'off');
  assert.equal(log.ctors, 0);
});

test('isSupported is false without AudioContext and true with webkit prefix', () => {
  assert.equal(graph.isSupported({}), false);
  assert.equal(graph.isSupported({ webkitAudioContext: function Ctx() {} }), true);
});

test('unlock builds source -> gain -> analyser -> destination synchronously, before resume settles', async () => {
  const { win, log } = makeWin();
  const states = [];
  graph.onState((s) => states.push(s));
  const g = graph.unlock(audio, { win });
  assert.ok(g);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
  assert.equal(log.resumes, 1);
  assert.deepEqual(log.connects, [['gain', 'analyser'], ['analyser', 'dest'], ['source', 'gain']]);
  assert.equal(g.analyser.fftSize, 8192);
  assert.equal(g.analyser.smoothingTimeConstant, 0.5);
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(graph.getAnalyser(), g.analyser);
  assert.equal(graph.getGain(), g.gain);
  assert.deepEqual(states, ['suspended', 'running']);
});

test('unlock is idempotent: one context and one MediaElementSource, later calls only resume', async () => {
  const { win, log } = makeWin();
  const a = graph.unlock(audio, { win });
  const b = graph.unlock(audio, { win });
  assert.equal(a, b);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
  log.last.state = 'suspended';
  graph.unlock(audio, { win });
  assert.equal(log.sources, 1);
  assert.equal(log.resumes, 2);
});

test('nothing is created unless unlock is called', () => {
  const { win, log } = makeWin();
  graph.resume();
  graph.getAnalyser();
  assert.equal(log.ctors, 0);
  assert.equal(graph.hasGraph(), false);
});

test('a context that stays suspended reports blocked and the next gesture retries it', async () => {
  const { win, log } = makeWin({ resumeTo: 'suspended' });
  assert.ok(graph.unlock(audio, { win }));
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(graph.getState(), 'blocked');
  assert.equal(graph.getAnalyser(), null);
  log.last.resume = () => { log.last.state = 'running'; return Promise.resolve(); };
  graph.unlock(audio, { win });
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(graph.getState(), 'running');
  assert.ok(graph.getAnalyser());
  assert.equal(log.sources, 1);
});

test('a rejected resume is blocked, not sticky', async () => {
  const { win, log } = makeWin();
  const g = graph.unlock(audio, { win });
  log.last.state = 'suspended';
  g.ctx.resume = () => Promise.reject(new Error('blocked'));
  await graph.resume();
  assert.equal(graph.getState(), 'blocked');
  g.ctx.resume = () => { g.ctx.state = 'running'; return Promise.resolve(); };
  assert.equal(await graph.resume(), true);
  assert.equal(graph.getState(), 'running');
});

test('constructor failure leaves playback untouched', () => {
  const { win, log } = makeWin({ failCtor: true });
  assert.equal(graph.unlock(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(log.sources, 0);
});

test('createMediaElementSource failure is reported, not thrown, and closes the context', () => {
  const { win, log } = makeWin({ failSource: true });
  assert.equal(graph.unlock(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(graph.getAnalyser(), null);
  assert.equal(log.closed, 1);
});

test('no Web Audio or no element reports unsupported', () => {
  assert.equal(graph.unlock(audio, { win: {} }), null);
  assert.equal(graph.getState(), 'unsupported');
  assert.equal(graph.unlock(null, { win: makeWin().win }), null);
});

test('state transitions follow the context and the analyser is hidden while not running', async () => {
  const { win, log } = makeWin();
  const states = [];
  const off = graph.onState((s) => states.push(s));
  graph.unlock(audio, { win });
  await Promise.resolve();
  log.last.emit('interrupted');
  assert.equal(graph.getAnalyser(), null);
  log.last.emit('suspended');
  log.last.emit('running');
  assert.ok(graph.getAnalyser());
  assert.deepEqual(states, ['suspended', 'interrupted', 'suspended', 'running']);
  off();
  log.last.emit('suspended');
  assert.equal(states.length, 4);
});

test('resume brings a suspended context back, and is a no-op without a graph', async () => {
  assert.equal(await graph.resume(), false);
  const { win, log } = makeWin();
  graph.unlock(audio, { win });
  await Promise.resolve();
  assert.equal(await graph.resume(), true);
  log.last.state = 'suspended';
  log.last.resume = () => { log.last.state = 'running'; return Promise.resolve(); };
  assert.equal(await graph.resume(), true);
  log.last.state = 'suspended';
  log.last.resume = () => Promise.reject(new Error('blocked'));
  assert.equal(await graph.resume(), false);
});

test('getContext exposes the context state for diagnostics, null without a graph', async () => {
  assert.equal(graph.getContext(), null);
  const { win, log } = makeWin();
  graph.unlock(audio, { win });
  await Promise.resolve();
  assert.equal(graph.getContext(), log.last);
  log.last.emit('interrupted');
  assert.equal(graph.getContext().state, 'interrupted');
});
