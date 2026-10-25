import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const c = await import('./cone-animation.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function clock(extra = {}) {
  const frames = new Map();
  let id = 0;
  let t = 0;
  const doc = { hidden: false, handlers: {}, addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }, removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter((x) => x !== fn); } };
  const env = { document: doc, raf: (fn) => { id += 1; frames.set(id, fn); return id; }, caf: (n) => frames.delete(n), now: () => t, ...extra };
  const step = (ms) => {
    t += ms;
    const run = [...frames.values()];
    frames.clear();
    for (const fn of run) fn();
  };
  return { env, frames, step, doc };
}

test('STU-043: the phase of the slowed cone accumulates f/1000 cycles per second and stays continuous', () => {
  assert.ok(near(c.advancePhase(0, 440, 1000), 0.44));
  assert.ok(near(c.advancePhase(0.9, 440, 1000), 0.34, 1e-9));
  const a = c.advancePhase(c.advancePhase(0.1, 440, 500), 220, 500);
  assert.ok(near(a, 0.1 + 0.22 + 0.11, 1e-9));
  assert.equal(c.advancePhase(0.3, 440, -5), 0.3);
});

test('STU-043: the slow motion factor is 250, 500, 1000, 2000, 5000 or 10000, defaults to 2000 and divides the phase rate', () => {
  assert.deepEqual(c.SLOW_CHOICES, [250, 500, 1000, 2000, 5000, 10000]);
  assert.equal(c.SLOW_DEFAULT, 2000);
  assert.ok(near(c.advancePhase(0, 440, 1000, 250), 0.76));
  assert.equal(c.slowReadout(440, 250), 'Slowed 250×: real 440 Hz = 1.76 swings per second (one swing every 0.568 s); the real cone makes 440 swings each second.');
  assert.ok(c.slowReadout(2000, 250).endsWith('Too fast to follow at this frequency.'));
  assert.ok(near(c.advancePhase(0, 440, 1000, 2000), 0.22));
  assert.ok(near(c.advancePhase(0, 440, 1000, 10000), 0.044));
  assert.equal(c.slowReadout(440, 2000), 'Slowed 2000×: real 440 Hz = 0.22 swings per second (one swing every 4.55 s); the real cone makes 440 swings each second.');
  assert.match(c.coneNote(5000), /runs 5000 times slower/);
  const geo = c.airGeometry(124, 1124);
  assert.ok(c.airSpeedPx(geo, 440, 1000) > 250);
  assert.ok(c.airSpeedPx(geo, 440, c.SLOW_DEFAULT) <= 250);
});

test('STU-043: the readout states the slowed rate and warns above 5 swings per second', () => {
  assert.equal(c.slowReadout(440), 'Slowed 1000×: real 440 Hz = 0.44 swings per second (one swing every 2.27 s); the real cone makes 440 swings each second.');
  assert.ok(c.slowReadout(20000).endsWith('Too fast to follow at this frequency.'));
  assert.ok(!c.slowReadout(5000).includes('Too fast'));
  assert.ok(c.slowReadout(5001).includes('Too fast'));
  assert.match(c.slowReadout(1000), /= 1 swing per second \(one swing every 1 s\)/);
});

test('STU-043: the cone is a quarter cycle behind the pressure: mid-swing at the pressure peak, at an extreme at zero pressure', () => {
  assert.ok(near(c.coneOffset(0.25, 0.8), 0, 1e-12));
  assert.ok(near(c.coneOffset(0, 0.8), -1));
  assert.ok(near(c.coneOffset(0.5, 0.8), 1));
  assert.ok(near(c.coneOffset(0.5, 0.3), 0.375));
  assert.ok(near(c.coneOffset(0.75, 0.3), 0, 1e-12));
  assert.ok(near(c.pressureAt(0.25, 0, 200), 1));
  assert.ok(near(c.pressureAt(0.25, 50, 200), 0, 1e-12));
  const dt = 1e-6;
  for (const phase of [0.1, 0.25, 0.4, 0.5, 0.8]) {
    const velocity = (c.coneOffset(phase + dt, 0.8) - c.coneOffset(phase - dt, 0.8)) / (2 * dt);
    assert.ok(near(velocity / (2 * Math.PI), Math.sin(2 * Math.PI * phase), 1e-6));
  }
});

test('STU-043: the air density at distance x is the pressure at time t - x/c, mirrored in time across the area', () => {
  const geo = c.airGeometry(122, 367);
  for (const phase of [0, 0.1, 0.25, 0.6, 0.75]) {
    for (const u of [0, 0.2, 0.5, 0.85]) {
      const scope = Math.sin(2 * Math.PI * (phase - u));
      assert.ok(near(c.airDensity(phase, 0.8, geo, u * geo.wavelength) - 1, c.airK(0.8) * scope, 1e-12));
      assert.ok(near(c.airCurve(phase, 0.3, u) * 0.8, 0.3 * scope, 1e-12));
    }
  }
  assert.ok(near(c.airCurve(0.25, 0.8, 0), 1));
  assert.ok(near(c.airCurve(0.75, 0.8, 0), -1));
  assert.ok(c.airDensity(0.25, 0.8, geo, 0) > c.airDensity(0.25, 0.8, geo, 0.5 * geo.wavelength));
  assert.ok(c.airSpacing(0.25, 0.8, geo, 0) < 1 && c.airSpacing(0.75, 0.8, geo, 0) > 1);
  assert.ok(c.airSpacing(0.25, 0.8, geo, 0) < c.airSpacing(0, 0.8, geo, 0));
});

test('STU-043: the dot displacement field gives density 1 - ds/dx and the dots never cross', () => {
  const geo = c.airGeometry(122, 367);
  const h = 1e-4;
  for (const phase of [0, 0.3, 0.7]) {
    for (const u of [0.1, 0.4, 0.9]) {
      const x = u * geo.wavelength;
      const dsdx = (c.airShift(phase, 0.8, geo, x + h) - c.airShift(phase, 0.8, geo, x - h)) / (2 * h);
      assert.ok(near(1 - dsdx, c.airDensity(phase, 0.8, geo, x), 1e-6));
    }
  }
  for (const phase of [0, 0.2, 0.45, 0.8]) {
    let last = -Infinity;
    for (let i = 0; i < 400; i += 1) {
      const x = c.airX(phase, 0.8, geo, (i / 400) * geo.wavelength);
      assert.ok(x > last);
      last = x;
    }
  }
  assert.ok(c.airGeometry(122, 5000).shift >= (c.airGeometry(122, 5000).wavelength / (2 * Math.PI)) * c.AIR_K);
  assert.ok(c.airGeometry(122, 367).shift >= (c.airGeometry(122, 367).wavelength / (2 * Math.PI)) * c.AIR_K);
});

test('STU-043: the air pattern is exactly one wavelength across the visible area', () => {
  const geo = c.airGeometry(122, 367);
  assert.ok(near(geo.start + geo.wavelength + geo.shift, 367, 1e-9));
  assert.ok(near(c.pressureAt(0.3, 0, geo.wavelength), c.pressureAt(0.3, geo.wavelength, geo.wavelength), 1e-12));
  assert.ok(near(c.airX(0.3, 0.8, geo, 0) - geo.start, c.airX(0.3, 0.8, geo, geo.wavelength) - geo.start - geo.wavelength, 1e-9));
  assert.ok(near(c.airBunchFrac(1.25), 0, 1e-12));
  assert.ok(near(c.airBunchFrac(0.75), 0.5, 1e-12));
  assert.ok(near(c.airBunchFrac(0.1), 0.85, 1e-12));
  for (const phase of [0, 0.25, 0.6, 0.9]) {
    let found = 0;
    let count = 0;
    const n = 400;
    const sp = [];
    for (let i = 0; i < n; i += 1) sp.push(c.airSpacing(phase, 0.8, geo, (i / n) * geo.wavelength));
    for (let i = 0; i < n; i += 1) {
      if (sp[i] < sp[(i + n - 1) % n] && sp[i] <= sp[(i + 1) % n]) { count += 1; found = i; }
    }
    assert.equal(count, 1);
    assert.ok(Math.abs(found / n - c.airBunchFrac(phase)) < 1.5 / n || Math.abs(found / n - c.airBunchFrac(phase)) > 1 - 1.5 / n);
  }
  assert.ok(c.airGeometry(122, 367).cols * c.AIR_ROWS < 300);
  assert.ok(c.airGeometry(122, 5000).cols * c.AIR_ROWS < 300);
});

test('STU-043: a dot is red in proportion to the local density at its rest position, teal at rest or thinner', () => {
  const geo = c.airGeometry(122, 367);
  for (const phase of [0, 0.25, 0.5, 0.75, 0.9]) {
    const dist = c.airBunchFrac(phase) * geo.wavelength;
    assert.ok(near(c.airHeat(phase, 0.8, geo, dist), 1, 1e-9));
    assert.ok(near(c.airDensity(phase, 0.8, geo, dist), 1 + c.airK(0.8), 1e-9));
    assert.ok(near(c.airHeat(phase, 0.8, geo, ((c.airBunchFrac(phase) + 0.5) % 1) * geo.wavelength), 0, 1e-9));
    for (let col = 0; col < geo.cols; col += 1) {
      const d = c.airRest(geo, col, 0);
      const heat = c.airHeat(phase, 0.3, geo, d);
      assert.ok(heat >= 0 && heat <= 1);
      assert.ok(near(heat, Math.max(0, (c.airDensity(phase, 0.3, geo, d) - 1) / c.airK(0.3)), 1e-9));
    }
  }
  assert.equal(c.airHeat(0.25, 0, geo, 0), 0);
  assert.equal(c.airHeatStep(0), 0);
  assert.equal(c.airHeatStep(1), c.AIR_HEAT_STEPS);
  assert.ok(near(c.airDotRadius(1), c.AIR_DOT_R * 1.1, 1e-12));
  assert.equal(c.airDotRadius(0), c.AIR_DOT_R);
  assert.deepEqual(c.parseColor('#d2601a'), [210, 96, 26]);
  assert.deepEqual(c.parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
  const ramp = c.airRamp('#2298b1', '#d2601a');
  assert.equal(ramp.length, c.AIR_HEAT_STEPS + 1);
  assert.equal(ramp[0], '#2298b1');
  assert.equal(ramp[c.AIR_HEAT_STEPS], 'rgb(210,96,26)');
});

test('STU-043: the density curve is drawn three times larger, kept inside the strip', () => {
  assert.ok(near(c.airCurveSwing(0.3), 3 * c.AIR_CURVE_REF * 0.375, 1e-9));
  assert.ok(c.airCurveSwing(0.8) <= c.airCurveHalf());
  assert.ok(c.airCurveHalf() >= 48);
  assert.equal(c.airCurveSwing(0), 0);
  for (const phase of [0, 0.25, 0.5, 0.75]) {
    assert.ok(near(c.airCurveY(phase, 0.3, 0), c.airCurve(phase, 0.3, 0) / 0.375 * c.airCurveSwing(0.3), 1e-9));
    assert.ok(Math.abs(c.airCurveY(phase, 0.8, 0.3)) <= c.airCurveHalf() + 1e-9);
  }
});

test('STU-043: the real wavelength is 343 m/s over the live frequency and the caption has no oscilloscope dot', () => {
  assert.equal(c.fmtWavelength(440), '78 cm');
  assert.equal(c.fmtWavelength(100), '3.43 m');
  assert.equal(c.fmtWavelength(20000), '1.7 cm');
  assert.match(c.airNote(440), /one dense bunch \(high pressure\) and one thin gap \(low pressure\) are one cycle of the wave/);
  assert.match(c.airNote(440), /Red dots are the compression: air squeezed closer than at rest \(high pressure\)\. Teal dots are at rest or spread thinner\./);
  assert.match(c.airNote(440), /the real wavelength of 440 Hz is about 78 cm\./);
  assert.ok(!c.airNote(440).includes('the dot on the oscilloscope'));
});

test('STU-043: the element has its own controls, the three captions and the legend, and starts at 440 Hz, 30 % and 2000x', () => {
  const { env } = clock();
  const anim = c.createConeAnimation({}, env);
  const text = anim.node.textContent;
  assert.ok(text.includes('Slow motion: the speaker cone'));
  assert.ok(text.includes('Slow motion factor'));
  for (const n of c.SLOW_CHOICES) assert.ok(text.includes(`${n}×`));
  assert.ok(text.includes('Slowed 2000×: real 440 Hz = 0.22 swings per second'));
  assert.ok(text.includes('Swing exaggerated.'));
  assert.ok(text.includes('dense (compression)') && text.includes('at rest or thinner'));
  assert.ok(text.includes('A4 +0 cents'));
  const inputs = anim.node.querySelectorAll('input');
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].value, '440');
  assert.equal(inputs[1].value, '30');
  assert.equal(anim.slow, 2000);
  assert.equal(anim.paused, false);
  assert.ok(anim.node.querySelectorAll('button').some((b) => b.textContent === 'Pause animation'));
  anim.destroy();
});

test('STU-043: the Slow motion factor switch changes the readout, the note and the phase rate, not the phase', () => {
  const { env } = clock();
  const anim = c.createConeAnimation({}, env);
  const before = anim.phase;
  anim.setSlow(5000);
  assert.equal(anim.slow, 5000);
  assert.equal(anim.phase, before);
  assert.ok(anim.node.textContent.includes('Slowed 5000×'));
  assert.ok(anim.node.textContent.includes('runs 5000 times slower'));
  anim.setSlow(123);
  assert.equal(anim.slow, 5000);
  anim.destroy();
});

test('STU-043: the frequency and the amplitude are clamped and shown with the note name', () => {
  const { env } = clock();
  const anim = c.createConeAnimation({ frequency: 220, amplitude: 0.5 }, env);
  assert.equal(anim.frequency, 220);
  assert.equal(anim.amplitude, 0.5);
  anim.setFrequency(5);
  assert.equal(anim.frequency, 20);
  anim.setFrequency(99999);
  assert.equal(anim.frequency, 20000);
  anim.setAmplitude(5);
  assert.equal(anim.amplitude, 0.8);
  anim.setFrequency(880);
  assert.ok(anim.node.textContent.includes('A5 +0 cents'));
  assert.ok(anim.node.textContent.includes('Slowed 2000×: real 880 Hz = 0.44 swings per second'));
  anim.destroy();
});

test('STU-043: one frame loop at most; the phase wraps every 4.55 s at 440 Hz and 2000x; destroy leaves no frame', () => {
  const { env, frames, step } = clock();
  const anim = c.createConeAnimation({}, env);
  assert.equal(frames.size, 1);
  let last = 0;
  let wraps = 0;
  for (let i = 0; i < 100; i += 1) {
    step(50);
    assert.ok(frames.size <= 1);
    if (anim.phase < last) wraps += 1;
    last = anim.phase;
  }
  assert.equal(wraps, 1);
  assert.ok(near(last, (5000 * 0.22 / 1000) % 1, 1e-6));
  anim.destroy();
  assert.equal(frames.size, 0);
  assert.equal(anim.animating, false);
});

test('STU-043: pause and a hidden document stop the loop, play and a visible document restart it', () => {
  const { env, frames, step, doc } = clock();
  const anim = c.createConeAnimation({}, env);
  step(16);
  assert.equal(frames.size, 1);
  anim.stop();
  assert.equal(anim.paused, true);
  assert.equal(frames.size, 0);
  assert.ok(anim.node.textContent.includes('Play animation'));
  anim.start();
  assert.equal(anim.paused, false);
  assert.equal(frames.size, 1);
  doc.hidden = true;
  for (const fn of doc.handlers.visibilitychange) fn();
  assert.equal(frames.size, 0);
  doc.hidden = false;
  for (const fn of doc.handlers.visibilitychange) fn();
  assert.equal(frames.size, 1);
  anim.togglePause();
  assert.equal(anim.paused, true);
  anim.destroy();
});

test('STU-043: with reduced motion the animation starts paused at phase 1/4', () => {
  const { env, frames, step } = clock({ matchMedia: () => ({ matches: true }) });
  const anim = c.createConeAnimation({}, env);
  assert.equal(anim.paused, true);
  assert.equal(anim.phase, 0.25);
  assert.ok(anim.node.textContent.includes('Play animation'));
  step(16);
  assert.equal(frames.size, 0);
  anim.start();
  assert.equal(anim.paused, false);
  assert.equal(frames.size, 1);
  anim.destroy();
  assert.equal(frames.size, 0);
});
