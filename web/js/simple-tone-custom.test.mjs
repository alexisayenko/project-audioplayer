import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/synthesize/simple', href: 'http://localhost/' };
const s = await import('./simple-tone.js');
const c = await import('./custom-wave.js');
const ed = await import('./harmonic-editor.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function fakeEnv() {
  const oscs = [];
  const gains = [];
  const frames = [];
  const param = () => ({ value: 0, calls: [], setValueAtTime(...a) { this.calls.push(['set', ...a]); }, linearRampToValueAtTime(...a) { this.calls.push(['ramp', ...a]); }, setTargetAtTime(...a) { this.calls.push(['target', ...a]); }, cancelScheduledValues() {} });
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; this.waves = []; }
    createOscillator() { const o = { type: '', frequency: param(), connect() {}, disconnect() {}, start(t) { this.started = t; }, stop(t) { this.stopped = t; }, setPeriodicWave(w) { this.wave = w; this.waveCalls = (this.waveCalls || 0) + 1; } }; oscs.push(o); return o; }
    createPeriodicWave(real, imag, opts) { const w = { real, imag, opts }; this.waves.push(w); return w; }
    createGain() { const g = { gain: param(), connect() {}, disconnect() {} }; gains.push(g); return g; }
    createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData() {} }; }
    close() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
  }
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const env = { AudioContext: Ctx, document: doc, raf: (f) => { frames.push(f); return frames.length; }, caf: () => {} };
  const frame = () => { const list = frames.splice(0); for (const f of list) f(); };
  return { env, oscs, gains, frame };
}

const customCard = (env) => {
  const card = s.createSimpleCard(env);
  card.change({ wave: 'custom' });
  return card;
};

test('WEB-211: Custom is the fifth Waveform option; picking it shows the harmonics editor instead of the read-only chart', () => {
  const card = s.createSimpleCard(fakeEnv().env);
  const buttons = card.node.querySelectorAll('.sm-wave .seg-btn');
  assert.equal(buttons.length, 5);
  assert.equal(buttons[4].getAttribute('aria-label'), 'Custom');
  assert.equal(card.node.querySelector('.he').hidden, true);
  buttons[4].click();
  assert.equal(card.params.wave, 'custom');
  assert.equal(card.node.querySelector('.he').hidden, false);
  assert.ok(card.node.querySelector('.ca-harm:not(.he-svg)').classList.contains('he-gone'));
  assert.ok(card.node.textContent.includes('Harmonics: drag the bars (H1 = 100 %)'));
  assert.ok(card.node.textContent.includes('Custom wave = the sum of the harmonic bars below'));
  buttons[0].click();
  assert.equal(card.node.querySelector('.he').hidden, true);
  card.dispose();
});

test('WEB-211: every harmonic bar is a vertical slider from -100 to 100 with a label that carries its real frequency; 16 show by default, 32 with More harmonics', () => {
  const card = customCard(fakeEnv().env);
  const hits = card.node.querySelectorAll('.he-hit');
  assert.equal(hits.length, 32);
  assert.equal(hits.filter((h) => h.getAttribute('display') === 'inline').length, 16);
  const h3 = hits[2];
  assert.equal(h3.getAttribute('role'), 'slider');
  assert.equal(h3.getAttribute('tabindex'), '0');
  assert.equal(h3.getAttribute('aria-valuemin'), '-100');
  assert.equal(h3.getAttribute('aria-valuemax'), '100');
  assert.equal(h3.getAttribute('aria-valuenow'), '0');
  assert.equal(h3.getAttribute('aria-label'), 'Harmonic 3, 1320 Hz, 0 percent');
  assert.equal(hits[0].getAttribute('aria-valuenow'), '100');
  card.change({ freq: 220 });
  assert.equal(h3.getAttribute('aria-label'), 'Harmonic 3, 660 Hz, 0 percent');
  const more = card.node.querySelectorAll('.he .hm-check input').find((b) => b.getAttribute('id').endsWith('-more'));
  more.checked = true;
  fire(more, 'change');
  assert.equal(hits.filter((h) => h.getAttribute('display') === 'inline').length, 32);
  assert.ok(card.node.querySelector('.he-svg').classList.contains('he-wide'));
  card.dispose();
});

test('WEB-211: the keyboard edits a bar: arrows +-1, Shift +-10, Home and End the limits, Delete resets to 0', () => {
  const card = customCard(fakeEnv().env);
  const h3 = card.node.querySelectorAll('.he-hit')[2];
  const key = (k, shiftKey = false) => fire(h3, 'keydown', { key: k, shiftKey });
  key('ArrowUp');
  assert.equal(card.custom.bars[2], 1);
  key('ArrowUp', true);
  assert.equal(card.custom.bars[2], 11);
  key('ArrowDown');
  key('ArrowLeft');
  assert.equal(card.custom.bars[2], 9);
  key('End');
  assert.equal(card.custom.bars[2], 100);
  key('Home');
  assert.equal(card.custom.bars[2], -100);
  assert.equal(h3.getAttribute('aria-valuenow'), '-100');
  key('Delete');
  assert.equal(card.custom.bars[2], 0);
  key('x');
  assert.equal(card.custom.bars[2], 0);
  card.dispose();
});

test('WEB-211: dragging on the chart sets the bar under the pointer, snaps to whole percents, and Shift gives 0.1 steps', () => {
  const card = customCard(fakeEnv().env);
  const svg = card.node.querySelector('.he-svg');
  const rect = svg.getBoundingClientRect();
  const kx = ed.edWidth(16) / rect.width;
  const ky = ed.ED.h / rect.height;
  const at = (col, value, extra = {}) => ({ clientX: (ed.columnX(col) + ed.ED.cell / 2) / kx, clientY: (ed.ED.zero - (value / 100) * ed.ED.half) / ky, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse', ...extra });
  fire(svg, 'pointerdown', at(2, 33.4));
  assert.equal(card.custom.bars[2], 33);
  fire(svg, 'pointermove', at(2, 50));
  assert.equal(card.custom.bars[2], 50);
  fire(svg, 'pointermove', at(4, -20));
  assert.equal(card.custom.bars[4], -20);
  assert.ok(card.custom.bars[3] < 50 && card.custom.bars[3] > -20);
  fire(svg, 'pointermove', at(4, 12.34, { shiftKey: true }));
  assert.equal(card.custom.bars[4], 12.3);
  fire(svg, 'pointerup', at(4, 12.34, { buttons: 0 }));
  fire(svg, 'pointermove', at(6, 70));
  assert.equal(card.custom.bars[6], 0);
  fire(svg, 'pointerdown', at(6, 250));
  assert.equal(card.custom.bars[6], 100);
  card.dispose();
});

test('WEB-211: a drag whose pointerup was lost ends on the next move without a button', () => {
  const card = customCard(fakeEnv().env);
  const svg = card.node.querySelector('.he-svg');
  const rect = svg.getBoundingClientRect();
  const kx = ed.edWidth(16) / rect.width;
  const ky = ed.ED.h / rect.height;
  const at = (col, value, extra = {}) => ({ clientX: (ed.columnX(col) + ed.ED.cell / 2) / kx, clientY: (ed.ED.zero - (value / 100) * ed.ED.half) / ky, pointerId: 3, button: 0, buttons: 1, pointerType: 'mouse', ...extra });
  fire(svg, 'pointerdown', at(1, 40));
  assert.equal(card.custom.bars[1], 40);
  fire(svg, 'pointermove', at(5, 60, { buttons: 0 }));
  assert.equal(card.custom.bars[5], 0);
  card.dispose();
});

test('WEB-211: preset chips sit in labelled groups, Clear and Reset are a separate pair of action buttons', () => {
  const card = customCard(fakeEnv().env);
  const groups = card.node.querySelectorAll('.he-presets .he-group');
  assert.deepEqual(groups.map((g) => g.getAttribute('aria-label')), ['Simple waves', 'Instrument-like', 'Odd and missing harmonics']);
  assert.ok(groups.every((g) => g.getAttribute('role') === 'group'));
  assert.deepEqual(groups.map((g) => g.querySelectorAll('.chip').map((b) => b.textContent)), [
    ['Sine', 'Triangle', 'Square', 'Sawtooth'], ['Organ-like', 'Piano-like', 'Guitar-like', 'Cello-like'], ['Hollow', 'Only overtones']]);
  assert.ok(groups.every((g) => g.querySelectorAll('.chip').every((b) => b.getAttribute('aria-pressed') !== null)));
  const actions = card.node.querySelector('.he-presets .he-actions');
  assert.equal(actions.getAttribute('role'), 'group');
  assert.deepEqual(actions.querySelectorAll('.chip').map((b) => b.textContent), ['Clear', 'Reset']);
  assert.ok(actions.querySelectorAll('.chip').every((b) => b.getAttribute('aria-pressed') === null && b.classList.contains('he-action')));
  card.dispose();
});

test('WEB-211: presets fill the bars with the recipes (square H3 is 33.3), Reset returns to a sine, Only overtones says what it shows', () => {
  const card = customCard(fakeEnv().env);
  const chip = (t) => card.node.querySelectorAll('.he-presets .chip').find((b) => b.textContent === t);
  chip('Square').click();
  assert.ok(near(card.custom.bars[2], 100 / 3));
  assert.equal(chip('Square').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('Sawtooth').getAttribute('aria-pressed'), 'false');
  chip('Organ-like').click();
  assert.deepEqual(card.custom.bars.slice(0, 6), [100, 80, 60, 40, 30, 0]);
  assert.equal(chip('Organ-like').getAttribute('aria-pressed'), 'true');
  chip('Piano-like').click();
  assert.deepEqual(card.custom.bars.slice(0, 13), [100, 65, 45, 30, 20, 14, 9, 6, 4, 3, 2, 1, 0]);
  assert.equal(chip('Piano-like').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('Organ-like').getAttribute('aria-pressed'), 'false');
  chip('Guitar-like').click();
  assert.deepEqual(card.custom.bars.slice(0, 13), [100, 75, 50, 20, 3, 14, 10, 5, 3, 1, 2, 2, 0]);
  assert.equal(chip('Guitar-like').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('Piano-like').getAttribute('aria-pressed'), 'false');
  chip('Cello-like').click();
  assert.deepEqual(card.custom.bars.slice(0, 13), [100, 70, 55, 40, 30, 22, 16, 11, 8, 5, 3, 2, 0]);
  assert.equal(chip('Cello-like').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('Guitar-like').getAttribute('aria-pressed'), 'false');
  assert.match(chip('Cello-like').getAttribute('title'), /simple approximation/);
  chip('Only overtones').click();
  assert.equal(card.custom.bars[0], 0);
  assert.match(chip('Only overtones').getAttribute('title'), /Missing fundamental/);
  chip('Clear').click();
  assert.ok(card.custom.bars.every((v) => v === 0));
  assert.equal(chip('Clear').getAttribute('aria-pressed'), null);
  assert.ok(!chip('Clear').classList.contains('on'));
  assert.ok(card.node.textContent.includes('All bars are zero: this is silence.'));
  chip('Square').click();
  chip('Reset').click();
  assert.deepEqual(card.custom.bars, c.defaultBars());
  assert.equal(card.custom.buildN, 32);
  card.dispose();
});

test('WEB-211: the sound is a PeriodicWave of the bars, normalised by us, RMS-compensated like the other shapes and capped at 80 percent', () => {
  const { env, oscs, gains } = fakeEnv();
  const card = customCard(env);
  card.node.querySelectorAll('.he-presets .chip').find((b) => b.textContent === 'Square').click();
  card.start();
  const o = oscs[0];
  assert.equal(o.type, '');
  assert.equal(o.waveCalls, 1);
  assert.equal(o.wave.opts.disableNormalization, true);
  assert.equal(o.wave.real.length, 33);
  assert.ok(o.wave.real.every((v) => v === 0));
  assert.equal(o.wave.imag[0], 0);
  assert.equal(o.wave.imag[2], 0);
  assert.ok(near(o.wave.imag[3] / o.wave.imag[1], 1 / 3, 1e-6));
  const level = gains[1].gain.calls[1][1];
  assert.ok(near(level, c.customGain(0.3, card.sound.rms), 1e-12));
  assert.ok(near(level * card.sound.rms, 0.3 * Math.SQRT1_2, 1e-9));
  assert.ok(level <= 0.8);
  card.change({ amp: 0.8 });
  const sawLevel = (() => { card.setPreset('sawtooth'); return s.oscGain('custom', 0.8, card.sound.rms); })();
  assert.equal(sawLevel, 0.8);
  card.dispose();
});

test('WEB-211: while playing, a small bar change calls setPeriodicWave once per frame on the same oscillator; a big one crossfades to a second oscillator', () => {
  const { env, oscs, frame } = fakeEnv();
  const card = customCard(env);
  card.setPreset('square');
  card.start();
  assert.equal(oscs.length, 1);
  card.setBar(1, 1);
  card.setBar(1, 2);
  card.setBar(1, 3);
  assert.equal(oscs[0].waveCalls, 1);
  frame();
  assert.equal(oscs[0].waveCalls, 2);
  assert.equal(oscs.length, 1);
  frame();
  assert.equal(oscs[0].waveCalls, 2);
  card.setPreset('sawtooth');
  frame();
  assert.equal(oscs.length, 2);
  assert.equal(oscs[0].stopped, 0.03);
  assert.equal(oscs[1].waveCalls, 1);
  card.stop();
  card.dispose();
});

test('WEB-211: both scopes draw the custom shape from the table, one cycle and the repeated window', () => {
  const card = customCard(fakeEnv().env);
  card.setPreset('square');
  const shown = card.sound.table;
  const one = s.scopeSeries(0.5, 401, 1, 'custom', shown);
  assert.ok(near(one[100], 0.5 * c.tableAt(shown, 0.25), 1e-9));
  assert.ok(near(one[0], 0, 1e-9));
  const many = s.scopeSeries(0.5, 801, 4, 'custom', shown);
  assert.ok(near(many[100], many[300], 1e-9));
  assert.ok(near(s.scopeSeries(0.3, 5, 1, 'custom', null)[1], 0.3, 1e-9));
  card.dispose();
});

test('WEB-211: the 20 kHz note shows when the highest nonzero harmonic passes 20 kHz, and hidden bars are announced', () => {
  const card = customCard(fakeEnv().env);
  const notes = () => card.node.querySelectorAll('.he-note').map((n) => n.textContent);
  card.setPreset('square');
  assert.deepEqual(notes(), ['Harmonics 17 to 32 are hidden but still play.']);
  card.change({ freq: 2000 });
  assert.ok(notes().includes('Harmonics above 20 kHz are not played.'));
  card.setPreset('sine');
  assert.deepEqual(notes(), []);
  card.dispose();
});

test('WEB-211: Build up draws the first N bars; the sound keeps all of them unless Play the build-up too is on', () => {
  const { env, oscs, frame } = fakeEnv();
  const card = customCard(env);
  card.setPreset('square');
  card.start();
  const range = card.node.querySelector('.he-build input[type="range"]');
  const box = card.node.querySelectorAll('.he .hm-check input').find((b) => b.getAttribute('id').endsWith('-pb'));
  range.value = '3';
  fire(range, 'input');
  assert.equal(card.custom.buildN, 3);
  assert.ok(near(card.sound.rms, c.analyzeBars(c.presetBars('square')).rms, 1e-12));
  frame();
  assert.equal(oscs[0].waveCalls, 1);
  assert.equal(card.node.querySelectorAll('.he-bar').filter((b) => b.classList.contains('he-off')).length, 13);
  box.checked = true;
  fire(box, 'change');
  assert.ok(near(card.sound.rms, c.analyzeBars(c.partialBars(c.presetBars('square'), 3)).rms, 1e-12));
  frame();
  assert.ok(oscs[0].waveCalls >= 2 || oscs.length === 2);
  card.stop();
  card.dispose();
});

test('WEB-211: Show each harmonic passes the strongest bars to the scope as faint lines', () => {
  const card = customCard(fakeEnv().env);
  card.setPreset('square');
  const box = card.node.querySelectorAll('.he .hm-check input').find((b) => b.getAttribute('id').endsWith('-each'));
  box.checked = true;
  fire(box, 'change');
  assert.equal(card.custom.showEach, true);
  assert.equal(c.strongest(card.custom.bars).length, 8);
  card.dispose();
});

test('WEB-211: pure helpers: primitiveWave, waveFromHash, oscGain and readout for the custom shape', () => {
  assert.equal(s.primitiveWave('custom'), 'custom');
  assert.equal(s.primitiveWave('nonsense'), 'sine');
  assert.equal(s.clampParams({ wave: 'custom' }).wave, 'custom');
  assert.equal(s.waveFromHash('#/synthesize/simple?wave=custom'), 'custom');
  assert.equal(s.waveFromHash('#/synthesize/simple?wave=square'), 'square');
  assert.equal(s.waveFromHash('#/synthesize/simple?wave=banana'), null);
  assert.equal(s.waveFromHash('#/synthesize/simple'), null);
  const sq = c.analyzeBars(c.presetBars('square'));
  assert.ok(near(s.oscGain('custom', 0.3, sq.rms), c.customGain(0.3, sq.rms)));
  assert.equal(s.oscGain('custom', 0, sq.rms), 0);
  assert.ok(near(s.shapeLevel('custom', 0.3, sq.rms), s.oscGain('custom', 0.3, sq.rms)));
  assert.match(s.readout({ ...s.DEFAULTS, wave: 'custom' }, sq.rms), /power 9 %;/);
  assert.ok(s.PRIMITIVE_WAVES.includes('custom') && s.PRIMITIVE_WAVES.length === 5);
});

test('WEB-211: opening the page with ?wave=custom selects Custom', () => {
  const before = globalThis.location.hash;
  globalThis.location.hash = '#/synthesize/simple?wave=custom';
  const card = s.createSimpleCard(fakeEnv().env);
  assert.equal(card.params.wave, 'custom');
  assert.equal(card.node.querySelector('.he').hidden, false);
  card.dispose();
  globalThis.location.hash = before;
});

test('WEB-211: the 0 label on the chart axis is a button that sets every bar, H1 included, to 0, by click, Enter and Space', () => {
  const card = customCard(fakeEnv().env);
  const btn = card.node.querySelector('.he-zero-btn');
  assert.equal(btn.getAttribute('role'), 'button');
  assert.equal(btn.getAttribute('tabindex'), '0');
  assert.equal(btn.getAttribute('aria-label'), 'Set all harmonics to 0');
  assert.equal(btn.querySelector('title').textContent, 'Set all harmonics to 0');
  assert.equal(card.custom.bars[0], 100);
  card.setPreset('square');
  card.setBar(1, 40);
  btn.click();
  assert.ok(card.custom.bars.every((v) => v === 0));
  assert.equal(card.node.querySelectorAll('.he-hit')[0].getAttribute('aria-valuenow'), '0');
  assert.equal(card.node.querySelectorAll('.he-val-txt')[0].textContent, '0');
  assert.deepEqual(card.node.querySelectorAll('.he-num').slice(0, 3).map((n) => n.textContent), ['H1', 'H2', 'H3']);
  card.setBar(3, 20);
  fire(btn, 'keydown', { key: 'Enter' });
  assert.equal(card.custom.bars[3], 0);
  card.setBar(5, -20);
  fire(btn, 'keydown', { key: ' ' });
  assert.equal(card.custom.bars[5], 0);
  card.setBar(5, -20);
  fire(btn, 'keydown', { key: 'a' });
  assert.equal(card.custom.bars[5], -20);
  card.dispose();
});

test('WEB-211: the readout slot holds the hint and the readout in one grid cell, so hovering a bar never changes its height', () => {
  const card = customCard(fakeEnv().env);
  const read = card.node.querySelector('.he-read');
  assert.equal(read.querySelectorAll('span').length, 2);
  assert.ok(read.textContent.includes('Hover or focus a bar'));
  assert.ok(!read.classList.contains('he-reading'));
  const h3 = card.node.querySelectorAll('.he-hit')[2];
  fire(h3, 'focus');
  assert.ok(read.classList.contains('he-reading'));
  assert.equal(read.querySelector('.he-value').textContent, 'H3 · 1320 Hz · 0 %');
  assert.ok(read.textContent.includes('Hover or focus a bar'));
  card.setBar(2, 33.3);
  assert.equal(read.querySelector('.he-value').textContent, 'H3 · 1320 Hz · 33.3 %');
  fire(h3, 'blur');
  assert.ok(!read.classList.contains('he-reading'));
  card.dispose();
});

test('WEB-211: a second line under each harmonic number shows its value and follows a drag', () => {
  const card = customCard(fakeEnv().env);
  const vals = () => card.node.querySelectorAll('.he-val-txt');
  assert.equal(vals().length, 32);
  assert.equal(vals()[0].textContent, '100');
  assert.equal(vals()[1].textContent, '0');
  const svg = card.node.querySelector('.he-svg');
  const rect = svg.getBoundingClientRect();
  const kx = ed.edWidth(16) / rect.width;
  const ky = ed.ED.h / rect.height;
  const at = (col, value, extra = {}) => ({ clientX: (ed.columnX(col) + ed.ED.cell / 2) / kx, clientY: (ed.ED.zero - (value / 100) * ed.ED.half) / ky, pointerId: 5, button: 0, buttons: 1, pointerType: 'mouse', ...extra });
  fire(svg, 'pointerdown', at(1, -2.4));
  assert.equal(vals()[1].textContent, '-2');
  fire(svg, 'pointermove', at(1, -33.34, { shiftKey: true }));
  assert.equal(vals()[1].textContent, '-33.3');
  assert.ok(Number(vals()[1].getAttribute('textLength')) > 0);
  assert.equal(vals()[0].getAttribute('textLength'), null);
  fire(svg, 'pointerup', at(1, -33.34, { buttons: 0 }));
  card.dispose();
});

test('WEB-211: the chart fills its box: cell width grows with the width, never below 18 px; a value label is squeezed only when it would overlap', () => {
  assert.equal(ed.cellFor(0, 16), ed.ED.cell);
  assert.equal(ed.cellFor(328, 16), 18);
  assert.equal(ed.cellFor(100, 16), 18);
  assert.equal(ed.cellFor(ed.ED.left + ed.ED.right + 16 * 50, 16), 50);
  assert.equal(ed.edWidth(16, 50), ed.ED.left + ed.ED.right + 16 * 50);
  assert.equal(ed.columnX(2, 50), ed.ED.left + 100);
  assert.equal(ed.columnAt(ed.ED.left + 101, 50), 2);
  assert.equal(ed.valueFit('100', 18), null);
  assert.equal(ed.valueFit('-33.3', 18), 16);
  assert.equal(ed.valueFit('-33.3', 40), null);
  assert.equal(ed.numFit('H3', 18), null);
  assert.equal(ed.numFit('H32', 18), 16);
  assert.equal(ed.numFit('H32', 40), null);
  assert.equal(ed.ED.half, 128);
  assert.equal(ed.ED.plotBottom - ed.ED.top, 2 * ed.ED.half);
  assert.equal(ed.ED.h, ed.ED.plotBottom + 32);
});
