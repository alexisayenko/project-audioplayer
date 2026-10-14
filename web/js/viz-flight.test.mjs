import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const F = await import('./viz-flight.js');
const { isVizFlightKey } = await import('./viz-fullscreen.js');
const { CAM_LIMITS } = await import('./viz-terrain-math.js');

const BASE = { eye: 3.31, pitch: -13.5, yaw: 0 };

function run(fl, fps, seconds, base = BASE, playing = () => true, aspect = 16 / 9) {
  const out = [];
  const dt = 1000 / fps;
  for (let i = 0; i <= seconds * fps; i += 1) {
    fl.tick(i * dt, playing(i * dt));
    out.push({ t: i * dt / 1000, ...fl.offsets(base, aspect) });
  }
  return out;
}

const at = (rows, sec) => rows.reduce((a, r) => (Math.abs(r.t - sec) < Math.abs(a.t - sec) ? r : a));

test('offsets stay inside the eye limits and the yaw coverage', () => {
  for (const base of [BASE, { eye: 0.3, pitch: 0, yaw: 0 }, { eye: 9.8, pitch: 0, yaw: 0 }, { eye: 3, pitch: 0, yaw: 15 }, { eye: 3, pitch: 0, yaw: -30 }]) {
    const fl = F.createFlight({ seed: 7 });
    fl.setOn(true);
    for (const r of run(fl, 30, 600, base)) {
      const eye = base.eye + r.eye;
      assert.ok(eye >= CAM_LIMITS.eye[0] - 1e-9 && eye <= CAM_LIMITS.eye[1] + 1e-9, `eye ${eye}`);
      assert.ok(Math.abs(r.eye) <= F.FLIGHT_EYE_AMP_REL * base.eye + 1e-9);
      assert.ok(Math.abs(r.yaw) <= F.FLIGHT_YAW_AMP_DEG + 1e-9);
      assert.ok(Math.abs(base.yaw + r.yaw) <= Math.max(Math.abs(base.yaw), F.yawCoverDeg()) + 1e-9, `yaw ${base.yaw + r.yaw}`);
    }
  }
});

test('yaw amplitude scales down with view width but never below the floor', () => {
  assert.equal(F.FLIGHT_YAW_MIN_DEG, 8);
  for (const asp of [1.78, 2.4, 3.3, 4.0]) {
    for (const base of [0, -5.2, 5.2, 20, -40]) {
      const plan = F.flightYawPlan(base, asp);
      assert.ok(plan.amp >= 8 && plan.amp <= 16, `${asp} ${base} ${plan.amp}`);
      assert.ok(Math.abs(base + plan.shift) + plan.amp <= Math.max(F.yawCoverDeg(asp), Math.abs(base)) + 1e-9 || Math.abs(base + plan.shift) < 1e-9);
    }
    assert.ok(F.flightYawAmp(0, asp) >= 14, `${asp}`);
    assert.ok(F.flightYawAmp(-5.2, asp) >= 10, `${asp}`);
  }
  assert.equal(F.flightYawAmp(0), F.FLIGHT_YAW_AMP_DEG);
  assert.equal(F.flightYawPlan(0, 4).shift, 0);
});

test('base yaw near the limit shifts the centre toward 0 smoothly', () => {
  let prev = F.flightYawPlan(0, 4);
  for (let b = 0; b >= -45; b -= 0.5) {
    const p = F.flightYawPlan(b, 4);
    assert.ok(p.shift >= 0 && Math.abs(p.shift - prev.shift) < 0.8 && Math.abs(p.amp - prev.amp) < 0.8);
    prev = p;
  }
  assert.ok(F.flightYawPlan(-30, 4).shift > 0);
});

test('yaw coverage shrinks monotonically with aspect and grows with narrower views', () => {
  let prev = Infinity;
  for (const a of [1, 1.5, 1.78, 2.4, 3.3, 4, 4.2]) {
    const c = F.yawCoverDeg(a);
    assert.ok(c <= prev);
    prev = c;
  }
  assert.ok(F.yawCoverDeg(4.0) >= 14);
  assert.ok(F.yawCoverDeg(1) > F.yawCoverDeg(16 / 9));
});

test('yaw offset swings at least +-8 deg over 60 s at wide aspects', () => {
  for (const asp of [1.78, 2.4, 3.3, 4.0]) {
    for (const yaw of [0, -5.2]) {
      let lo = 0;
      let hi = 0;
      for (const seed of [1, 2, 3]) {
        const fl = F.createFlight({ seed });
        fl.setOn(true);
        let t = 0;
        for (let i = 0; i < 4000; i += 1) {
          t += 16;
          fl.tick(t, true);
          const y = fl.offsets({ eye: 3.7, yaw }, asp).yaw;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
      assert.ok(hi - lo >= 16 * 0.8 || hi - lo >= 8, `${asp} ${yaw} ${lo} ${hi}`);
      assert.ok(Math.max(-lo, hi) >= 8, `${asp} ${yaw} ${lo} ${hi}`);
    }
  }
});

test('the drift uses the whole amplitude over time', () => {
  const fl = F.createFlight({ seed: 3 });
  fl.setOn(true);
  const rows = run(fl, 10, 1800);
  assert.ok(Math.max(...rows.map((r) => r.eye)) > 0.5 * F.FLIGHT_EYE_AMP_REL * BASE.eye);
  assert.ok(Math.min(...rows.map((r) => r.eye)) < -0.5 * F.FLIGHT_EYE_AMP_REL * BASE.eye);
  assert.ok(Math.max(...rows.map((r) => r.yaw)) > 7);
  assert.ok(Math.min(...rows.map((r) => r.yaw)) < -7);
});

test('motion is continuous and slow at 60 fps', () => {
  const fl = F.createFlight({ seed: 11 });
  fl.setOn(true);
  const rows = run(fl, 60, 200);
  let maxEye = 0;
  let maxYaw = 0;
  for (let i = 60 * 4; i < rows.length; i += 1) {
    maxEye = Math.max(maxEye, Math.abs(rows[i].eye - rows[i - 1].eye));
    maxYaw = Math.max(maxYaw, Math.abs(rows[i].yaw - rows[i - 1].yaw));
  }
  assert.ok(maxEye < 0.012, `eye step ${maxEye}`);
  assert.ok(maxYaw < 0.18, `yaw step ${maxYaw}`);
});

test('same trajectory at 30, 60 and 120 fps', () => {
  const traj = (fps) => { const fl = F.createFlight({ seed: 5 }); fl.setOn(true); return run(fl, fps, 40); };
  const a = traj(30);
  for (const fps of [60, 120]) {
    const b = traj(fps);
    for (const sec of [5, 10, 20, 30, 40]) {
      const x = at(a, sec);
      const y = at(b, sec);
      assert.ok(Math.abs(x.eye - y.eye) < 1e-6 && Math.abs(x.yaw - y.yaw) < 1e-6 && Math.abs(x.pitch - y.pitch) < 1e-6, `${fps} fps at ${sec}s`);
    }
  }
});

test('ease-in over 3 s from zero and ease-out over 2 s to zero, no snap', () => {
  const fl = F.createFlight({ seed: 9 });
  assert.deepEqual(fl.offsets(BASE), { eye: 0, yaw: 0, pitch: 0 });
  fl.setOn(true);
  fl.tick(0, true);
  assert.equal(fl.amount(), 0);
  const rows = [];
  for (let i = 1; i <= 60 * 5; i += 1) { fl.tick((i * 1000) / 60, true); rows.push(fl.amount()); }
  assert.ok(rows[0] < 0.01);
  assert.ok(Math.abs(rows[89] - 0.5) < 0.02);
  assert.ok(rows[178] < 1 && rows[178] > 0.99);
  assert.equal(rows[200], 1);
  fl.setOn(false);
  const after = [];
  const t0 = 5000;
  for (let i = 1; i <= 60 * 3; i += 1) { fl.tick(t0 + (i * 1000) / 60, true); after.push(fl.amount()); }
  assert.ok(after[0] > 0.99);
  assert.ok(after[59] > 0.4 && after[59] < 0.6);
  assert.equal(after[130], 0);
  assert.equal(fl.active(), false);
  assert.deepEqual(fl.offsets(BASE), { eye: 0, yaw: 0, pitch: 0 });
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i] >= rows[i - 1]);
  for (let i = 1; i < after.length; i += 1) assert.ok(after[i] <= after[i - 1]);
});

test('time advances only while playing', () => {
  const fl = F.createFlight({ seed: 2 });
  fl.setOn(true);
  const rows = run(fl, 30, 20, BASE, (ms) => ms < 10000);
  const a = at(rows, 10);
  const b = at(rows, 20);
  assert.ok(Math.abs(a.eye - b.eye) < 1e-9 && Math.abs(a.yaw - b.yaw) < 1e-9);
  assert.ok(Math.abs(fl.time() - 10) < 0.1);
});

test('deterministic for a seed, different between seeds', () => {
  const t = (seed) => { const fl = F.createFlight({ seed }); fl.setOn(true); return at(run(fl, 30, 60), 60); };
  assert.deepEqual(t(4), t(4));
  assert.notEqual(t(4).yaw, t(5).yaw);
});

test('a long frame gap is clamped, a clock going backwards adds nothing', () => {
  const fl = F.createFlight({ seed: 1 });
  fl.setOn(true);
  fl.tick(0, true);
  fl.tick(60000, true);
  assert.ok(fl.time() <= F.FLIGHT_MAX_DT_S + 1e-9);
  fl.tick(10, true);
  assert.ok(fl.time() <= F.FLIGHT_MAX_DT_S + 1e-9);
});

test('pitch couples to the eye offset: rising looks down a little', () => {
  const fl = F.createFlight({ seed: 6 });
  fl.setOn(true);
  for (const r of run(fl, 30, 300)) {
    assert.ok(Math.abs(r.pitch) <= F.FLIGHT_PITCH_COUPLING_DEG + 1e-9);
    if (Math.abs(r.eye) > 0.05) assert.ok(r.eye * r.pitch < 0);
  }
});

test('the tier yaw range is static while flying, zero when idle', () => {
  const fl = F.createFlight({ seed: 1 });
  assert.equal(fl.yawRange(0), 0);
  fl.setOn(true);
  assert.equal(fl.yawRange(0), F.FLIGHT_YAW_AMP_DEG);
  fl.tick(0, true);
  fl.tick(50, true);
  assert.equal(fl.yawRange(0), F.FLIGHT_YAW_AMP_DEG);
  fl.setOn(false);
  assert.equal(fl.yawRange(0), F.FLIGHT_YAW_AMP_DEG);
  for (let i = 1; i <= 100; i += 1) fl.tick(50 + i * 50, true);
  assert.equal(fl.yawRange(0), 0);
});

test('toggle persists as 0 or 1, defaults off, junk is off', () => {
  F.resetFlightForTests();
  assert.equal(F.flightOn(), false);
  assert.equal(F.setFlightOn(true), true);
  assert.equal(localStorage.getItem(F.FLIGHT_KEY), '1');
  assert.equal(F.flight.isOn(), true);
  F.setFlightOn(false);
  assert.equal(localStorage.getItem(F.FLIGHT_KEY), '0');
  assert.equal(F.parseFlight('1'), true);
  for (const v of [null, '', 'true', '2', 'yes']) assert.equal(F.parseFlight(v), false);
  F.resetFlightForTests();
  localStorage.setItem(F.FLIGHT_KEY, 'junk');
  assert.equal(F.flightOn(), false);
  F.resetFlightForTests();
  localStorage.setItem(F.FLIGHT_KEY, '1');
  assert.equal(F.flightOn(), true);
});

test('reduced motion forces flight off even when stored on, and notifies', () => {
  F.resetFlightForTests();
  F.setFlightOn(true);
  const seen = [];
  const off = F.onFlight((v) => seen.push(v));
  F.setReducedForTests(true);
  assert.equal(F.flightOn(), false);
  assert.equal(F.flight.isOn(), false);
  assert.equal(F.setFlightOn(true), false);
  assert.deepEqual(seen, [false, false]);
  F.setReducedForTests(false);
  assert.equal(F.flightOn(), true);
  off();
  F.resetFlightForTests();
});

test('F key follows the T rules and only applies in Terrain', () => {
  const ev = (key, extra = {}) => ({ key, target: { closest: () => null }, ...extra });
  const ctx = { open: true, route: 'library', background: false, mode: 'terrain' };
  assert.equal(isVizFlightKey(ev('f'), ctx), true);
  assert.equal(isVizFlightKey(ev('F'), ctx), true);
  assert.equal(isVizFlightKey(ev('f'), { ...ctx, mode: 'bars' }), false);
  assert.equal(isVizFlightKey(ev('f'), { ...ctx, open: false }), false);
  assert.equal(isVizFlightKey(ev('f'), { ...ctx, open: false, route: 'playback', background: true }), true);
  assert.equal(isVizFlightKey(ev('f', { metaKey: true }), ctx), false);
  assert.equal(isVizFlightKey(ev('f', { repeat: true }), ctx), false);
  assert.equal(isVizFlightKey({ key: 'f', target: { closest: () => ({}) } }, ctx), false);
  assert.equal(isVizFlightKey(ev('t'), ctx), false);
});
