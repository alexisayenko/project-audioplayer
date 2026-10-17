import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as graph from './audio-graph.js';

function makeWin({ state = 'running', resumeTo = 'running', failSource = false, failCtor = false, failWire = false } = {}) {
  const log = { ctors: 0, sources: 0, resumes: 0, closed: 0, connects: [], order: [] };
  class Ctx {
    constructor() {
      if (failCtor) throw new Error('no audio');
      log.ctors += 1;
      this.state = state;
      this.destination = { name: 'dest' };
      this.handlers = [];
      log.last = this;
    }
    resume() {
      log.resumes += 1;
      log.order.push('resume');
      this.state = resumeTo;
      return Promise.resolve();
    }
    close() { log.closed += 1; return Promise.resolve(); }
    addEventListener(t, fn) { this.handlers.push(fn); }
    emit(s) { this.state = s; this.handlers.forEach((h) => h()); }
    createGain() { return { name: 'gain', connect: (n) => log.connects.push(['gain', n.name]) }; }
    createAnalyser() { return { name: 'analyser', connect: (n) => log.connects.push(['analyser', n.name]) }; }
    createMediaElementSource() {
      if (failSource) throw new Error('already connected');
      log.sources += 1;
      log.order.push('source');
      return {
        name: 'source',
        connect: (n) => {
          if (failWire && n.name === 'gain') throw new Error('wiring');
          log.connects.push(['source', n.name]);
        },
      };
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

const tick = () => new Promise((r) => { setTimeout(r, 0); });

test('a context already running at construction builds the graph synchronously and attaches the element', async () => {
  const { win, log } = makeWin({ state: 'running' });
  const states = [];
  graph.onState((s) => states.push(s));
  const g = graph.unlock(audio, { win });
  assert.ok(g);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
  assert.equal(log.resumes, 0);
  assert.equal(graph.hasGraph(), true);
  assert.deepEqual(log.connects, [['gain', 'analyser'], ['analyser', 'dest'], ['source', 'gain']]);
  assert.equal(g.analyser.fftSize, 8192);
  assert.equal(g.analyser.smoothingTimeConstant, 0.5);
  assert.equal(graph.getAnalyser(), g.analyser);
  assert.equal(graph.getGain(), g.gain);
  assert.equal(graph.getState(), 'running');
  assert.deepEqual(states, ['running']);
});

test('a suspended context builds only after resume resolves running, not before', async () => {
  const { win, log } = makeWin({ state: 'suspended', resumeTo: 'running' });
  const states = [];
  graph.onState((s) => states.push(s));
  assert.equal(graph.unlock(audio, { win }), null);
  assert.equal(log.ctors, 1);
  assert.equal(log.resumes, 1);
  assert.equal(log.sources, 0);
  assert.equal(graph.hasGraph(), false);
  assert.equal(graph.getGain(), null);
  await tick();
  assert.equal(log.sources, 1);
  assert.deepEqual(log.order, ['resume', 'source']);
  assert.equal(graph.hasGraph(), true);
  assert.equal(graph.getState(), 'running');
  assert.ok(graph.getAnalyser());
  assert.deepEqual(states, ['running']);
});

test('a suspended context that rejects resume never gets a MediaElementSource and reports blocked', async () => {
  const { win, log } = makeWin({ state: 'suspended' });
  const orig = win.AudioContext;
  win.AudioContext = class extends orig {
    resume() { log.resumes += 1; return Promise.reject(new Error('blocked')); }
  };
  assert.equal(graph.unlock(audio, { win }), null);
  await tick();
  assert.equal(log.sources, 0);
  assert.equal(graph.getState(), 'blocked');
  assert.equal(graph.hasGraph(), false);
  assert.equal(graph.getAnalyser(), null);
  assert.equal(graph.getContext(), log.last);
});

test('a context that stays suspended after resume never gets a MediaElementSource and reports blocked', async () => {
  const { win, log } = makeWin({ state: 'suspended', resumeTo: 'suspended' });
  assert.equal(graph.unlock(audio, { win }), null);
  await tick();
  assert.equal(log.sources, 0);
  assert.equal(graph.getState(), 'blocked');
  assert.equal(graph.hasGraph(), false);
});

test('a never-settling resume still reports blocked and builds when the context later runs', async () => {
  const { win, log } = makeWin({ state: 'suspended' });
  const orig = win.AudioContext;
  win.AudioContext = class extends orig {
    resume() { log.resumes += 1; return new Promise(() => {}); }
  };
  graph.unlock(audio, { win });
  await new Promise((r) => { setTimeout(r, 300); });
  assert.equal(graph.getState(), 'blocked');
  assert.equal(log.sources, 0);
  log.last.emit('running');
  assert.equal(log.sources, 1);
  assert.equal(graph.hasGraph(), true);
  assert.equal(graph.getState(), 'running');
});

test('a later unlock or resume retries the same pending context and builds exactly once', async () => {
  const { win, log } = makeWin({ state: 'suspended', resumeTo: 'suspended' });
  graph.unlock(audio, { win });
  await tick();
  assert.equal(graph.getState(), 'blocked');
  log.last.resume = () => { log.resumes += 1; log.last.state = 'running'; return Promise.resolve(); };
  graph.unlock(audio, { win });
  await tick();
  assert.equal(graph.getState(), 'running');
  assert.equal(graph.hasGraph(), true);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
  graph.unlock(audio, { win });
  assert.equal(await graph.resume(), true);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);

  graph.resetForTests();
  const second = makeWin({ state: 'suspended', resumeTo: 'suspended' });
  graph.unlock(audio, { win: second.win });
  await tick();
  second.log.last.resume = () => { second.log.last.state = 'running'; return Promise.resolve(); };
  assert.equal(await graph.resume(), true);
  assert.equal(second.log.ctors, 1);
  assert.equal(second.log.sources, 1);
  assert.equal(graph.getState(), 'running');
});

test('unlock is idempotent once built: one context and one MediaElementSource, later calls only resume a suspended context', async () => {
  const { win, log } = makeWin();
  const a = graph.unlock(audio, { win });
  const b = graph.unlock(audio, { win });
  assert.equal(a, b);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
  log.last.state = 'suspended';
  graph.unlock(audio, { win });
  assert.equal(log.sources, 1);
  assert.equal(log.resumes, 1);
});

test('nothing is created unless unlock is called', () => {
  const { win, log } = makeWin();
  graph.resume();
  graph.getAnalyser();
  assert.equal(log.ctors, 0);
  assert.equal(graph.hasGraph(), false);
  assert.equal(graph.getContext(), null);
  void win;
});

test('a built graph whose context is later suspended reports blocked and the next resume restores it', async () => {
  const { win, log } = makeWin();
  const g = graph.unlock(audio, { win });
  g.ctx.resume = () => Promise.reject(new Error('blocked'));
  log.last.state = 'suspended';
  assert.equal(await graph.resume(), false);
  assert.equal(graph.getState(), 'blocked');
  assert.equal(graph.getAnalyser(), null);
  g.ctx.resume = () => { g.ctx.state = 'running'; return Promise.resolve(); };
  assert.equal(await graph.resume(), true);
  assert.equal(graph.getState(), 'running');
  assert.equal(log.sources, 1);
});

test('constructor failure leaves playback untouched', () => {
  const { win, log } = makeWin({ failCtor: true });
  assert.equal(graph.unlock(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(log.sources, 0);
});

test('createMediaElementSource failure is reported, not thrown, and closes the context', async () => {
  const { win, log } = makeWin({ failSource: true });
  assert.equal(graph.unlock(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(graph.getAnalyser(), null);
  assert.equal(log.closed, 1);
});

test('createMediaElementSource failure after a delayed resume is reported as failed', async () => {
  const { win, log } = makeWin({ state: 'suspended', failSource: true });
  assert.equal(graph.unlock(audio, { win }), null);
  await tick();
  assert.equal(graph.getState(), 'failed');
  assert.equal(graph.hasGraph(), false);
  assert.equal(log.closed, 1);
});

test('a wiring failure after the source exists routes it to the destination, keeps the context open and reports failed', () => {
  const { win, log } = makeWin({ failWire: true });
  assert.equal(graph.unlock(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(graph.hasGraph(), false);
  assert.equal(log.sources, 1);
  assert.equal(log.closed, 0);
  assert.deepEqual(log.connects.at(-1), ['source', 'dest']);
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
  log.last.emit('interrupted');
  assert.equal(graph.getAnalyser(), null);
  log.last.emit('suspended');
  log.last.emit('running');
  assert.ok(graph.getAnalyser());
  assert.deepEqual(states, ['running', 'interrupted', 'suspended', 'running']);
  off();
  log.last.emit('suspended');
  assert.equal(states.length, 4);
});

test('resume is a no-op without a graph or pending context and restores a suspended built context', async () => {
  assert.equal(await graph.resume(), false);
  const { win, log } = makeWin();
  graph.unlock(audio, { win });
  assert.equal(await graph.resume(), true);
  log.last.state = 'suspended';
  log.last.resume = () => { log.last.state = 'running'; return Promise.resolve(); };
  assert.equal(await graph.resume(), true);
  log.last.state = 'suspended';
  log.last.resume = () => Promise.reject(new Error('blocked'));
  assert.equal(await graph.resume(), false);
});

test('getContext exposes the context for diagnostics, pending or built, null before unlock', async () => {
  assert.equal(graph.getContext(), null);
  const { win, log } = makeWin({ state: 'suspended', resumeTo: 'suspended' });
  graph.unlock(audio, { win });
  assert.equal(graph.getContext(), log.last);
  assert.equal(graph.getContext().state, 'suspended');
  graph.resetForTests();
  const running = makeWin();
  graph.unlock(audio, { win: running.win });
  assert.equal(graph.getContext(), running.log.last);
  running.log.last.emit('interrupted');
  assert.equal(graph.getContext().state, 'interrupted');
});
