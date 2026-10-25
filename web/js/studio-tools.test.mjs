import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, flush } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/analyze/rhythm', href: 'http://localhost/' };
const { createRhythmCard, TEXT, CAPTION, TITLE } = await import('./rhythm.js');
const { errorKey, MIC_CONSTRAINTS } = await import('./harmonics-input.js');
const { createMicBpm, rmsOf, levelFraction, SILENT_RMS } = await import('./mic-bpm.js');
const { mountRhythm } = await import('./studio-tools.js');
const { GRID_NOTE } = await import('./listen-views.js');

function node() {
  return { connected: [], connect(n) { this.connected.push(n); }, disconnect() { this.gone = true; } };
}

function fakeEnv({ fail = null, exact = null } = {}) {
  const track = {
    stopped: 0, handlers: {},
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); },
    stop() { this.stopped += 1; },
  };
  const devices = {
    asked: null, calls: 0, handlers: {},
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); },
    async getUserMedia(c) { devices.calls += 1; devices.asked = c; if (fail) throw Object.assign(new Error('x'), { name: fail }); return { getTracks: () => [track] }; },
  };
  const made = [];
  class Ctx {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; this.closed = false; this.proc = node(); made.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 8192, getFloatFrequencyData(b) { b.fill(-80); } }; }
    createScriptProcessor() { return this.proc; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  const doc = {
    hidden: false, handlers: {},
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); },
  };
  const pushed = [];
  const queue = [];
  const clock = { t: 0 };
  const createBpm = () => ({
    exact,
    push: (s, rate) => pushed.push([s.length, rate]),
    value() { this.exact = exact; return exact === null ? null : Math.round(exact); },
    reset() { this.exact = null; },
    details: () => ({ levelDb: -20, windowS: 6, candidates: [{ bpm: 120, score: 0.95 }] }),
  });
  const raf = (fn) => { queue.push(fn); return queue.length; };
  const env = { navigator: { mediaDevices: devices }, AudioContext: Ctx, document: doc, createBpm, raf, caf: () => {}, now: () => clock.t };
  return { env, track, devices, made, doc, pushed, queue, clock };
}

const runFrame = (f) => f.queue.splice(0).forEach((fn) => fn());
const text = (card, sel) => card.node.querySelector(sel).textContent;
const click = (card) => fire(card.node.querySelector('.mt-toggle'), 'click');

test('STU-032: the Rhythm card starts idle with the idle badge, the title, the window readouts, the Beat bands block and the privacy caption', () => {
  const { env } = fakeEnv();
  const card = createRhythmCard(env);
  assert.equal(text(card, 'h2'), TITLE);
  assert.equal(TITLE, 'Rhythm');
  assert.equal(text(card, '.mt-state'), 'Tap Start to listen');
  assert.match(text(card, '.mt-bpm'), /- - -\s*BPM/);
  assert.match(CAPTION, /Nothing is recorded or uploaded/);
  assert.doesNotMatch(CAPTION, /player/i);
  assert.deepEqual(card.node.querySelectorAll('h3').map((h) => h.textContent), ['Tempo by analysis window', 'BPM over time', 'Beat bands']);
  assert.equal(card.node.querySelectorAll('canvas').length, 2);
  assert.equal(card.node.querySelectorAll('.rh-win').length, 6);
  assert.equal(card.node.querySelector('.hm-cap').textContent, GRID_NOTE);
  assert.equal(GRID_NOTE, 'Faint vertical lines are the detected beat. If the ticks line up with them the BPM matches the music.');
  assert.equal(card.node.className.includes('card'), true);
  card.dispose();
});

test('STU-033: Start asks for the unprocessed microphone once and shows Listening...', async () => {
  const { env, devices } = fakeEnv();
  const card = createRhythmCard(env);
  click(card);
  await flush();
  assert.deepEqual(devices.asked, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  assert.deepEqual(MIC_CONSTRAINTS, devices.asked);
  assert.equal(devices.calls, 1);
  assert.equal(text(card, '.mt-state'), TEXT.listening);
  assert.equal(text(card, '.mt-toggle'), 'Stop');
  assert.equal(card.running, true);
  card.dispose();
});

test('STU-033: the processor node on the shared input feeds the tempo engine with the context sample rate', async () => {
  const { env, made, pushed, devices } = fakeEnv();
  const card = createRhythmCard(env);
  click(card);
  await flush();
  made[0].proc.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
  assert.deepEqual(pushed, [[4096, 48000]]);
  assert.equal(devices.calls, 1);
  assert.equal(made.length, 1);
  card.dispose();
});

test('STU-033: Stop releases the tracks, the nodes and the context and says Tap Start to listen', async () => {
  const { env, track, made } = fakeEnv();
  const card = createRhythmCard(env);
  click(card);
  await flush();
  click(card);
  assert.equal(track.stopped, 1);
  assert.equal(made[0].closed, true);
  assert.equal(made[0].proc.gone, true);
  assert.equal(made[0].proc.onaudioprocess, null);
  assert.equal(card.running, false);
  assert.equal(text(card, '.mt-state'), TEXT.idle);
  assert.equal(text(card, '.mt-toggle'), 'Start');
});

test('STU-033: a hidden page and an ended stream stop it with their own message', async () => {
  for (const [fire$, key] of [
    [(f) => { f.doc.hidden = true; f.doc.handlers.visibilitychange.forEach((h) => h()); }, 'hidden'],
    [(f) => f.track.handlers.ended.forEach((h) => h()), 'ended'],
  ]) {
    const f = fakeEnv();
    const card = createRhythmCard(f.env);
    click(card);
    await flush();
    fire$(f);
    assert.equal(text(card, '.mt-state'), TEXT[key]);
    assert.equal(f.track.stopped, 1);
    assert.equal(card.running, false);
  }
  assert.equal(TEXT.hidden, 'Stopped: the page was hidden');
  assert.equal(TEXT.timeout, 'Stopped: 10 minutes reached');
});

test('STU-033: leaving the page (dispose) releases everything without painting', async () => {
  const { env, track, made } = fakeEnv();
  const card = createRhythmCard(env);
  click(card);
  await flush();
  card.dispose();
  assert.equal(track.stopped, 1);
  assert.equal(made[0].closed, true);
  assert.equal(text(card, '.mt-state'), TEXT.listening);
});

test('STU-033: a refused, missing or busy microphone shows its own message and keeps Start', async () => {
  for (const [name, key] of [['NotAllowedError', 'denied'], ['NotFoundError', 'none'], ['NotReadableError', 'busy'], ['Weird', 'failed']]) {
    const { env, made } = fakeEnv({ fail: name });
    const card = createRhythmCard(env);
    click(card);
    await flush();
    assert.equal(text(card, '.mt-state'), TEXT[key]);
    assert.equal(text(card, '.mt-toggle'), 'Start');
    assert.equal(made[0].closed, true);
    assert.equal(card.running, false);
    assert.equal(errorKey({ name }), key);
  }
  assert.equal(TEXT.denied, 'Microphone access is off: allow it in the browser settings for this site');
  assert.equal(TEXT.none, 'No microphone found');
});

test('STU-033: without getUserMedia the card says so and does not start', async () => {
  const card = createRhythmCard({ navigator: {}, AudioContext: class {}, document: {} });
  click(card);
  await flush();
  assert.equal(text(card, '.mt-state'), TEXT.unsupported);
  assert.equal(card.running, false);
});

test('STU-032: the badge shows one decimal up to 200 BPM and an integer above, and the engine value drives the grid', async () => {
  for (const [exact, shown] of [[120.04, '120.0'], [199.96, '200.0'], [250.4, '250'], [1000.4, '1000']]) {
    const f = fakeEnv({ exact });
    const card = createRhythmCard(f.env);
    click(card);
    await flush();
    f.clock.t = 600;
    runFrame(f);
    assert.equal(text(card, '.mt-value'), shown, String(exact));
    assert.equal(card.node.querySelector('.mt-bpm').getAttribute('aria-label'), `BPM ${shown}`);
    click(card);
    assert.equal(text(card, '.mt-value'), '- - -');
  }
});

test('STU-023: the Details row lists the level, the window and the top candidates while running', async () => {
  const f = fakeEnv({ exact: 120 });
  const card = createRhythmCard(f.env);
  const details = card.node.querySelector('.mt-details');
  details.open = true;
  fire(details, 'toggle');
  assert.match(text(card, '.mt-detail'), /Level: - dBFS/);
  click(card);
  await flush();
  f.clock.t = 600;
  runFrame(f);
  assert.match(details.textContent, /Level: -20\.0 dBFS/);
  assert.match(details.textContent, /Window: 6\.0 s/);
  assert.match(details.textContent, /120 BPM \(0\.95\)/);
  card.dispose();
});

test('STU-032: the engine adapter shows idle for silence, keeps the unrounded value and the meter maps decibels', () => {
  const pushed = [];
  let reset = 0;
  const mic = createMicBpm({ create: () => ({ pushSamples: (s, r) => pushed.push([s.length, r]), estimateExact: () => 140.4, reset: () => { reset += 1; } }) });
  const loud = new Float32Array(48000).fill(0.2);
  const quiet = new Float32Array(48000);
  mic.push(loud, 48000);
  assert.equal(mic.value(), 140);
  assert.equal(mic.exact, 140.4);
  mic.push(quiet, 48000);
  mic.push(quiet, 48000);
  assert.equal(mic.value(), null);
  assert.equal(mic.exact, null);
  assert.equal(reset, 1);
  assert.equal(pushed.length, 2);
  assert.ok(SILENT_RMS > 0);
  assert.equal(rmsOf(new Float32Array(4).fill(0.5)), 0.5);
  assert.equal(levelFraction(0), 0);
  assert.equal(levelFraction(1), 1);
});

test('STU-032: mountRhythm shows the one card and returns a dispose that stops the microphone', async () => {
  const { env, track } = fakeEnv();
  const panel = document.createElement('div');
  const dispose = mountRhythm(panel, env);
  assert.ok(panel.querySelector('section.card.rh-card'));
  assert.equal(panel.querySelector('.ls-card'), null);
  fire(panel.querySelector('.mt-toggle'), 'click');
  await flush();
  dispose();
  assert.equal(track.stopped, 1);
});

test('STU-041: the six window readouts and the graph history follow the engine once a second and clear on Start', async () => {
  const f = fakeEnv({ exact: 120 });
  const results = [null, { bpm: 120, confidence: 0.9, beatsInWindow: 8 }, { bpm: 120, confidence: 0.95, beatsInWindow: 16 }, { bpm: 150, confidence: 0.6, beatsInWindow: 37 }, null, null];
  const base = f.env.createBpm;
  f.env.createBpm = () => ({ ...base(), windows: () => results });
  const card = createRhythmCard(f.env);
  click(card);
  await flush();
  f.clock.t = 600;
  runFrame(f);
  assert.equal(card.windows.history.list.length, 0);
  f.clock.t = 1100;
  runFrame(f);
  assert.equal(card.windows.history.list.length, 1);
  assert.deepEqual(card.node.querySelectorAll('.rh-win-val').map((n) => n.textContent), ['-', '120.0', '120.0', '150.0', '-', '-']);
  assert.deepEqual(card.node.querySelectorAll('.rh-win').map((n) => n.classList.contains('is-drift')), [false, false, false, true, false, false]);
  click(card);
  assert.deepEqual(card.node.querySelectorAll('.rh-win-val').map((n) => n.textContent), ['-', '-', '-', '-', '-', '-']);
  assert.equal(card.windows.history.list.length, 1);
  click(card);
  await flush();
  assert.equal(card.windows.history.list.length, 0);
  card.dispose();
});

test('STU-041: the engine adapter asks for the history only when it shows windows and gives no windows while silent', () => {
  const asked = [];
  const mic = createMicBpm({ windows: true, create: (opts) => { asked.push(opts); return { pushSamples() {}, estimateExact: () => 120, estimateWindows: (list) => list.map((s) => ({ bpm: 120, confidence: 1, beatsInWindow: s })), reset() {} }; } });
  assert.deepEqual(asked, [{ historyS: 60 }]);
  assert.deepEqual(mic.windows(), [null, null, null, null, null, null]);
  mic.push(new Float32Array(4800).fill(0.2), 48000);
  mic.value();
  assert.equal(mic.windows().length, 6);
  assert.equal(mic.windows([4, 8])[1].beatsInWindow, 8);
  const plain = [];
  createMicBpm({ create: (opts) => { plain.push(opts); return { pushSamples() {}, reset() {} }; } });
  assert.deepEqual(plain, [undefined]);
});
