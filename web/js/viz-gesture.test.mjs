import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, fire, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const audioGraph = await import('./audio-graph.js');
const { initVisualizer } = await import('./viz-ui.js');
const { setVizBackground } = await import('./viz-settings.js');

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const fakeCtx = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
$('viz-bg').getContext = fakeCtx;
$('viz-full-canvas').getContext = fakeCtx;

const stats = { ctors: 0, sources: 0, resumeTo: 'suspended' };
class FakeAudioContext {
  constructor() { stats.ctors += 1; this.state = 'suspended'; this.destination = {}; }
  resume() { this.state = stats.resumeTo; return Promise.resolve(); }
  addEventListener() {}
  createGain() { return { connect() {} }; }
  createAnalyser() { return { connect() {}, frequencyBinCount: 4, getFloatFrequencyData(b) { b.fill(-100); }, getByteFrequencyData() {} }; }
  createMediaElementSource() { stats.sources += 1; return { connect() {} }; }
}
const win = { AudioContext: FakeAudioContext, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const player = { current: null, toggle() {}, prev() {}, next() {}, seek() {} };

audioGraph.resetForTests();
document.body.dataset.route = 'library';
setVizBackground(true);
initVisualizer({ player, audio, graph: audioGraph, win });

test('no graph without a gesture, even when playback starts or a track ends', async () => {
  audio.play();
  audio.dispatchEvent({ type: 'ended' });
  await flush();
  assert.equal(stats.ctors, 0);
});

test('the first gesture unlocks once; a blocked context is retried on the next gesture', async () => {
  fire(document.body, 'pointerdown');
  await flush();
  assert.equal(stats.ctors, 1);
  assert.equal(stats.sources, 1);
  assert.equal(audioGraph.getState(), 'blocked');
  stats.resumeTo = 'running';
  fire(document.body, 'click');
  await flush();
  assert.equal(audioGraph.getState(), 'running');
  assert.ok(audioGraph.getAnalyser());
  assert.equal(stats.ctors, 1);
  assert.equal(stats.sources, 1);
});

test('once running the listeners are removed and no further graph work happens', async () => {
  fire(document.body, 'keydown', { key: 'x' });
  fire(document.body, 'touchend');
  await flush();
  assert.equal(stats.ctors, 1);
  assert.equal(stats.sources, 1);
});

after(() => { setVizBackground(false); });
