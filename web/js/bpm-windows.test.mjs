import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire } from './test-dom.mjs';

installDom();
const w = await import('./bpm-windows.js');

const res = (bpm, confidence = 0.9) => ({ bpm, confidence, beatsInWindow: 10 });
const colors = () => ({ ink: [0, 0, 0], muted: [90, 90, 90], line: [200, 200, 200], surface: [250, 250, 250], fill: [30, 150, 180], font: 'sans-serif' });

test('STU-041: the readouts are Last 1 s, 4 s, 8 s, 15 s, 30 s and 60 s', () => {
  assert.deepEqual(w.WINDOW_LABELS, ['Last 1 s', '4 s', '8 s', '15 s', '30 s', '60 s']);
  assert.deepEqual(w.LEGEND_LABELS, ['1 s', '4 s', '8 s', '15 s', '30 s', '60 s']);
  assert.equal(w.WINDOWS_CAPTION, 'Short windows react fast but are noisy; long windows are stable. If all agree the tempo is steady.');
  assert.equal(w.NO_DATA_TIP, 'Needs at least 4 beats in the window');
});

test('STU-041: a readout shows the BPM with the badge decimals rule, a dash without data, and the confidence in percent', () => {
  assert.equal(w.readoutText(res(120.04)), '120.0');
  assert.equal(w.readoutText(res(200)), '200.0');
  assert.equal(w.readoutText(res(250.4)), '250');
  assert.equal(w.readoutText(null), '-');
  assert.equal(w.confidencePercent(res(120, 0.964)), 96);
  assert.equal(w.confidencePercent(res(120, 1.7)), 100);
  assert.equal(w.confidencePercent(null), 0);
  assert.match(w.readoutLabel('4 s', null), /needs at least 4 beats in the window/);
  assert.match(w.readoutLabel('4 s', res(120, 0.9)), /^4 s: 120\.0 BPM, confidence 90 percent$/);
});

test('STU-041: a readout is highlighted only when it differs from the main BPM by more than 3 percent', () => {
  assert.equal(w.drifts(120, 123.5), false);
  assert.equal(w.drifts(120, 124), true);
  assert.equal(w.drifts(120, 116), true);
  assert.equal(w.drifts(null, 124), false);
  assert.equal(w.drifts(120, 0), false);
});

test('STU-041: the Y range pads the data by 10 percent, is linear up to a factor 1.5 and logarithmic above', () => {
  const list = [{ t: 0, v: [100, 120, null, null, null, null], c: [] }, { t: 1000, v: [null, 110, null, null, null, null], c: [] }];
  const visible = [true, true, true, true, true, true];
  const lin = w.plotRange(list, 1000, 120, visible);
  assert.equal(lin.log, false);
  assert.ok(Math.abs(lin.lo - 98) < 1e-9 && Math.abs(lin.hi - 122) < 1e-9);
  const wide = w.plotRange([{ t: 0, v: [60, 150, null, null, null, null], c: [] }], 0, 120, visible);
  assert.equal(wide.log, true);
  assert.ok(wide.lo < 60 && wide.hi > 150);
  assert.equal(w.plotRange(list, 1000, 120, [false, false, true, true, true, true]), null);
  assert.equal(w.plotRange(list, 1000, 120, [true, false, false, false, false, false]).hi > 100, true);
  assert.equal(w.plotRange([], 0, 120, visible), null);
  const flat = w.plotRange([{ t: 0, v: [120, null, null, null, null, null], c: [] }], 0, 120, visible);
  assert.ok(flat.lo < 120 && flat.hi > 120);
  assert.ok(Math.abs(w.yFraction(120, flat) - 0.5) < 1e-9);
});

test('STU-041: ticks are round numbers inside the range on both axes', () => {
  const lin = w.axisTicks({ lo: 98, hi: 122, log: false });
  assert.ok(lin.length >= 3 && lin.every((v) => v >= 98 && v <= 122));
  const log = w.axisTicks({ lo: 55, hi: 330, log: true });
  assert.deepEqual(log.filter((v) => [100, 200].includes(v)), [100, 200]);
  assert.ok(log.every((v) => v >= 55 && v <= 330));
  assert.equal(w.fmtAxis(120), '120');
  assert.equal(w.fmtAxis(2.5), '2.5');
});

test('STU-041: the time axis is the last 1, 2 or 5 minutes with "now" at the right', () => {
  assert.deepEqual(w.SPANS, [60, 120, 300]);
  assert.equal(w.DEFAULT_SPAN_S, 120);
  assert.deepEqual(w.timeTicks(120), [0, 30, 60, 90, 120]);
  assert.deepEqual(w.timeTicks(300), [0, 60, 120, 180, 240, 300]);
  assert.equal(w.timeTickText(0), 'now');
  assert.equal(w.timeTickText(30), '-30 s');
  assert.equal(w.timeTickText(90), '-1.5 min');
  assert.equal(w.agoText(0), 'now');
  assert.equal(w.agoText(12000), '12 s ago');
  assert.equal(w.agoText(95000), '1 min 35 s ago');
  const geo = w.graphGeo(400, 200);
  assert.equal(w.timeX(10000, 10000, 120, geo), geo.left + geo.plotW);
  assert.equal(w.timeX(10000 - 120000, 10000, 120, geo), geo.left);
});

test('STU-041: the history keeps at most five minutes and clears', () => {
  const h = w.createHistory();
  for (let s = 0; s <= 400; s += 1) h.push(s * 1000, [res(120), null, null, null, null, null]);
  assert.ok(h.list.length <= 302);
  assert.equal(h.list[h.list.length - 1].t, 400000);
  assert.equal(h.list[0].v[1], null);
  h.clear();
  assert.equal(h.list.length, 0);
});

test('STU-041: the hover picks the nearest sample, lists each visible window and says how long ago', () => {
  const list = [0, 1, 2, 3].map((s) => ({ t: s * 1000, v: [null, 120 + s, 121, null, null, null], c: [] }));
  const geo = w.graphGeo(400, 200);
  const visible = [true, true, false, true, true, true];
  const at = w.timeX(1000, 3000, 60, geo);
  const hover = w.graphHover(at + 1, list, 3000, 60, geo, visible);
  assert.equal(hover.title, '2 s ago');
  assert.deepEqual(hover.rows, [{ k: 1, text: '121.0' }]);
  assert.equal(hover.empty, false);
  assert.equal(w.graphHover(2, list, 3000, 60, geo, visible), null);
  const far = w.graphHover(geo.left + 5, list, 3000, 60, geo, visible);
  assert.equal(far.empty, true);
});

test('STU-041: the view shows six readouts, dashes with the tooltip when empty, and highlights drift', () => {
  const view = w.createBpmWindowsView({ uid: 't', colors });
  const items = view.node.querySelectorAll('.rh-win');
  assert.equal(items.length, 6);
  assert.deepEqual(items.map((i) => i.querySelector('.rh-win-label').textContent), w.WINDOW_LABELS);
  for (const i of items) {
    assert.equal(i.querySelector('.rh-win-val').textContent, '-');
    assert.equal(i.getAttribute('title'), 'Needs at least 4 beats in the window');
    assert.match(i.getAttribute('aria-label'), /needs at least 4 beats in the window/);
  }
  view.update(1000, 120, [null, res(120.2, 0.9), res(120), res(121), res(150, 0.5), null]);
  const vals = view.node.querySelectorAll('.rh-win-val').map((n) => n.textContent);
  assert.deepEqual(vals, ['-', '120.2', '120.0', '121.0', '150.0', '-']);
  assert.deepEqual(items.map((i) => i.classList.contains('is-drift')), [false, false, false, false, true, false]);
  assert.equal(items[4].querySelector('.rh-bar i').style.width, '50%');
  assert.equal(items[0].querySelector('.rh-bar i').style.width, '0%');
  assert.equal(view.history.list.length, 1);
  assert.equal(view.node.querySelector('.rh-cap').textContent, w.WINDOWS_CAPTION);
  view.reset();
  assert.equal(view.history.list.length, 0);
  assert.equal(view.node.querySelectorAll('.is-drift').length, 0);
});

test('STU-041: the legend has six toggles and the time span switch defaults to 2 min', () => {
  const view = w.createBpmWindowsView({ uid: 't', colors });
  const legend = view.node.querySelectorAll('.rh-leg');
  assert.equal(legend.length, 6);
  assert.deepEqual(legend.map((b) => b.getAttribute('aria-pressed')), ['true', 'true', 'true', 'true', 'true', 'true']);
  fire(legend[2], 'click');
  assert.equal(legend[2].getAttribute('aria-pressed'), 'false');
  fire(legend[2], 'click');
  assert.equal(legend[2].getAttribute('aria-pressed'), 'true');
  assert.equal(view.span, 120);
  const seg = view.node.querySelectorAll('.seg-btn');
  assert.deepEqual(seg.map((b) => b.textContent), ['1 min', '2 min', '5 min']);
  fire(seg[2], 'click');
  assert.equal(view.span, 300);
});
