import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFrameMeter, makePaceGovernor, PACE_UP_S, PACE_BAN_S, PACE_TOP, targetIntervalMs, watchLowPower, TERRAIN_TARGET_FPS, PACE_GRACE_S, PACE_BAN_MAX_S,
} from './viz-pacing.js';
import { makePacer } from './viz-spectrum.js';

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

test('sustained slow frames step the level down 2 -> 1 -> 0, then to half rate, and never below', () => {
  const s = fresh();
  const ch = drive(20, () => 33, s);
  assert.deepEqual(ch.map((c) => c[2]), [1, 0, 0]);
  assert.equal(s.gov.half, true);
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

test('terrain target is the display refresh capped at 60 fps; other modes, low power, reduced motion and half rate give 30', () => {
  assert.equal(TERRAIN_TARGET_FPS, 60);
  const ms = (o) => Math.round(targetIntervalMs(o) * 10) / 10;
  assert.equal(ms({ terrain: true, refreshMs: 1000 / 60 }), 16.7);
  assert.equal(ms({ terrain: true, refreshMs: 1000 / 120 }), 16.7);
  assert.equal(ms({ terrain: true, refreshMs: 1000 / 60, half: true }), 33.3);
  assert.equal(ms({ terrain: true, lowPower: true }), 33.3);
  assert.equal(ms({ terrain: true, reduced: true }), 33.3);
  assert.equal(ms({ terrain: false, refreshMs: 1000 / 60 }), 33.3);
});

test('low power follows getBattery: discharging under 20 percent only', async () => {
  const batt = { charging: false, level: 0.1, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } };
  const st = watchLowPower({ getBattery: () => Promise.resolve(batt) });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(st.low, true);
  batt.charging = true;
  batt.listeners.chargingchange();
  assert.equal(st.low, false);
  assert.equal(watchLowPower({}).low, false);
  assert.equal(watchLowPower({ getBattery: () => { throw new Error('x'); } }).low, false);
});

test('the governor judges against the new 60 fps target: 20 ms average is slow, 17 ms is fine', () => {
  const g = makePaceGovernor();
  let t = 0;
  const T = 1000 / 60;
  let down = 0;
  for (; t < 4000; t += 16) down += g.update(t, 17, T, true) < 0 ? 1 : 0;
  assert.equal(down, 0);
  for (; t < 9000; t += 16) down += g.update(t, 21, T, true) < 0 ? 1 : 0;
  assert.ok(down >= 1);
  assert.equal(g.lite, true);
});

test('half rate: falls to 30 only after level 0 + lite fail, judged against 33 ms, banned for 30 s and then retried with a doubled ban', () => {
  const g = makePaceGovernor();
  const log = [];
  let t = 0;
  let target = 1000 / 60;
  const run = (secs, dtMs) => {
    const end = t + secs * 1000;
    while (t < end) {
      t += 16;
      const c = g.update(t, dtMs(), target, true);
      if (c) log.push([t, c, g.rung]);
      target = 1000 / (g.half ? 30 : 60);
    }
  };
  run(20, () => (g.half ? 33.3 : 40));
  assert.deepEqual(log.map((l) => l[2]), [1, 0, -1]);
  assert.equal(g.half, true);
  assert.equal(g.cap, 0);
  const downAt = log[2][0];
  run(60, () => (g.half ? 33.3 : 40));
  const ups = log.filter((l) => l[1] > 0);
  assert.ok(ups.length >= 1 && ups[0][0] - downAt >= 30000, JSON.stringify(log));
  run(400, () => (g.half ? 33.3 : 40));
  const halfDowns = log.filter((l) => l[1] < 0 && l[2] === -1).map((l) => l[0]);
  for (let i = 1; i < halfDowns.length; i += 1) assert.ok(halfDowns[i] - halfDowns[i - 1] >= 30000);
  const gaps = halfDowns.slice(1).map((v, i) => v - halfDowns[i]);
  assert.ok(gaps.length < 2 || Math.max(...gaps) > gaps[0], `gaps ${gaps}`);
  assert.ok(Math.max(...gaps) <= 130000, `gaps ${gaps}`);
});

test('pacer: set() changes the rate, the slack keeps 60 fps on 60 Hz and 120 Hz', () => {
  const p = makePacer(30);
  p.set(60);
  let drawn = 0;
  for (let t = 0; t < 1000; t += 1000 / 60) if (p.due(t, 7.5)) drawn += 1;
  assert.ok(drawn >= 58, `60Hz ${drawn}`);
  p.reset();
  drawn = 0;
  for (let t = 0; t < 1000; t += 1000 / 120) if (p.due(t, 3.75)) drawn += 1;
  assert.ok(drawn >= 58 && drawn <= 62, `120Hz ${drawn}`);
});

import { makeTimeFollower } from './viz-timeline.js';
import { smoothBars, makePulse } from './viz-spectrum.js';
import { easeEnergy } from './viz-terrain-math.js';

function sampleAt(fps, secs, step, at) {
  const out = [];
  const n = Math.round(secs * fps);
  let next = 0;
  for (let i = 1; i <= n; i += 1) {
    const t = i / fps;
    step(t, 1 / fps);
    if (t + 1e-9 >= at[next]) { out.push(step.read()); next += 1; }
  }
  return out;
}

function trajectories(make, at, secs = 2) {
  return [30, 60, 120].map((fps) => sampleAt(fps, secs, make(), at));
}

test('frame-rate independence: the time follower, bar smoothing, pulse and energy follower give the same trajectory at 30, 60 and 120 fps', () => {
  const at = [0.2, 0.5, 1, 1.5, 2];
  const close = (runs, eps, times = at) => {
    for (let k = 0; k < times.length; k += 1) {
      const vs = runs.map((r) => r[k]);
      assert.ok(Math.max(...vs) - Math.min(...vs) < eps, `t=${times[k]}: ${vs}`);
    }
  };
  const follower = () => {
    const f = makeTimeFollower();
    let v = 0;
    const step = (t) => { v = f.update(10 + t * 0.97 + 0.04 * Math.sin(t * 7), t * 1000, true); };
    f.update(10, 0, true);
    step.read = () => v;
    return step;
  };
  close(trajectories(follower, at), 0.01);
  const bars = () => {
    const state = new Float32Array(1);
    const step = (t, dt) => { smoothBars(state, [0.5 + 0.5 * Math.sin(t * 6)], 0.6, 0.15, dt * 60); };
    step.read = () => state[0];
    return step;
  };
  close(trajectories(bars, at), 0.05);
  const settle = () => {
    const state = new Float32Array(1);
    const step = (t, dt) => { smoothBars(state, [0.8], 0.6, 0.15, dt * 60); };
    step.read = () => state[0];
    return step;
  };
  const early = [1 / 30, 0.1, 0.2, 0.5];
  close(trajectories(settle, early, 0.5), 0.06, early);
  const pulse = () => {
    const p = makePulse();
    const step = (t, dt) => { p.step(0.5 + 0.4 * Math.sin(t * 5), dt); };
    step.read = () => p.value;
    return step;
  };
  close(trajectories(pulse, at), 0.05);
  const energy = () => {
    let e = 0;
    const step = (t, dt) => { e = easeEnergy(e, 0.5 + 0.4 * Math.sin(t * 5), dt); };
    step.read = () => e;
    return step;
  };
  close(trajectories(energy, at), 0.03);
});

test('grace: a startup hitch does not downgrade, a sustained slow stretch after the grace does', () => {
  const g = makePaceGovernor();
  g.grace(8000);
  let t = 1000;
  const log = [];
  while (t < 1000 + 7900) { t += 33; if (g.update(t, 40, 1000 / 60, true)) log.push(t); }
  assert.equal(log.length, 0);
  assert.equal(g.cap, 2);
  while (t < 1000 + 20000) { t += 33; if (g.update(t, 40, 1000 / 60, true)) log.push(t); }
  assert.ok(log.length >= 1 && log[0] >= 1000 + PACE_GRACE_S * 1000);
});

test('grace can be re-armed by events and restarts the slow timer', () => {
  const g = makePaceGovernor();
  let t = 0;
  let downs = 0;
  for (let i = 0; i < 300; i += 1) {
    t += 16;
    if (i % 100 === 0) g.grace(3000);
    if (g.update(t, 40, 1000 / 60, true)) downs += 1;
  }
  assert.equal(downs, 0);
});

test('recovery from half rate: bans stay under 120 s and reset after 60 s without a downgrade', () => {
  const g = makePaceGovernor();
  let t = 0;
  const step = (secs, dt, target) => { const end = t + secs * 1000; const ch = []; while (t < end) { t += 16; const c = g.update(t, dt, target, true); if (c) ch.push([t, c, g.rung]); } return ch; };
  step(20, 40, 1000 / 60);
  assert.equal(g.half, true);
  for (let i = 0; i < 6; i += 1) {
    for (let k = 0; k < 40 && g.half; k += 1) step(10, 33.3, 1000 / 30);
    assert.equal(g.half, false, 'recovers from half rate');
    step(15, 40, 1000 / 60);
    assert.equal(g.half, true);
  }
  assert.ok(g.info(t).banLeft <= PACE_BAN_MAX_S);
  step(120, 33.3, 1000 / 30);
  assert.equal(g.half, false);
  step(70, 33.3, 1000 / 30);
  const ch = step(30, 40, 1000 / 60);
  assert.ok(ch.length === 0 || g.info(t).banLeft <= 31, `ban ${g.info(t).banLeft}`);
});

test('info() reports the last downgrade reason, its age and the ban', () => {
  const g = makePaceGovernor();
  let t = 0;
  while (t < 20000) { t += 16; g.update(t, 26.1, 1000 / 60, true); }
  const i = g.info(t);
  assert.equal(i.note.dir, -1);
  assert.match(i.note.text, /interval 26\.1 ms > 20\.0 ms for \d\.\d s/);
  assert.ok(i.ago >= 0 && i.banLeft > 0);
});

test('meter restart() drops the average and skips the next frames', () => {
  const m = makeFrameMeter();
  let t = 0;
  for (let i = 0; i < 40; i += 1) { t += 120; m.tick(t); }
  m.restart();
  assert.equal(m.ema, 0);
  assert.equal(m.valid, false);
  for (let i = 0; i < 60; i += 1) { t += 16.7; m.tick(t); }
  assert.ok(Math.abs(m.ema - 16.7) < 0.5);
});

test('meter compares like with like at the half-rate pacer: 30 drawn fps on a 60 Hz display is on target, not slow', () => {
  const pacer = makePacer(30);
  const m = makeFrameMeter();
  const g = makePaceGovernor();
  let t = 0;
  let downs = 0;
  for (let i = 0; i < 1500; i += 1) {
    t += 16.7;
    if (pacer.due(t, Math.min(4, 16.7 * 0.45))) { m.tick(t); if (g.update(t, m.ema, targetIntervalMs({ terrain: true, half: true }), m.valid) < 0) downs += 1; }
  }
  assert.ok(Math.abs(m.fps - 30) < 1, `fps ${m.fps}`);
  assert.equal(downs, 0);
});
