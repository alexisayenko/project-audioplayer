import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const h = await import('./harmonics-stack.js');
const cw = await import('./custom-wave.js');
const hm = await import('./harmonics.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const grid = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

test('WEB-212: the series amplitudes of the standard shapes (square odd at 1/n, triangle odd at 1/n squared with alternating sign, sawtooth all at 1/n)', () => {
  assert.equal(h.shapeHarmonics('sine', 440).length, 1);
  const sq = h.shapeHarmonics('square', 440);
  assert.equal(sq.length, 16);
  assert.deepEqual(sq.slice(0, 3).map((x) => x.n), [1, 3, 5]);
  assert.ok(near(sq[1].amp, 1 / 3) && near(sq[1].freqHz, 1320) && sq.every((x) => x.sign === 1));
  const tri = h.shapeHarmonics('triangle', 440);
  assert.ok(near(tri[1].amp, 1 / 9) && tri[1].sign === -1 && tri[2].sign === 1 && near(tri[2].amp, 1 / 25) && tri[3].sign === -1);
  const saw = h.shapeHarmonics('sawtooth', 440);
  assert.equal(saw.length, 32);
  assert.ok(near(saw[1].amp, 0.5) && saw[1].sign === -1 && saw[2].sign === 1);
  assert.equal(h.seriesAmp('square', 2), 0);
  assert.equal(h.shapeHarmonics('square', 100, 8).length, 4);
});

test('WEB-212: the custom bars give signed rows, zero bars give no row', () => {
  const rows = h.barHarmonics(cw.presetBars('triangle'), 220);
  assert.deepEqual(rows.slice(0, 3).map((x) => [x.n, x.sign]), [[1, 1], [3, -1], [5, 1]]);
  assert.ok(near(rows[1].amp, 1 / 9, 1e-9) && near(rows[1].freqHz, 660));
  assert.equal(h.barHarmonics(cw.presetBars('clear'), 220).length, 0);
  assert.deepEqual(h.barHarmonics(cw.presetBars('overtones'), 100).map((x) => x.n), [2, 3, 4, 5, 6, 7, 8]);
});

test('WEB-212: the model shows the first 4, 8 or 12 nonzero harmonics, scales the rows by the largest and says when the sum is partial', () => {
  const sq = h.shapeHarmonics('square', 440);
  for (const rows of [4, 8, 12]) {
    const m = h.stackModel(sq, { rows });
    assert.equal(m.shown.length, rows);
    assert.equal(m.shown.at(-1).n, 2 * rows - 1);
    assert.equal(m.total, 16);
    assert.equal(m.truncated, true);
    assert.equal(m.scale, 1);
  }
  const organ = h.stackModel(h.barHarmonics(cw.presetBars('organ'), 440), { rows: 8 });
  assert.equal(organ.truncated, false);
  assert.equal(organ.shown.length, 5);
  const over = h.stackModel(h.barHarmonics(cw.presetBars('overtones'), 440), { rows: 4 });
  assert.ok(near(over.scale, 0.5));
  assert.equal(h.stackModel(h.shapeHarmonics('sine', 440)).shown.length, 1);
  assert.deepEqual(h.stackModel([], {}).shown, []);
});

test('WEB-212: the Sum row is the scope curve: 8 square rows equal the 32-harmonic partial sum of the first 15, and a full set equals the whole table', () => {
  const N = 1000;
  const bars = cw.presetBars('square');
  const m = h.stackModel(h.shapeHarmonics('square', 440), { rows: 8 });
  const mine = Array.from(h.sumSeries(m.active, N, { peak: m.peak }));
  const table = cw.analyzeBars(cw.partialBars(bars, 15)).table;
  assert.ok(maxDiff(mine, grid(N, (u) => cw.tableAt(table, u))) < 0.01);
  for (const id of ['organ', 'hollow', 'overtones', 'sine']) {
    const b = cw.presetBars(id);
    const full = h.stackModel(h.barHarmonics(b, 440), { rows: 12 });
    assert.equal(full.truncated, false, id);
    const series = Array.from(h.sumSeries(full.active, N, { peak: full.peak }));
    assert.ok(maxDiff(series, grid(N, (u) => cw.tableAt(cw.analyzeBars(b).table, u))) < 0.01, id);
  }
});

test('WEB-212: Build up N sums only the first N harmonics and names the cut', () => {
  const m = h.stackModel(h.barHarmonics(cw.presetBars('square'), 440), { rows: 8, partialSumN: 5, highlightN: 5 });
  assert.deepEqual(m.active.map((x) => x.n), [1, 3, 5]);
  assert.equal(m.cut, true);
  assert.equal(m.truncated, false);
  assert.equal(m.shown.length, 8);
  assert.equal(h.sumLabels(m).note, 'first 5');
  assert.match(h.sumNote(m), /adds only the first 5 harmonics/);
  const table = cw.analyzeBars(cw.partialBars(cw.presetBars('square'), 5)).table;
  const N = 500;
  assert.ok(maxDiff(Array.from(h.sumSeries(m.active, N, { peak: m.peak })), grid(N, (u) => cw.tableAt(table, u))) < 0.01);
  const none = h.stackModel(h.barHarmonics(cw.presetBars('square'), 440), { rows: 8 });
  assert.equal(none.cut, false);
});

test('WEB-212: a row is one sine at its own height; an inverted bar starts downwards', () => {
  const sq = h.stackModel(h.shapeHarmonics('square', 440), { rows: 4 });
  const s1 = h.rowSeries(sq.shown[0], sq.scale, 1000);
  const s3 = h.rowSeries(sq.shown[1], sq.scale, 1000);
  assert.ok(near(Math.max(...s1), 1, 1e-4) && near(Math.max(...s3), 1 / 3, 1e-4));
  const tri = h.shapeHarmonics('triangle', 440)[1];
  assert.ok(h.rowSeries(tri, 1, 100)[5] < 0);
  assert.ok(h.rowSeries(sq.shown[1], sq.scale, 100, { phase: 0.25 })[0] !== 0);
});

test('WEB-212: the inharmonic partial n completes n x sqrt(1 + B n squared) cycles over the fundamental window', () => {
  assert.ok(near(h.partialCycles(10, 0.002), 10 * Math.sqrt(1.2)));
  assert.equal(h.partialCycles(5, 0), 5);
  const rows = hm.harmonicList({ freq: 220, count: 10, rolloff: -12, mute: false, decay: true, inharm: true, inharmB: 0.002, hammer: false, strings: 1 }, 48000);
  const list = h.synthHarmonics(rows, 220);
  assert.equal(list.length, 10);
  assert.ok(near(list[9].cycles, 10 * Math.sqrt(1.2), 1e-9));
  assert.ok(near(list[9].freqHz, 220 * 10 * Math.sqrt(1.2), 1e-6));
  assert.ok(list[9].cycles > 10 && list[9].cycles < 11);
  const flat = h.synthHarmonics(hm.harmonicList({ freq: 220, count: 10, rolloff: -12, mute: false, decay: false, strings: 1 }, 48000), 220);
  assert.ok(flat.every((x) => x.cycles === x.n));
});

test('WEB-212: the Chordophones rows follow the roll-off, Mute H1, the harmonic count and the strike position', () => {
  const base = { freq: 220, count: 10, rolloff: -12, mute: false, decay: false, strings: 1 };
  const flat = h.synthHarmonics(hm.harmonicList(base, 48000), 220);
  assert.ok(near(flat[1].amp, 10 ** (-12 / 20), 1e-9));
  assert.ok(near(flat[3].amp, 10 ** (-24 / 20), 1e-9));
  const muted = h.synthHarmonics(hm.harmonicList({ ...base, mute: true }, 48000), 220);
  assert.equal(muted[0].n, 2);
  assert.equal(muted.length, 9);
  assert.equal(h.synthHarmonics(hm.harmonicList({ ...base, count: 4 }, 48000), 220).length, 4);
  const hit = h.synthHarmonics(hm.harmonicList({ ...base, decay: true, hammer: true, strike: 1 / 4, inharm: false }, 48000), 220);
  assert.ok(near(hit[3].amp, hm.amplitude(4, -12) * hm.HAMMER_FLOOR, 1e-9));
  assert.ok(near(hit[1].amp, hm.amplitude(2, -12), 1e-9));
});

test('WEB-212: row labels show the real Hz and the percent, and shorten below 480 px', () => {
  const sq = h.shapeHarmonics('square', 440);
  assert.equal(h.rowLabel(sq[1]), 'H3 · 1320 Hz · 33 %');
  assert.equal(h.rowLabel(sq[1], true), 'H3 33 %');
  assert.equal(h.rowLabel(sq[0]), 'H1 · 440 Hz · 100 %');
  assert.equal(h.rowLabel(h.shapeHarmonics('triangle', 440)[1]), 'H3 · 1320 Hz · -11 %');
  assert.equal(h.fmtPct(1 / 225), '0.44');
  assert.equal(h.fmtPct(0.091), '9.1');
  assert.equal(h.fmtHz(2409.98), '2410');
  const m = h.stackModel(sq, { rows: 8 });
  assert.deepEqual(h.sumLabels(m), { title: 'Sum of 8', note: 'faint: all 16' });
  assert.deepEqual(h.sumLabels(m, true), { title: 'Sum of 8', note: 'all 16' });
  assert.deepEqual(h.sumLabels(h.stackModel(h.shapeHarmonics('sine', 440))), { title: 'Sum', note: '' });
  assert.match(h.sumNote(m), /the faint line is the sum of all 16 harmonics/);
  assert.equal(h.stackHeight(8, false), 12 + 240 + 68);
  assert.equal(h.stackHeight(8, true), 12 + 208 + 56);
  assert.deepEqual(h.tableRows(h.stackModel(sq, { rows: 4 }))[1], ['H3', '1320', '33', 'normal (0 degrees)']);
});

test('WEB-212: the card has the Rows 4, 8, 12 switch (8 by default), a hidden table with the harmonics and the caption', () => {
  const card = h.createStackCard({ raf: () => 0, caf() {}, now: () => 0, reducedMotion: () => false });
  card.update({ harmonics: h.shapeHarmonics('square', 440), freq: 440 });
  assert.equal(card.rows, 8);
  assert.equal(card.node.querySelectorAll('.hs-sr tbody tr').length, 8);
  assert.ok(card.node.textContent.includes(h.CAPTION));
  assert.equal(card.node.querySelectorAll('.seg-btn').map((b) => b.textContent).join(','), '4,8,12');
  card.setRows(12);
  assert.equal(card.node.querySelectorAll('.hs-sr tbody tr').length, 12);
  card.setRows(5);
  assert.equal(card.rows, 12);
  card.setRows(4);
  assert.equal(card.node.querySelectorAll('.hs-sr tbody tr').length, 4);
  assert.ok(card.canvas.getAttribute('aria-label').startsWith('Harmonics stack of 440 Hz: 4 sine wave rows'));
  assert.match(card.canvas.getAttribute('aria-describedby'), /^hs-.+-t$/);
  card.dispose();
});

test('WEB-212: Animate is off by default, runs one frame loop only, stops when switched off or disposed, and stays off for reduced motion', () => {
  let nextId = 1;
  const live = new Set();
  const env = { raf: () => { const id = nextId; nextId += 1; live.add(id); return id; }, caf: (id) => live.delete(id), now: () => 0, reducedMotion: () => false };
  const card = h.createStackCard(env);
  card.update({ harmonics: h.shapeHarmonics('square', 440), freq: 440 });
  assert.equal(card.animating, false);
  assert.equal(live.size, 0);
  card.setAnimate(true);
  assert.equal(card.animating, true);
  assert.equal(live.size, 1);
  card.setAnimate(true);
  assert.equal(live.size, 1);
  card.setAnimate(false);
  assert.equal(live.size, 0);
  card.setAnimate(true);
  card.dispose();
  assert.equal(live.size, 0);
  const calm = h.createStackCard({ ...env, reducedMotion: () => true });
  calm.update({ harmonics: h.shapeHarmonics('sine', 440), freq: 440 });
  calm.setAnimate(true);
  assert.equal(calm.animating, false);
  assert.equal(live.size, 0);
  calm.dispose();
});
