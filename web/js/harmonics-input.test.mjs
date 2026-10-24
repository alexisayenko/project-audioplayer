import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { createMicInput, createPlayerInput, MIC_CONSTRAINTS } = await import('./harmonics-input.js');

function node() {
  return { connected: [], connect(n) { this.connected.push(n); }, disconnect() { this.gone = true; } };
}

function fakeMic({ fail = null } = {}) {
  const track = { stopped: 0, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, removeEventListener() {}, stop() { this.stopped += 1; } };
  const made = [];
  class Ctx {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; this.closed = false; made.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), fftSize: 0, smoothingTimeConstant: 0 }; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  const navigator = {
    mediaDevices: {
      asked: null,
      async getUserMedia(c) { navigator.mediaDevices.asked = c; if (fail) throw Object.assign(new Error('x'), { name: fail }); return { getTracks: () => [track] }; },
      addEventListener() {}, removeEventListener() {},
    },
  };
  return { track, made, navigator, AudioContext: Ctx };
}

test('the microphone input asks for raw audio, analyses it and releases everything on stop', async () => {
  const env = fakeMic();
  const mic = createMicInput(env);
  assert.equal(await mic.start(), true);
  assert.deepEqual(env.navigator.mediaDevices.asked, MIC_CONSTRAINTS);
  assert.equal(mic.analyser.fftSize, 16384);
  assert.equal(mic.sampleRate, 48000);
  mic.stop();
  assert.equal(env.track.stopped, 1);
  assert.equal(env.made[0].closed, true);
  assert.equal(mic.analyser, null);
});

test('the microphone input reports errors and honours a stop while the permission is pending', async () => {
  const denied = createMicInput(fakeMic({ fail: 'NotAllowedError' }));
  await assert.rejects(() => denied.start(), { name: 'NotAllowedError' });
  assert.equal(denied.starting, false);
  const env = fakeMic();
  const mic = createMicInput(env);
  const pending = mic.start();
  mic.stop();
  assert.equal(await pending, false);
  assert.equal(env.track.stopped, 1);
  assert.equal(mic.live, false);
  await assert.rejects(() => createMicInput({ navigator: {}, AudioContext: null }).start(), { name: 'NotSupportedError' });
});

test('the player input reuses the shared graph and never builds a second source', () => {
  const calls = [];
  let state = 'off';
  const graph = {
    getAnalyser: () => (state === 'running' ? { fftSize: 8192 } : null),
    getContext: () => (state === 'running' ? { sampleRate: 44100 } : null),
    getState: () => state,
    isSupported: () => true,
    unlock(audio) { calls.push(audio); state = 'running'; },
  };
  const audio = { paused: true, ended: false };
  const p = createPlayerInput({ graph, audio });
  assert.equal(p.playing, false);
  assert.equal(p.analyser, null);
  audio.paused = false;
  assert.equal(p.playing, true);
  p.ensure();
  p.ensure();
  assert.equal(calls.length, 1);
  assert.equal(p.analyser.fftSize, 8192);
  assert.equal(p.sampleRate, 44100);
  assert.equal(createPlayerInput({ graph, audio: null, document: {} }).available, false);
});
