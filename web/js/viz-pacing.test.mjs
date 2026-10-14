import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrameMeter, makePaceGovernor, PACE_UP_S, PACE_BAN_S, PACE_TOP } from './viz-pacing.js';

function drive(seconds, intervalAt, state) {
  const end = state.t + seconds * 1000;
  const changes = [];
  while (state.t < end) {
    state.t += intervalAt(state.t);
    state.meter.tick(state.t);
    const c = state.gov.update(state.t, state.meter.ema, state.meter.refresh, state.meter.valid);
    if (c) { changes.push([Math.round(state.t), c, state.gov.cap]); state.meter.hold(); }
  }
  return changes;
}

const fresh = () => ({ t: 1000, meter: makeFrameMeter(), gov: makePaceGovernor() });

test('the meter averages intervals, snaps the refresh to 60 or 120 Hz and ignores hidden gaps', () => {
  const m = makeFrameMeter();
  let t = 0;
  for (let i = 0; i < 120; i += 1) { t += 16.7; m.tick(t); }
  assert.ok(Math.abs(m.ema - 16.7) < 0.1);
  assert.ok(Math.abs(m.refresh - 1000 / 60) < 1e-6);
  assert.ok(Math.abs(m.fps - 60) < 1);
  const before = m.ema;
  t += 8000;
  m.tick(t);
  for (let i = 0; i < 12; i += 1) { t += 90; m.tick(t); }
  assert.equal(m.ema, before);
  t += 16.7;
  m.tick(t);
  assert.ok(Math.abs(m.ema - before) < 0.5);
  const hz = makeFrameMeter();
  t = 0;
  for (let i = 0; i < 200; i += 1) { t += 8.33; hz.tick(t); }
  assert.ok(Math.abs(hz.refresh - 1000 / 120) < 1e-6);
});

test('hold() ignores the frames after a mode switch', () => {
  const m = makeFrameMeter();
  let t = 0;
  for (let i = 0; i < 60; i += 1) { t += 16.7; m.tick(t); }
  m.hold(5);
  assert.equal(m.valid, false);
  for (let i = 0; i < 5; i += 1) { t += 200 - 100; m.tick(t); }
  assert.ok(m.ema < 18);
});

test('sustained slow frames step the level down 2 -> 1 -> 0 and never below 0', () => {
  const s = fresh();
  const ch = drive(20, () => 33, s);
  assert.deepEqual(ch.map((c) => c[2]), [1, 0]);
  assert.ok(ch[1][0] - ch[0][0] >= 3000);
  assert.equal(s.gov.cap, 0);
  assert.equal(s.gov.level, 0);
  assert.equal(s.gov.lite, true);
});

test('a healthy 60 Hz machine climbs to the hi-dpr step after 5 s of headroom and stays', () => {
  const s = fresh();
  const ch = drive(30, () => 16.7, s);
  assert.deepEqual(ch.map((c) => c[2]), [PACE_TOP]);
  assert.ok(ch[0][0] - 1000 >= PACE_UP_S * 1000);
  assert.equal(s.gov.hiDpr, true);
  assert.equal(s.gov.lite, false);
});

test('hysteresis: after a failed step up the level is banned and the cap does not oscillate', () => {
  const s = fresh();
  const intervals = (t) => (s.gov.cap >= 3 ? 30 : 16.7);
  const ch = drive(120, intervals, s);
  const ups = ch.filter((c) => c[1] > 0).length;
  const downs = ch.filter((c) => c[1] < 0).length;
  assert.ok(ups >= 1 && downs >= 1);
  const gaps = [];
  for (let i = 1; i < ch.length; i += 1) if (ch[i][1] > 0) gaps.push(ch[i][0] - ch[i - 1][0]);
  assert.ok(ch.length <= 6, JSON.stringify(ch));
  const stepUps = ch.filter((c) => c[1] > 0).map((c) => c[0]);
  for (let i = 1; i < stepUps.length; i += 1) assert.ok(stepUps[i] - stepUps[i - 1] >= PACE_BAN_S * 1000);
});

test('refresh 120 Hz: a 12 ms average counts as slow, 8.5 ms as fine', () => {
  const s = fresh();
  drive(10, () => 8.3, s);
  assert.ok(Math.abs(s.meter.refresh - 1000 / 120) < 1e-6);
  const slow = drive(12, () => 12.5, s);
  assert.ok(slow.some((c) => c[1] < 0));
});

test('invalid or hidden data never moves the level', () => {
  const g = makePaceGovernor();
  for (let t = 0; t < 20000; t += 100) g.update(t, 50, 16.7, false);
  assert.equal(g.cap, 2);
  assert.equal(g.lite, false);
});
