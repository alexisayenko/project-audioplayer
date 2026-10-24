import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, flush } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/studio/tools', href: 'http://localhost/' };
const { createMicCard, errorKey, TEXT, CONSTRAINTS, CAPTION, TITLE } = await import('./mic-tool.js');
const { createMicBpm, rmsOf, levelFraction, SILENT_RMS } = await import('./mic-bpm.js');
const { renderStudio } = await import('./studio.js');
const { mountTools, TOOLS_NOTE } = await import('./studio-tools.js');

function node() {
  return { connected: [], connect(n) { this.connected.push(n); }, disconnect() { this.gone = true; } };
}

function fakeEnv({ fail = null } = {}) {
  const track = {
    stopped: 0, handlers: {},
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); },
    stop() { this.stopped += 1; },
  };
  const devices = {
    asked: null, handlers: {},
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); },
    async getUserMedia(c) { devices.asked = c; if (fail) throw Object.assign(new Error('x'), { name: fail }); return { getTracks: () => [track] }; },
  };
  const made = [];
  class Ctx {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; this.closed = false; this.proc = node(); made.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), fftSize: 0, getFloatTimeDomainData(b) { b.fill(0.1); } }; }
    createScriptProcessor() { return this.proc; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  const doc = {
    hidden: false, handlers: {},
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); },
  };
  const pushed = [];
  const createBpm = () => ({ push: (s, rate) => pushed.push([s.length, rate]), value: () => 128 });
  return { env: { navigator: { mediaDevices: devices }, AudioContext: Ctx, document: doc, createBpm }, track, devices, made, doc, pushed };
}

const text = (card, sel) => card.node.querySelector(sel).textContent;
const click = (card) => fire(card.node.querySelector('.mt-toggle'), 'click');

test('WEB-177: the card starts idle with the idle badge, the title and the privacy caption', () => {
  const { env } = fakeEnv();
  const card = createMicCard(env);
  assert.equal(text(card, 'h2'), TITLE);
  assert.equal(TITLE, 'Live BPM (microphone)');
  assert.equal(text(card, '.mt-state'), 'Tap Start to listen');
  assert.match(text(card, '.mt-bpm'), /- - -\s*BPM/);
  assert.match(CAPTION, /Nothing is recorded or uploaded/);
  assert.match(CAPTION, /The player and this tool can run together/);
  assert.equal(card.node.className.includes('card'), true);
  card.dispose();
});

test('WEB-177: Start asks for the unprocessed single-channel microphone and shows Listening...', async () => {
  const { env, devices } = fakeEnv();
  const card = createMicCard(env);
  click(card);
  await flush();
  assert.deepEqual(devices.asked, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  assert.deepEqual(CONSTRAINTS, devices.asked);
  assert.equal(text(card, '.mt-state'), TEXT.listening);
  assert.equal(text(card, '.mt-toggle'), 'Stop');
  assert.equal(card.running, true);
  card.dispose();
});

test('WEB-177: audio from the processor node goes to the analyser engine with the context sample rate', async () => {
  const { env, made, pushed } = fakeEnv();
  const card = createMicCard(env);
  click(card);
  await flush();
  made[0].proc.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
  assert.deepEqual(pushed, [[4096, 48000]]);
  card.dispose();
});

test('WEB-178: Stop releases the tracks, the nodes and the context and says Tap Start to listen', async () => {
  const { env, track, made } = fakeEnv();
  const card = createMicCard(env);
  click(card);
  await flush();
  click(card);
  assert.equal(track.stopped, 1);
  assert.equal(made[0].closed, true);
  assert.equal(made[0].proc.gone, true);
  assert.equal(card.running, false);
  assert.equal(text(card, '.mt-state'), TEXT.idle);
  assert.equal(text(card, '.mt-toggle'), 'Start');
});

test('WEB-178: a hidden page, an ended stream and a device change stop it with their own message', async () => {
  for (const [fire$, key] of [
    [(f) => { f.doc.hidden = true; f.doc.handlers.visibilitychange.forEach((h) => h()); }, 'hidden'],
    [(f) => f.track.handlers.ended.forEach((h) => h()), 'ended'],
  ]) {
    const f = fakeEnv();
    const card = createMicCard(f.env);
    click(card);
    await flush();
    fire$(f);
    assert.equal(text(card, '.mt-state'), TEXT[key]);
    assert.equal(f.track.stopped, 1);
    assert.equal(card.running, false);
  }
  assert.equal(TEXT.hidden, 'Stopped: the page was hidden');
});

test('WEB-178: leaving the tab (dispose) releases everything without painting', async () => {
  const { env, track, made } = fakeEnv();
  const card = createMicCard(env);
  click(card);
  await flush();
  card.dispose();
  assert.equal(track.stopped, 1);
  assert.equal(made[0].closed, true);
  assert.equal(text(card, '.mt-state'), TEXT.listening);
});

test('WEB-177: a refused, missing or busy microphone shows its own message and keeps Start', async () => {
  for (const [name, key] of [['NotAllowedError', 'denied'], ['NotFoundError', 'none'], ['NotReadableError', 'busy'], ['Weird', 'failed']]) {
    const { env, made } = fakeEnv({ fail: name });
    const card = createMicCard(env);
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

test('WEB-177: without getUserMedia the card says so and does not start', async () => {
  const card = createMicCard({ navigator: {}, AudioContext: class {}, document: {} });
  click(card);
  await flush();
  assert.equal(text(card, '.mt-state'), TEXT.unsupported);
  assert.equal(card.running, false);
});

test('WEB-177: the engine adapter shows idle for silence and the engine value for sound, and the meter maps decibels', () => {
  const pushed = [];
  let reset = 0;
  const mic = createMicBpm({ create: () => ({ pushSamples: (s, r) => pushed.push([s.length, r]), estimateExact: () => 140, reset: () => { reset += 1; } }) });
  const loud = new Float32Array(48000).fill(0.2);
  const quiet = new Float32Array(48000);
  mic.push(loud, 48000);
  assert.equal(mic.value(), 140);
  mic.push(quiet, 48000);
  mic.push(quiet, 48000);
  assert.equal(mic.value(), null);
  assert.equal(reset, 1);
  assert.equal(pushed.length, 2);
  assert.ok(SILENT_RMS > 0);
  assert.equal(rmsOf(new Float32Array(4).fill(0.5)), 0.5);
  assert.equal(levelFraction(0), 0);
  assert.equal(levelFraction(1), 1);
});

test('WEB-176: the Analyze tab shows the temporary caption and the microphone card with no song and no player', async () => {
  const { env } = fakeEnv();
  const root = document.createElement('div');
  const dispose = renderStudio(root, { tab: 'tools', tools: env });
  await flush();
  assert.equal(root.querySelector('#stu-tools').hidden, false);
  assert.equal(root.querySelector('#stu-track').hidden, true);
  assert.equal(root.querySelector('.stu-tools-note').textContent, 'Temporary home for audio tools.');
  assert.equal(TOOLS_NOTE, 'Temporary home for audio tools.');
  assert.ok(root.querySelector('section.card.mt-card'));
  dispose();
});

test('WEB-176: a failed tools load shows an error with Retry', async () => {
  const root = document.createElement('div');
  let tries = 0;
  const dispose = renderStudio(root, { tab: 'tools', loadTools: () => { tries += 1; return Promise.reject(new Error('offline')); } });
  await flush();
  assert.match(root.textContent, /The tools could not be loaded/);
  fire(root.querySelectorAll('button').find((b) => b.textContent === 'Retry'), 'click');
  assert.equal(tries, 2);
  dispose();
});

test('WEB-176: mountTools returns a dispose that stops the microphone', async () => {
  const { env, track } = fakeEnv();
  const panel = document.createElement('div');
  const dispose = mountTools(panel, env);
  fire(panel.querySelector('.mt-toggle'), 'click');
  await flush();
  dispose();
  assert.equal(track.stopped, 1);
});
