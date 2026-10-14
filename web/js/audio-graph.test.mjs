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

test('enable builds source -> gain -> analyser -> destination once, after the context runs', async () => {
  const { win, log } = makeWin();
  const states = [];
  graph.onState((s) => states.push(s));
  const g = await graph.enable(audio, { win });
  assert.ok(g);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
  assert.equal(log.resumes, 1);
  assert.deepEqual(log.connects, [['gain', 'analyser'], ['analyser', 'dest'], ['source', 'gain']]);
  assert.equal(g.analyser.fftSize, 8192);
  assert.equal(g.analyser.smoothingTimeConstant, 0.5);
  assert.equal(graph.getAnalyser(), g.analyser);
  assert.equal(graph.getGain(), g.gain);
  assert.deepEqual(states, ['running']);
});

test('enable is idempotent, also when called concurrently', async () => {
  const { win, log } = makeWin();
  const [a, b] = await Promise.all([graph.enable(audio, { win }), graph.enable(audio, { win })]);
  const c = await graph.enable(audio, { win });
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(log.ctors, 1);
  assert.equal(log.sources, 1);
});

test('a context that stays suspended is closed and the element is never routed', async () => {
  const { win, log } = makeWin({ resumeTo: 'suspended' });
  const g = await graph.enable(audio, { win, timeoutMs: 20 });
  assert.equal(g, null);
  assert.equal(log.sources, 0);
  assert.equal(log.closed, 1);
  assert.equal(graph.getState(), 'blocked');
  assert.equal(graph.getAnalyser(), null);
});

test('a blocked attempt can be retried later', async () => {
  const blocked = makeWin({ resumeTo: 'suspended' });
  assert.equal(await graph.enable(audio, { win: blocked.win, timeoutMs: 10 }), null);
  const ok = makeWin();
  assert.ok(await graph.enable(audio, { win: ok.win }));
  assert.equal(ok.log.sources, 1);
});

test('constructor failure leaves playback untouched', async () => {
  const { win, log } = makeWin({ failCtor: true });
  assert.equal(await graph.enable(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(log.sources, 0);
});

test('createMediaElementSource failure is reported, not thrown', async () => {
  const { win } = makeWin({ failSource: true });
  assert.equal(await graph.enable(audio, { win }), null);
  assert.equal(graph.getState(), 'failed');
  assert.equal(graph.getAnalyser(), null);
});

test('no Web Audio or no element reports unsupported', async () => {
  assert.equal(await graph.enable(audio, { win: {} }), null);
  assert.equal(graph.getState(), 'unsupported');
  assert.equal(await graph.enable(null, { win: makeWin().win }), null);
});

test('state transitions follow the context and the analyser is hidden while not running', async () => {
  const { win, log } = makeWin();
  const states = [];
  const off = graph.onState((s) => states.push(s));
  await graph.enable(audio, { win });
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

test('resume brings a suspended context back, and is a no-op without a graph', async () => {
  assert.equal(await graph.resume(), false);
  const { win, log } = makeWin();
  await graph.enable(audio, { win });
  assert.equal(await graph.resume(), true);
  log.last.state = 'suspended';
  log.last.resume = () => { log.last.state = 'running'; return Promise.resolve(); };
  assert.equal(await graph.resume(), true);
  log.last.state = 'suspended';
  log.last.resume = () => Promise.reject(new Error('blocked'));
  assert.equal(await graph.resume(), false);
});
