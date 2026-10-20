import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoop } from './loop-engine.js';
import { createGapless, MAX_SECONDS } from './gapless-loop.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

function fakeAudio() {
  const handlers = new Map();
  return {
    src: '/files/song-a',
    paused: false,
    ended: false,
    seeking: false,
    currentTime: 0,
    duration: 100,
    playbackRate: 1,
    volume: 1,
    muted: false,
    addEventListener(ev, fn) { handlers.set(ev, [...(handlers.get(ev) || []), fn]); },
    emit(ev) { for (const fn of handlers.get(ev) || []) fn({ type: ev }); },
    play() { this.paused = false; this.emit('play'); return Promise.resolve(); },
    pause() { this.paused = true; this.emit('pause'); },
  };
}

function fakeGraph({ state = 'running', decode } = {}) {
  const log = { nodes: [], gains: [], unlocks: 0, decodes: 0 };
  const param = () => ({ value: 1 });
  const node = () => ({ connected: [], connect(n) { this.connected.push(n); }, disconnect() { this.connected = []; } });
  const ctx = {
    currentTime: 0,
    state,
    listeners: [],
    addEventListener(ev, fn) { this.listeners.push(fn); },
    createGain() { const g = { ...node(), gain: param() }; log.gains.push(g); return g; },
    createBufferSource() {
      const s = { ...node(), loop: false, loopStart: 0, loopEnd: 0, started: null, stopped: false, start(when, offset) { this.started = { when, offset }; }, stop() { this.stopped = true; } };
      log.nodes.push(s);
      return s;
    },
    async decodeAudioData(bytes) {
      log.decodes += 1;
      if (decode) return decode(bytes);
      return { duration: 60, length: 60 * 44100 };
    },
  };
  const source = node();
  const out = node();
  let built = false;
  const graph = {
    isSupported: () => true,
    unlock() { log.unlocks += 1; built = true; return {}; },
    hasGraph: () => built,
    resume: async () => built,
    getContext: () => ctx,
    getGain: () => out,
    getSource: () => source,
  };
  return { graph, ctx, log, source, out };
}

function setup({ fetchBytes = async () => new ArrayBuffer(8), graphOpts } = {}) {
  const audio = fakeAudio();
  const g = fakeGraph(graphOpts);
  const fetched = [];
  const gapless = createGapless({ audio, graph: g.graph, fetchBytes: async (src) => { fetched.push(src); return fetchBytes(src); } });
  const timers = { n: 0, set: () => { timers.n += 1; return timers.n; }, clear: () => {} };
  const loop = createLoop(audio, timers, gapless);
  return { audio, loop, gapless, fetched, timers, ...g };
}

const live = (env) => env.log.nodes.filter((n) => !n.stopped).at(-1);

test('PLY-160: turning the loop on decodes the file and plays the region from a looping buffer source', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  assert.equal(env.loop.preparing, true);
  assert.equal(env.loop.buffered, false);
  await settle();
  assert.deepEqual(env.fetched, ['/files/song-a']);
  assert.equal(env.loop.preparing, false);
  assert.equal(env.loop.buffered, true);
  const node = live(env);
  assert.equal(node.loop, true);
  assert.equal(node.loopStart, 12);
  assert.equal(node.loopEnd, 27);
  assert.deepEqual(node.started, { when: 0, offset: 15 });
  assert.ok(node.connected.includes(env.log.gains[1]), 'the buffer goes through its own volume gain');
  assert.ok(env.log.gains[1].connected.includes(env.out), 'and on into the shared gain and analyser chain');
  assert.ok(env.source.connected.includes(env.log.gains[0]), 'the element source is rerouted through a mute gain');
  assert.equal(env.log.gains[0].gain.value, 0, 'the element is silent while the buffer plays');
});

test('PLY-160: the loop does not wait for the buffer: before it is ready the timer engine owns the loop', async () => {
  const env = setup();
  env.audio.currentTime = 26.9;
  env.loop.setRegion(12, 27, true);
  env.audio.emit('seeked');
  assert.ok(env.timers.n >= 1);
  assert.equal(env.loop.get().active, true);
  await settle();
});

test('PLY-160: changing A or B updates loopStart and loopEnd on the running source and keeps it playing', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  const node = live(env);
  env.ctx.currentTime = 1;
  env.loop.nudge('end', 3);
  assert.equal(live(env), node, 'the same source keeps playing');
  assert.equal(node.loopEnd, 30);
  assert.equal(node.loopStart, 12);
  env.loop.move('start', 10);
  assert.equal(node.loopStart, 10);
});

test('PLY-160: a region that no longer holds the playhead restarts the source at A', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  const first = live(env);
  env.loop.setRegion(40, 50, true);
  assert.equal(first.stopped, true);
  const next = live(env);
  assert.notEqual(next, first);
  assert.deepEqual(next.started, { when: 0, offset: 40 });
});

test('PLY-160: the source wraps at B by position math and the element is pulled to it', async () => {
  const env = setup();
  env.audio.currentTime = 25;
  env.loop.setRegion(12, 27, true);
  await settle();
  env.ctx.currentTime = 5;
  assert.ok(Math.abs(env.gapless.position - (12 + 3)) < 1e-9);
  env.audio.currentTime = 25.1;
  env.audio.emit('timeupdate');
  assert.ok(Math.abs(env.audio.currentTime - 15) < 1e-9, 'a drifted element is corrected to the buffer position');
});

test('PLY-160: a seek inside the region restarts the source there; a seek outside hands the sound back to the element', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  const first = live(env);
  env.audio.currentTime = 20;
  env.audio.emit('seeked');
  assert.equal(first.stopped, true);
  assert.deepEqual(live(env).started, { when: 0, offset: 20 });
  env.audio.currentTime = 50;
  env.audio.emit('seeked');
  assert.equal(env.loop.buffered, false);
  assert.equal(env.log.gains[0].gain.value, 1);
  env.audio.currentTime = 14;
  env.audio.emit('seeked');
  assert.equal(env.loop.buffered, true, 'entering the region from outside engages the buffer again');
});

test('PLY-160: the loop own wrap seek is not mistaken for a user seek', async () => {
  const env = setup();
  env.audio.currentTime = 26.9;
  env.loop.setRegion(12, 27, true);
  await settle();
  const node = live(env);
  env.audio.currentTime = 26.98;
  env.ctx.currentTime = 0.08;
  env.audio.emit('timeupdate');
  env.audio.emit('seeked');
  assert.equal(live(env), node);
});

test('PLY-160: pause stops the source and play starts it again at the element position', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  const first = live(env);
  env.ctx.currentTime = 2;
  env.audio.pause();
  assert.equal(first.stopped, true);
  assert.equal(env.loop.buffered, false);
  assert.ok(Math.abs(env.audio.currentTime - 17) < 1e-9, 'the element rests where the buffer stopped');
  env.audio.play();
  assert.equal(env.loop.buffered, true);
  assert.deepEqual(live(env).started, { when: 0, offset: 17 });
});

test('PLY-160: a source that is looping to the end of the file survives the ended event', async () => {
  const env = setup();
  env.audio.currentTime = 90;
  env.audio.duration = 100;
  env.loop.setRegion(80, 100, true);
  await settle();
  const node = live(env);
  env.audio.ended = true;
  env.audio.paused = true;
  env.audio.emit('pause');
  assert.equal(node.stopped, false);
});

test('PLY-160: loop off resumes the element at the buffer position, frees the buffer and the next on decodes again', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  env.ctx.currentTime = 4;
  const node = live(env);
  env.loop.setOn(false);
  assert.equal(node.stopped, true);
  assert.ok(Math.abs(env.audio.currentTime - 19) < 1e-9);
  assert.equal(env.log.gains[0].gain.value, 1);
  assert.equal(env.loop.buffered, false);
  assert.equal(env.gapless.status, 'idle');
  env.loop.setOn(true);
  await settle();
  assert.equal(env.log.decodes, 2);
});

test('PLY-160: volume and mute follow the audio element while the buffer plays', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  env.audio.volume = 0.4;
  env.audio.emit('volumechange');
  assert.equal(env.log.gains[1].gain.value, 0.4);
  env.audio.muted = true;
  env.audio.emit('volumechange');
  assert.equal(env.log.gains[1].gain.value, 0);
});

test('PLY-160: a decode failure falls back silently to the timer engine', async () => {
  const env = setup({ graphOpts: { decode: () => { throw new Error('bad data'); } } });
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  assert.equal(env.gapless.status, 'failed');
  assert.equal(env.loop.preparing, false);
  assert.equal(env.loop.buffered, false);
  assert.equal(env.loop.get().active, true);
  assert.equal(env.log.nodes.length, 0);
  env.audio.currentTime = 26.98;
  env.audio.emit('timeupdate');
  assert.equal(env.audio.currentTime, 12, 'the element timer engine still wraps');
  assert.equal(env.log.decodes, 1, 'a failed song is not retried until the loop is turned off and on');
});

test('PLY-160: an oversize file (the fetch refuses it) falls back and a song over the duration cap is never fetched', async () => {
  const big = setup({ fetchBytes: async () => { throw new Error('file too large to decode here'); } });
  big.loop.setRegion(12, 27, true);
  await settle();
  assert.equal(big.gapless.status, 'failed');
  assert.equal(big.loop.buffered, false);

  const long = setup();
  long.audio.duration = MAX_SECONDS + 1;
  long.loop.setRegion(12, 27, true);
  await settle();
  assert.equal(long.gapless.status, 'failed');
  assert.deepEqual(long.fetched, []);
});

test('PLY-160: a suspended or missing audio graph falls back without decoding', async () => {
  const env = setup({ graphOpts: { state: 'suspended' } });
  env.loop.setRegion(12, 27, true);
  await settle();
  assert.equal(env.gapless.status, 'failed');
  assert.deepEqual(env.fetched, []);
});

test('PLY-160: a non-1 playback rate keeps the timer engine and the element audible', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  env.audio.playbackRate = 1.5;
  env.audio.emit('ratechange');
  assert.equal(env.loop.buffered, false);
  assert.equal(env.log.gains[0].gain.value, 1);
});

test('PLY-160: a song change clears the loop, stops the source and drops the buffer', async () => {
  const env = setup();
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  const node = live(env);
  env.loop.clear();
  assert.equal(node.stopped, true);
  assert.equal(env.gapless.status, 'idle');
  env.audio.src = '/files/song-b';
  env.loop.setRegion(1, 5, true);
  await settle();
  assert.deepEqual(env.fetched, ['/files/song-a', '/files/song-b']);
});

test('PLY-160: a buffer that arrives after the loop was turned off is discarded', async () => {
  let release;
  const env = setup({ fetchBytes: () => new Promise((r) => { release = () => r(new ArrayBuffer(8)); }) });
  env.audio.currentTime = 15;
  env.loop.setRegion(12, 27, true);
  await settle();
  env.loop.setOn(false);
  release();
  await settle();
  assert.equal(env.loop.buffered, false);
  assert.equal(env.log.nodes.length, 0);
  assert.equal(env.gapless.status, 'idle');
});

test('PLY-160: with the playhead before A the buffer waits and engages when the element enters the region', async () => {
  const env = setup();
  env.audio.currentTime = 3;
  env.loop.setRegion(12, 27, true);
  await settle();
  assert.equal(env.loop.buffered, false);
  env.audio.currentTime = 12.5;
  env.audio.emit('timeupdate');
  assert.equal(env.loop.buffered, true);
});
