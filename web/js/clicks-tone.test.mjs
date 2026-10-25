import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/synthesize/clicks', href: 'http://localhost/' };
const c = await import('./clicks-tone.js');
const { TERMS, termById } = await import('./glossary-terms.js');
const { RELATIONS, DOMAIN_OF } = await import('./glossary-map.js');
const { PAGES, pageFromHash } = await import('../../studio/routes.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function fakeCtx() {
  const param = () => ({ value: 0, calls: [], setValueAtTime(...a) { this.calls.push(['set', ...a]); }, linearRampToValueAtTime(...a) { this.calls.push(['ramp', ...a]); }, setTargetAtTime(...a) { this.calls.push(['target', ...a]); }, cancelScheduledValues() {} });
  const made = [];
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; this.closed = false; this.gains = []; this.sources = []; this.waves = []; this.osc = null; made.push(this); }
    createGain() { const g = { gain: param(), connect() {}, disconnect() {} }; this.gains.push(g); return g; }
    createOscillator() { const o = { type: '', frequency: param(), wave: null, connect() {}, disconnect() {}, start(t) { this.started = t; }, stop(t) { this.stopped = t; }, setPeriodicWave(w) { this.wave = w; } }; this.osc = o; return o; }
    createBuffer(ch, len, sr) { return { length: len, sampleRate: sr, copyToChannel() {} }; }
    createBufferSource() { const s = { buffer: null, connect() {}, disconnect() {}, start(t) { this.t = t; }, stop() { this.cancelled = true; } }; this.sources.push(s); return s; }
    createPeriodicWave(real, imag, opts) { const w = { k: real.length - 1, real, opts }; this.waves.push(w); return w; }
    close() { this.closed = true; return Promise.resolve(); }
    resume() { return Promise.resolve(); }
  }
  const doc = { hidden: false, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); } };
  return { Ctx, made, doc, env: { AudioContext: Ctx, document: doc, raf: () => 0 } };
}

test('STU-048: the readout is "N clicks per second = N x 60 BPM = N Hz" with an integer BPM above 200 and one decimal below', () => {
  assert.equal(c.rateReadout(2), '2 clicks per second = 120 BPM = 2 Hz');
  assert.equal(c.rateReadout(1), '1 click per second = 60 BPM = 1 Hz');
  assert.equal(c.rateReadout(1000 / 60), '16.7 clicks per second = 1000 BPM = 16.7 Hz');
  assert.equal(c.rateReadout(20), '20 clicks per second = 1200 BPM = 20 Hz');
  assert.equal(c.rateReadout(100), '100 clicks per second = 6000 BPM = 100 Hz');
  assert.equal(c.rateReadout(440), '440 clicks per second = 26400 BPM = 440 Hz');
  assert.equal(c.rateReadout(1.5), '1.5 clicks per second = 90 BPM = 1.5 Hz');
  assert.equal(c.fmtBpm(100.04), '100');
  assert.equal(c.fmtBpm(100.26), '100.3');
  assert.equal(c.fmtBpm(200), '200');
  assert.equal(c.fmtBpm(200.4), '200');
  assert.equal(c.bpmOf(20), 1200);
});

test('STU-048: the regime label follows the rate and names the note above 30 per second', () => {
  assert.equal(c.regimeOf(4.9), 'rhythm');
  assert.equal(c.regimeOf(5), 'fast');
  assert.equal(c.regimeOf(14.9), 'fast');
  assert.equal(c.regimeOf(15), 'border');
  assert.equal(c.regimeOf(30), 'border');
  assert.equal(c.regimeOf(30.1), 'tone');
  assert.equal(c.regimeText(2), 'Rhythm: separate beats');
  assert.equal(c.regimeText(10), 'Fast pulses: you can still count them');
  assert.equal(c.regimeText(1000 / 60), 'The border: flutter and roughness, the beats start to fuse into a tone');
  assert.equal(c.regimeText(440), 'Tone: you hear a pitch of 440 Hz (A4 +0 cents)');
  assert.equal(c.regimeText(100), 'Tone: you hear a pitch of 100 Hz (G2 +35 cents)');
  assert.match(c.regimeText(31), /^Tone: you hear a pitch of 31 Hz \(B0 /);
});

test('STU-048: the slider is logarithmic from 1 to 1000 and the rate is clamped', () => {
  assert.equal(c.sliderToRate(0), 1);
  assert.equal(c.sliderToRate(100), 2);
  assert.equal(c.sliderToRate(1000), 1000);
  assert.equal(c.sliderToRate(500), 31.6);
  assert.equal(c.rateToSlider(2), 100);
  assert.equal(c.rateToSlider(1), 0);
  assert.equal(c.rateToSlider(1000), 1000);
  assert.ok(Math.abs(c.rateToSlider(440) - 881) <= 1);
  assert.equal(c.clampRate(0), 1);
  assert.equal(c.clampRate(5000), 1000);
  assert.equal(c.clampRate(NaN), 2);
  assert.deepEqual(c.DEFAULTS, { rate: 2, amp: 0.3, length: 2, continuous: true });
  assert.equal(c.clampParams({ amp: 1 }).amp, 0.8);
  assert.equal(c.clampParams({ amp: 0.789 }).amp, 0.79);
});

test('STU-048: the six presets are the asked rates', () => {
  assert.deepEqual(c.PRESETS.map((p) => p.label), ['120 BPM (2/s)', '600 BPM (10/s)', '1000 BPM (16.7/s, Moby Thousand)', '1200 BPM (20/s)', '100 Hz', 'A4 440 Hz']);
  assert.deepEqual(c.PRESETS.map((p) => Math.round(c.bpmOf(p.rate))), [120, 600, 1000, 1200, 6000, 26400]);
});

test('STU-048: the window adapter shows about 8 periods between 5 ms and 4 s', () => {
  assert.equal(c.windowMs(2), 4000);
  assert.equal(c.clicksInWindow(2), 8);
  assert.equal(c.windowCaption(2), '8 clicks in 4 s');
  assert.equal(c.windowMs(1), 4000);
  assert.equal(c.windowCaption(1), '4 clicks in 4 s');
  assert.equal(c.windowCaption(1.5), '6 clicks in 4 s');
  assert.ok(near(c.windowMs(440), 8000 / 440));
  assert.equal(c.windowCaption(440), '8 clicks in 18.2 ms');
  assert.equal(c.windowCaption(1000), '8 clicks in 8 ms');
  assert.equal(c.windowMs(100000), 5);
  assert.equal(c.fmtSpan(4000), '4 s');
  assert.equal(c.fmtSpan(533.3), '533 ms');
  assert.deepEqual(c.windowTicks(4000).map((t) => t.ms), [0, 1000, 2000, 3000, 4000]);
});

test('STU-048: the click series has one spike of the amplitude per click, half a period in', () => {
  const v = c.clickSeries(0.3, 801, 8);
  assert.equal(v.length, 801);
  assert.equal(v.filter((x) => x === 0.3).length, 8);
  assert.equal(v.indexOf(0.3), Math.round((0.5 / 8) * 800));
  assert.equal(c.clickSeries(0.3, 801, 3.2).filter((x) => x).length, 3);
});

test('STU-048: the harmonics are H1 to H16 at multiples of the rate, all equal, and below 20 per second the title says infrasound', () => {
  const rows = c.harmonicRows(440);
  assert.equal(rows.length, 16);
  assert.deepEqual(rows.map((r) => r.hz).slice(0, 3), [440, 880, 1320]);
  assert.equal(new Set(rows.map((r) => r.level)).size, 1);
  assert.equal(c.harmonicsTitle(19.9), 'Frequencies in the rhythm (infrasound: below hearing)');
  assert.equal(c.harmonicsTitle(20), 'Harmonics of the click train');
  assert.match(c.HARM_NOTE, /every harmonic of its rate at equal strength/);
  assert.equal(c.fmtHz(2), '2 Hz');
  assert.equal(c.fmtHz(16000), '16 kHz');
  assert.deepEqual(c.harmonicLabelSteps(60), { names: 1, hz: 1 });
  assert.deepEqual(c.harmonicLabelSteps(18.1), { names: 2, hz: 4 });
});

test('STU-048: an impulse train keeps at least 16 equal harmonics up to 1000 per second and at most 2048', () => {
  assert.equal(c.harmonicCount(1, 48000), 2048);
  assert.equal(c.harmonicCount(2, 48000), 2048);
  assert.equal(c.harmonicCount(440, 48000), 45);
  assert.equal(c.harmonicCount(1000, 48000), 16);
  assert.equal(c.harmonicCount(1000, 44100), 16);
  for (const r of [1, 7, 33, 100, 440, 999, 1000]) assert.ok(c.harmonicCount(r, 48000) * r <= 0.45 * 48000, r);
});

test('STU-048: the click is a 2 ms burst that starts at full scale and decays', () => {
  const b = c.clickBurst(48000);
  assert.equal(b.length, 96);
  assert.equal(b[0], 1);
  assert.ok(Math.max(...b.slice(1).map(Math.abs)) <= 0.5);
  assert.ok(Math.max(...b.slice(60).map(Math.abs)) < 0.05);
  assert.deepEqual(Array.from(c.clickBurst(48000)), Array.from(b));
});

test('STU-048: the tone path starts at 25 per second and stays until 22 (hysteresis)', () => {
  assert.equal(c.modeFor(24.9, null), 'rhythm');
  assert.equal(c.modeFor(25, null), 'tone');
  assert.equal(c.modeFor(24, 'tone'), 'tone');
  assert.equal(c.modeFor(21.9, 'tone'), 'rhythm');
  assert.equal(c.modeFor(24, 'rhythm'), 'rhythm');
});

test('STU-048: below 25 per second the engine schedules a click every period from the rate, none above', () => {
  const { Ctx } = fakeCtx();
  const ctx = new Ctx();
  const eng = c.createClickEngine(ctx, { rate: 2, amp: 0.3, fade: 0 });
  assert.equal(eng.mode, 'rhythm');
  eng.start(0);
  eng.pump(1);
  assert.deepEqual(ctx.sources.map((s) => s.t), [0, 0.5]);
  assert.deepEqual(ctx.gains[0].gain.calls[0], ['set', 0.3, 0]);
  assert.equal(ctx.osc.started, 0);
  const tone = new Ctx();
  const e2 = c.createClickEngine(tone, { rate: 440, amp: 0.3, fade: 0 });
  assert.equal(e2.mode, 'tone');
  e2.start(0);
  e2.pump(1);
  assert.equal(tone.sources.length, 0);
  assert.equal(tone.waves.length, 1);
  assert.equal(tone.waves[0].k, 45);
  assert.deepEqual(tone.waves[0].opts, { disableNormalization: true });
  assert.ok(tone.waves[0].real.slice(1).every((v) => v === Math.fround(1 / 45)));
  assert.equal(tone.osc.wave, tone.waves[0]);
  assert.deepEqual(tone.osc.frequency.calls[0], ['set', 440, 0]);
});

test('STU-048: a rate change re-times the next click, and crossing 25 per second cross-fades the two paths', () => {
  const { Ctx } = fakeCtx();
  const ctx = new Ctx();
  const eng = c.createClickEngine(ctx, { rate: 2, amp: 0.3, fade: 0 });
  eng.start(0);
  ctx.currentTime = 0.05;
  eng.setRate(10);
  eng.pump(0.3);
  const times = ctx.sources.filter((s) => !s.cancelled).map((s) => s.t);
  assert.equal(times.length, 3);
  assert.ok(near(times[1], 0.1) && near(times[2], 0.2));
  assert.deepEqual(ctx.osc.frequency.calls.at(-1).slice(0, 2), ['target', 10]);
  const [, toneGain, clickGain] = ctx.gains;
  eng.setRate(100);
  assert.equal(eng.mode, 'tone');
  assert.equal(toneGain.gain.calls.at(-1)[1], 1);
  assert.equal(clickGain.gain.calls.at(-1)[1], 0);
  const before = ctx.sources.length;
  eng.pump(1);
  assert.equal(ctx.sources.length, before);
  eng.setRate(24);
  assert.equal(eng.mode, 'tone');
  eng.setRate(10);
  assert.equal(eng.mode, 'rhythm');
  assert.equal(clickGain.gain.calls.at(-1)[1], 1);
});

test('STU-048: Play fades in over 30 ms, a rate change moves the oscillator, Stop fades out in 30 ms and the context closes; a hidden page stops it', () => {
  const { env, made, doc } = fakeCtx();
  const card = c.createClicksCard(env);
  card.change({ rate: 440 });
  card.start();
  const ctx = made[0];
  assert.equal(card.running, true);
  assert.deepEqual(ctx.gains[0].gain.calls.slice(0, 2), [['set', 0, 0], ['ramp', 0.3, 0.03]]);
  card.change({ rate: 100 });
  assert.deepEqual(ctx.osc.frequency.calls.at(-1).slice(0, 2), ['target', 100]);
  card.stop();
  assert.equal(card.running, false);
  assert.equal(ctx.osc.stopped, 0.03);
  ctx.osc.onended();
  assert.equal(ctx.closed, true);
  assert.equal(card.state, 'stopped');
  card.start();
  doc.hidden = true;
  for (const f of doc.handlers.visibilitychange) f();
  assert.equal(card.running, false);
  assert.equal(made[1].closed, true);
  card.dispose();
});

test('STU-048: the card shows the title, the intro, six chips, the two views and the glossary links, and a chip sets the rate', () => {
  const { env } = fakeCtx();
  const card = c.createClicksCard(env);
  const text = card.node.textContent;
  assert.equal(card.node.querySelector('h2').textContent, 'Clicks to tone');
  assert.ok(text.includes('A repeating click: slow it is a beat, fast it becomes a tone.'));
  assert.ok(text.includes('2 clicks per second = 120 BPM = 2 Hz'));
  assert.ok(text.includes('Rhythm: separate beats'));
  assert.ok(text.includes('Waveform: clicks over time'));
  assert.ok(text.includes('8 clicks in 4 s'));
  assert.ok(text.includes('Frequencies in the rhythm (infrasound: below hearing)'));
  assert.equal(card.node.querySelectorAll('.cl-presets .chip').length, 6);
  assert.equal(card.node.querySelectorAll('.sm-info').length, 3);
  assert.equal(card.params.continuous, true);
  card.node.querySelectorAll('.cl-presets .chip')[5].click();
  assert.equal(card.params.rate, 440);
  assert.ok(card.node.textContent.includes('Tone: you hear a pitch of 440 Hz (A4 +0 cents)'));
  assert.ok(card.node.textContent.includes('Harmonics of the click train'));
  assert.equal(card.node.querySelectorAll('.cl-presets .chip.on').length, 1);
  assert.ok(card.node.querySelector('a[href="#/glossary/click-train"]'));
  card.dispose();
});

test('STU-048: the page is in the menu right after Primitive, with an alias, and the glossary has the three terms', () => {
  const i = PAGES.findIndex((p) => p.id === 'synthesize/clicks');
  assert.equal(PAGES[i - 1].id, 'synthesize/simple');
  assert.equal(PAGES[i].label, 'Clicks to tone');
  assert.equal(pageFromHash('#/clicks'), 'synthesize/clicks');
  assert.equal(pageFromHash('#/synthesize/clicks'), 'synthesize/clicks');
  for (const id of ['click-train', 'flutter-and-roughness', 'repetition-rate']) {
    assert.ok(termById(id), id);
    assert.deepEqual(termById(id).demo, { page: 'synthesize/clicks', label: 'Clicks to tone' });
  }
  assert.equal(DOMAIN_OF['click-train'], 'physics');
  assert.equal(DOMAIN_OF['repetition-rate'], 'physics');
  assert.equal(DOMAIN_OF['flutter-and-roughness'], 'perception');
  assert.match(termById('click-train').text, /^A series of identical short clicks at a steady rate\./);
  const has = (from, to) => RELATIONS.some((r) => r.from === from && r.to === to);
  assert.ok(has('rhythm', 'pitch') && has('beat', 'click-train') && has('click-train', 'harmonics') && has('tempo', 'frequency'));
  assert.equal(TERMS.length, 110);
});
