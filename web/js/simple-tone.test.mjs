import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/studio/simple', href: 'http://localhost/' };
const s = await import('./simple-tone.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('WEB-199: power is the amplitude squared and 30 % amplitude is 9 % power and -10.5 dBFS', () => {
  assert.ok(near(s.powerPct(0.3), 9));
  assert.equal(s.fmtDb(0.3), '-10.5 dBFS');
  assert.equal(s.fmtDb(0), 'silence');
  assert.ok(near(s.powerPct(0.6), 4 * s.powerPct(0.3)));
  assert.ok(near(s.ampOfPower(9), 0.3));
  assert.ok(near(s.ampOfPower(s.powerPct(0.55)), 0.55));
});

test('WEB-199: the hard limit is 80 % amplitude, which is 64 % power', () => {
  assert.equal(s.clampParams({ amp: 1 }).amp, 0.8);
  assert.equal(s.clampParams({ amp: -1 }).amp, 0);
  assert.equal(s.ampOfPower(100), 0.8);
  assert.equal(s.MAX_POWER_PCT, 64);
});

test('WEB-198: defaults and clamps for frequency and length', () => {
  assert.deepEqual(s.DEFAULTS, { freq: 440, amp: 0.3, length: 2, continuous: false });
  assert.equal(s.clampParams({ freq: 5 }).freq, 20);
  assert.equal(s.clampParams({ freq: 90000 }).freq, 20000);
  assert.equal(s.clampParams({ length: 0 }).length, 0.1);
  assert.equal(s.clampParams({ length: 99 }).length, 30);
  assert.deepEqual(s.clampParams({ freq: NaN, amp: NaN, length: NaN }), s.DEFAULTS);
});

test('WEB-198: the frequency slider is logarithmic from 20 Hz to 20 kHz', () => {
  assert.equal(s.sliderToHz(0), 20);
  assert.equal(s.sliderToHz(1000), 20000);
  assert.equal(s.sliderToHz(500), 632);
  assert.ok(Math.abs(s.hzToSlider(440) - 447) <= 1);
  assert.equal(s.noteInfo(440).text, 'A4 +0 cents');
});

test('WEB-201: the readout states the period, the swing, the power and the length', () => {
  assert.equal(s.readout(s.DEFAULTS), 'Period 2.27 ms = 1/f; pressure swings ±30 % of full scale; power 9 %; sound lasts 2 s.');
  assert.match(s.readout({ ...s.DEFAULTS, continuous: true }), /sound lasts until you press Stop\.$/);
  assert.equal(s.fmtMs(s.periodMs(20)), '50');
});

test('WEB-201: the scope series spans the chosen cycles (default one) at the set amplitude', () => {
  assert.equal(s.CYCLES, 1);
  const v = s.scopeSeries(0.3, 701);
  assert.equal(v.length, 701);
  assert.ok(near(Math.max(...v), 0.3, 1e-3));
  assert.ok(near(v[0], 0));
  assert.ok(near(v[700], 0, 1e-9));
  assert.ok(near(s.scopeSeries(0.3, 701, 4)[175], 0.3 * Math.sin(2 * Math.PI), 1e-9));
});

test('WEB-201: the time axis has five ticks that follow the window', () => {
  const ms = (cycles) => s.scopeTicks(cycles, 220).map((t) => s.fmtMs(t.ms));
  assert.deepEqual(ms(1), ['0', '1.14', '2.27', '3.41', '4.55']);
  assert.deepEqual(ms(2), ['0', '2.27', '4.55', '6.82', '9.09']);
  assert.deepEqual(ms(4), ['0', '4.55', '9.09', '13.6', '18.2']);
  assert.deepEqual(s.scopeTicks(1, 220).map((t) => t.frac), [0, 0.25, 0.5, 0.75, 1]);
});

test('WEB-201: the live window starts on a rising zero crossing and holds exactly the chosen cycles', () => {
  const rate = 48000;
  const buf = new Float32Array(32768);
  for (let i = 0; i < buf.length; i += 1) buf[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate);
  for (const cycles of [1, 2, 4]) {
    const w = s.liveWindow(buf, rate, 440, cycles, 600);
    assert.equal(w.need, 600);
    assert.equal(w.samples.length, 600);
    assert.ok(Math.abs(w.samples[0]) < 0.005);
    assert.ok(Math.abs(w.samples[599]) < 0.005);
    assert.ok(w.samples[2] > 0);
  }
});

test('WEB-204: the phase of the slowed cone accumulates f/1000 cycles per second and stays continuous', () => {
  assert.ok(near(s.advancePhase(0, 440, 1000), 0.44));
  assert.ok(near(s.advancePhase(0.9, 440, 1000), 0.34, 1e-9));
  const a = s.advancePhase(s.advancePhase(0.1, 440, 500), 220, 500);
  assert.ok(near(a, 0.1 + 0.22 + 0.11, 1e-9));
  assert.equal(s.advancePhase(0.3, 440, -5), 0.3);
});

test('WEB-204: the slow motion factor is 250, 500, 1000, 2000, 5000 or 10000, defaults to 2000 and divides the phase rate', () => {
  assert.deepEqual(s.SLOW_CHOICES, [250, 500, 1000, 2000, 5000, 10000]);
  assert.equal(s.SLOW_DEFAULT, 2000);
  assert.ok(near(s.advancePhase(0, 440, 1000, 250), 0.76));
  assert.equal(s.slowReadout(440, 250), 'Slowed 250×: real 440 Hz = 1.76 swings per second (one swing every 0.568 s); the real cone makes 440 swings each second.');
  assert.ok(s.slowReadout(2000, 250).endsWith('Too fast to follow at this frequency.'));
  assert.ok(near(s.advancePhase(0, 440, 1000, 2000), 0.22));
  assert.ok(near(s.advancePhase(0, 440, 1000, 10000), 0.044));
  assert.equal(s.slowReadout(440, 2000), 'Slowed 2000×: real 440 Hz = 0.22 swings per second (one swing every 4.55 s); the real cone makes 440 swings each second.');
  assert.match(s.coneNote(5000), /runs 5000 times slower/);
  const geo = s.airGeometry(124, 1124);
  assert.ok(s.airSpeedPx(geo, 440, 1000) > 250);
  assert.ok(s.airSpeedPx(geo, 440, s.SLOW_DEFAULT) <= 250);
});

test('WEB-204: the Slow motion factor switch changes the readout, the note and the phase rate, not the phase', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  assert.equal(card.slow, 2000);
  assert.ok(card.node.textContent.includes('Slowed 2000×'));
  const before = card.phase;
  card.setSlow(5000);
  assert.equal(card.slow, 5000);
  assert.equal(card.phase, before);
  assert.ok(card.node.textContent.includes('Slowed 5000×'));
  assert.ok(card.node.textContent.includes('runs 5000 times slower'));
  card.setSlow(123);
  assert.equal(card.slow, 5000);
  card.dispose();
});

test('WEB-204: the readout states the slowed rate and warns above 5 swings per second', () => {
  assert.equal(s.slowReadout(440), 'Slowed 1000×: real 440 Hz = 0.44 swings per second (one swing every 2.27 s); the real cone makes 440 swings each second.');
  assert.ok(s.slowReadout(20000).endsWith('Too fast to follow at this frequency.'));
  assert.ok(!s.slowReadout(5000).includes('Too fast'));
  assert.ok(s.slowReadout(5001).includes('Too fast'));
  assert.match(s.slowReadout(1000), /= 1 swing per second \(one swing every 1 s\)/);
});

test('WEB-204: the cone is a quarter cycle behind the pressure: mid-swing at the pressure peak, at an extreme at zero pressure', () => {
  assert.ok(near(s.coneOffset(0.25, 0.8), 0, 1e-12));
  assert.ok(near(s.coneOffset(0, 0.8), -1));
  assert.ok(near(s.coneOffset(0.5, 0.8), 1));
  assert.ok(near(s.coneOffset(0.5, 0.3), 0.375));
  assert.ok(near(s.coneOffset(0.75, 0.3), 0, 1e-12));
  const peak = s.scopeMarker(0.25, 0.3);
  assert.ok(near(peak.level, 0.3) && peak.frac === 0.25);
  assert.ok(near(s.scopeMarker(0.5, 0.3).level, 0, 1e-12));
  assert.ok(near(s.pressureAt(0.25, 0, 200), 1));
  assert.ok(near(s.pressureAt(0.25, 50, 200), 0, 1e-12));
  const dt = 1e-6;
  for (const phase of [0.1, 0.25, 0.4, 0.5, 0.8]) {
    const velocity = (s.coneOffset(phase + dt, 0.8) - s.coneOffset(phase - dt, 0.8)) / (2 * dt);
    assert.ok(near(velocity / (2 * Math.PI), Math.sin(2 * Math.PI * phase), 1e-6));
  }
});

test('WEB-204: the air density at distance x is the oscilloscope pressure at time t - x/c, mirrored in time across the area', () => {
  const geo = s.airGeometry(122, 367);
  for (const phase of [0, 0.1, 0.25, 0.6, 0.75]) {
    for (const u of [0, 0.2, 0.5, 0.85]) {
      const scope = Math.sin(2 * Math.PI * (phase - u));
      assert.ok(near(s.airDensity(phase, 0.8, geo, u * geo.wavelength) - 1, s.airK(0.8) * scope, 1e-12));
      assert.ok(near(s.airCurve(phase, 0.3, u) * 0.8, 0.3 * scope, 1e-12));
    }
  }
  assert.ok(near(s.airCurve(0.25, 0.8, 0), 1));
  assert.ok(near(s.airCurve(0.75, 0.8, 0), -1));
  assert.ok(near(s.airCurve(0.6, 0.3, 0) * 0.8, s.scopeMarker(0.6, 0.3).level, 1e-12));
  assert.ok(s.airDensity(0.25, 0.8, geo, 0) > s.airDensity(0.25, 0.8, geo, 0.5 * geo.wavelength));
  assert.ok(s.airSpacing(0.25, 0.8, geo, 0) < 1 && s.airSpacing(0.75, 0.8, geo, 0) > 1);
  assert.ok(s.airSpacing(0.25, 0.8, geo, 0) < s.airSpacing(0, 0.8, geo, 0));
});

test('WEB-204: the dot displacement field gives density 1 - ds/dx and the dots never cross', () => {
  const geo = s.airGeometry(122, 367);
  const h = 1e-4;
  for (const phase of [0, 0.3, 0.7]) {
    for (const u of [0.1, 0.4, 0.9]) {
      const x = u * geo.wavelength;
      const dsdx = (s.airShift(phase, 0.8, geo, x + h) - s.airShift(phase, 0.8, geo, x - h)) / (2 * h);
      assert.ok(near(1 - dsdx, s.airDensity(phase, 0.8, geo, x), 1e-6));
    }
  }
  for (const phase of [0, 0.2, 0.45, 0.8]) {
    let last = -Infinity;
    for (let i = 0; i < 400; i += 1) {
      const x = s.airX(phase, 0.8, geo, (i / 400) * geo.wavelength);
      assert.ok(x > last);
      last = x;
    }
  }
  assert.ok(s.airGeometry(122, 5000).shift >= (s.airGeometry(122, 5000).wavelength / (2 * Math.PI)) * s.AIR_K);
  assert.ok(s.airGeometry(122, 367).shift >= (s.airGeometry(122, 367).wavelength / (2 * Math.PI)) * s.AIR_K);
});

test('WEB-204: the air pattern is exactly one wavelength across the visible area, matching the one-cycle oscilloscope', () => {
  const geo = s.airGeometry(122, 367);
  assert.ok(near(geo.start + geo.wavelength + geo.shift, 367, 1e-9));
  assert.ok(near(s.pressureAt(0.3, 0, geo.wavelength), s.pressureAt(0.3, geo.wavelength, geo.wavelength), 1e-12));
  assert.ok(near(s.airX(0.3, 0.8, geo, 0) - geo.start, s.airX(0.3, 0.8, geo, geo.wavelength) - geo.start - geo.wavelength, 1e-9));
  assert.ok(near(s.airBunchFrac(1.25), 0, 1e-12));
  assert.ok(near(s.airBunchFrac(0.75), 0.5, 1e-12));
  assert.ok(near(s.airBunchFrac(0.1), 0.85, 1e-12));
  assert.ok(near(s.airBunchFrac(0.25), s.airBunchFrac(1.25), 1e-12));
  for (const phase of [0, 0.25, 0.6, 0.9]) {
    let best = 0;
    let found = 0;
    let count = 0;
    const n = 400;
    const sp = [];
    for (let i = 0; i < n; i += 1) sp.push(s.airSpacing(phase, 0.8, geo, (i / n) * geo.wavelength));
    for (let i = 0; i < n; i += 1) {
      if (sp[i] < sp[best]) best = i;
      if (sp[i] < sp[(i + n - 1) % n] && sp[i] <= sp[(i + 1) % n]) { count += 1; found = i; }
    }
    assert.equal(count, 1);
    assert.ok(Math.abs(found / n - s.airBunchFrac(phase)) < 1.5 / n || Math.abs(found / n - s.airBunchFrac(phase)) > 1 - 1.5 / n);
  }
  assert.ok(s.airSpacing(0.25, 0.8, geo, 0.1 * geo.wavelength) < 1);
  assert.ok(s.airSpacing(0.25, 0.8, geo, 0.6 * geo.wavelength) > 1);
  assert.ok(s.airGeometry(122, 367).cols * s.AIR_ROWS < 300);
  assert.ok(s.airGeometry(122, 5000).cols * s.AIR_ROWS < 300);
});

test('WEB-204: the compression band sits on the densest bunch, the rarefaction band half an area behind, and both fade at the wrap', () => {
  const geo = s.airGeometry(122, 367);
  for (const phase of [0, 0.25, 0.5, 0.75, 0.9]) {
    const x = s.airBandX(geo, phase);
    const frac = (x - geo.start) / geo.wavelength;
    assert.ok(near(s.airCurve(phase, 0.8, frac), 1, 1e-9));
    assert.ok(near(s.airDensity(phase, 0.8, geo, frac * geo.wavelength), 1 + s.airK(0.8), 1e-9));
    assert.ok(near(s.airX(phase, 0.8, geo, frac * geo.wavelength), x, 1e-9));
    assert.ok(near(s.airCurve(phase, 0.8, s.airBandFrac(phase, true)), -1, 1e-9));
  }
  assert.ok(near(s.airBandFrac(0.25), 0, 1e-12));
  assert.ok(near(s.airBandFrac(0.5), 0.25, 1e-12));
  assert.ok(near(s.airBandFrac(0.25, true), 0.5, 1e-12));
  assert.equal(s.airBandFade(0), 0);
  assert.equal(s.airBandFade(0.5), 1);
  assert.ok(near(s.airBandFade(0.05), 0.5, 1e-12));
  assert.ok(near(s.airBandFade(0.95), 0.5, 1e-12));
  assert.ok(s.airCurveHalf() * 2 >= 80);
});

test('WEB-204: the real wavelength is 343 m/s over the live frequency', () => {
  assert.ok(near(s.wavelengthM(440), 0.7795, 1e-3));
  assert.equal(s.fmtWavelength(440), '78 cm');
  assert.equal(s.fmtWavelength(100), '3.43 m');
  assert.equal(s.fmtWavelength(20000), '1.7 cm');
  assert.match(s.airNote(440), /one dense bunch \(high pressure\) and one thin gap \(low pressure\) are one cycle of the wave/);
  assert.match(s.airNote(440), /The highlighted band follows the densest bunch of air \(highest pressure\) as it travels away from the cone; it crosses the density curve at its peak\./);
  assert.match(s.airNote(440), /the real wavelength of 440 Hz is about 78 cm\.$/);
});

test('WEB-197: the oscilloscope bracket label states the live period, frequency and wavelength', () => {
  assert.equal(s.cycleLabels(440)[0], '1 cycle = 2.27 ms = 440 Hz = 78 cm in air');
  assert.equal(s.cycleLabels(220)[0], '1 cycle = 4.55 ms = 220 Hz = 1.56 m in air');
  assert.equal(s.cycleLabels(4000)[0], '1 cycle = 0.25 ms = 4000 Hz = 8.6 cm in air');
  assert.equal(s.cycleLabels(440)[1], '1 cycle · 2.27 ms · 440 Hz · 78 cm');
  assert.equal(s.cycleLabels(440)[2], '1 cycle · 2.27 ms · 440 Hz');
  assert.equal(s.fmtWavelengthLabel(343.1), '1.00 m');
  assert.equal(s.fmtWavelengthLabel(20), '17.15 m');
  const width = (t) => t.length * 6;
  assert.equal(s.pickCycleLabel(440, 400, width, false), s.cycleLabels(440)[0]);
  assert.equal(s.pickCycleLabel(440, 400, width, true), s.cycleLabels(440)[1]);
  assert.equal(s.pickCycleLabel(440, 150, width, true), s.cycleLabels(440)[2]);
  assert.equal(s.pickCycleLabel(440, 10, width, true), s.cycleLabels(440)[2]);
});

test('WEB-197: the bracket row lies below the curve area and above the axis labels, clear of the dot', () => {
  const geo = s.scopeGeometry(400, 190);
  assert.ok(geo.mid + geo.scale <= geo.rowTop);
  assert.ok(geo.rowTop + geo.row <= 190 - geo.bottom);
  const dotLow = geo.mid + 0.8 * geo.scale + 5;
  assert.ok(dotLow < geo.rowTop);
});

test('WEB-207: the time window covers frequency x window cycles, with a caption, a many-cycles hint and sensible ms ticks', () => {
  assert.deepEqual(s.WINDOW_CHOICES, [10, 20, 50, 200]);
  assert.equal(s.WINDOW_DEFAULT, 20);
  assert.ok(near(s.windowCycles(440, 20), 8.8));
  assert.ok(near(s.windowCycles(1000, 10), 10));
  assert.equal(s.windowCaption(440, 20), 'about 8.8 cycles in 20 ms');
  assert.equal(s.windowCaption(440, 200), 'about 88 cycles in 200 ms');
  assert.equal(s.windowCaption(100, 10), 'about 1 cycle in 10 ms');
  assert.equal(s.windowCaption(20, 10), 'about 0.2 cycles in 10 ms');
  assert.equal(s.tooManyCycles(s.windowCycles(440, 20)), false);
  assert.equal(s.tooManyCycles(s.windowCycles(440, 200)), true);
  assert.equal(s.tooManyCycles(60), false);
  assert.equal(s.tooManyCycles(60.5), true);
  assert.deepEqual(s.windowTicks(20).map((t) => t.ms), [0, 5, 10, 15, 20]);
  assert.deepEqual(s.windowTicks(10).map((t) => t.ms), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(s.windowTicks(50).map((t) => t.ms), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(s.windowTicks(200).map((t) => t.frac), [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(near(s.scopeSeries(0.3, 801, s.windowCycles(440, 20))[400], 0.3 * Math.sin(Math.PI * 8.8), 1e-9));
  assert.ok(s.windowPoints(300, 5000) <= s.WINDOW_MAX_POINTS);
  assert.ok(s.windowPoints(300, 1) >= 600);
  assert.equal(s.scopeGeometry(400, 160, false).row, 0);
  assert.equal(s.scopeGeometry(400, 190).row, 26);
});

test('WEB-207: Primitive has a second oscilloscope below the first with a Time window switch that follows the settings', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  const heads = card.node.querySelectorAll('h3').map((h) => h.textContent);
  assert.ok(heads.indexOf('Oscilloscope: one cycle') >= 0);
  assert.equal(heads.indexOf('Oscilloscope: time window'), heads.indexOf('Oscilloscope: one cycle') + 1);
  assert.ok(card.node.textContent.includes('Oscilloscope: one cycle. Waveform of the tone over one cycle: time across, amplitude up; the dot is the pressure now.'));
  assert.ok(card.node.textContent.includes('Oscilloscope: time window. Waveform over a period of time: time across, amplitude up.'));
  assert.equal(card.window, 20);
  assert.ok(card.node.textContent.includes('about 8.8 cycles in 20 ms'));
  const many = card.node.querySelectorAll('p').find((p) => p.textContent === 'Too many cycles to see the shape: shorten the window');
  assert.equal(many.hidden, true);
  card.setWindow(200);
  assert.equal(card.window, 200);
  assert.ok(card.node.textContent.includes('about 88 cycles in 200 ms'));
  assert.equal(many.hidden, false);
  card.setWindow(123);
  assert.equal(card.window, 200);
  card.change({ freq: 100 });
  assert.ok(card.node.textContent.includes('about 20 cycles in 200 ms'));
  assert.equal(many.hidden, true);
  card.dispose();
});

test('WEB-197: the Primitive oscilloscope block is titled Oscilloscope: one cycle with a waveform subtitle', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  assert.ok(card.node.querySelectorAll('h3').some((h) => h.textContent === 'Oscilloscope: one cycle'));
  assert.ok(card.node.textContent.includes('Waveform of the tone over one cycle: time across, amplitude up; the dot is the pressure now.'));
  assert.ok(card.node.textContent.includes('The cone is a quarter cycle behind the pressure: the air is squeezed hardest when the cone moves fastest, in the middle of its swing.'));
  assert.ok(card.node.textContent.includes('the curve above them is the oscilloscope curve mirrored in time, and the dot on the oscilloscope is the pressure now'));
  assert.ok(!card.node.textContent.includes("the cone's present position"));
  card.dispose();
});

test('WEB-204: Primitive has no Cycles shown selector, a Pause animation control and honours reduced motion', () => {
  const env = { ...fakeCtx().env, matchMedia: () => ({ matches: true }) };
  const card = s.createSimpleCard(env);
  assert.ok(!card.node.textContent.includes('Cycles shown'));
  const btn = [...card.node.querySelectorAll('button')].find((b) => /animation/i.test(b.textContent));
  assert.equal(btn.textContent, 'Play animation');
  assert.equal(card.paused, true);
  assert.equal(card.phase, 0.25);
  card.togglePause();
  assert.equal(btn.textContent, 'Pause animation');
  card.dispose();
});

function fakeCtx() {
  const made = [];
  const param = () => ({ value: 0, calls: [], setValueAtTime(...a) { this.calls.push(['set', ...a]); }, linearRampToValueAtTime(...a) { this.calls.push(['ramp', ...a]); }, setTargetAtTime(...a) { this.calls.push(['target', ...a]); }, cancelScheduledValues() {} });
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; this.closed = false; made.push(this); }
    createOscillator() { const o = { type: '', frequency: param(), connect() {}, disconnect() {}, start(t) { this.started = t; }, stop(t) { this.stopped = t; } }; this.osc = o; return o; }
    createGain() { this.gain = { gain: param(), connect() {}, disconnect() {} }; return this.gain; }
    createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData() {} }; }
    close() { this.closed = true; return Promise.resolve(); }
    resume() { return Promise.resolve(); }
  }
  const doc = { hidden: false, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); } };
  return { env: { AudioContext: Ctx, document: doc, raf: () => 0, caf: () => {} }, made, doc };
}

test('WEB-200: Play makes a 440 Hz sine at gain 0.3, fades in and out over 30 ms and stops at the length', () => {
  const { env, made } = fakeCtx();
  const card = s.createSimpleCard(env);
  card.start();
  const ctx = made[0];
  assert.equal(ctx.osc.type, 'sine');
  assert.equal(ctx.osc.frequency.value, 440);
  assert.deepEqual(ctx.gain.gain.calls.slice(0, 2), [['set', 0, 0], ['ramp', 0.3, 0.03]]);
  assert.equal(ctx.osc.stopped, 2);
  assert.equal(card.running, true);
  ctx.osc.onended();
  assert.equal(card.running, false);
  assert.equal(ctx.closed, true);
  assert.equal(card.state, 'done');
  card.dispose();
});

test('WEB-200: Stop fades out and closes the context; leaving the page closes it at once', async () => {
  const { env, made } = fakeCtx();
  const card = s.createSimpleCard(env);
  card.change({ continuous: true });
  card.start();
  assert.equal(made[0].osc.stopped, undefined);
  card.stop();
  assert.equal(card.running, false);
  made[0].osc.onended();
  assert.equal(made[0].closed, true);
  card.start();
  card.dispose();
  assert.equal(made[1].closed, true);
});

test('WEB-200: a hidden page stops the tone', () => {
  const { env, made, doc } = fakeCtx();
  const card = s.createSimpleCard(env);
  card.start();
  doc.hidden = true;
  for (const f of doc.handlers.visibilitychange) f();
  assert.equal(card.running, false);
  assert.equal(made[0].closed, true);
  card.dispose();
});

test('WEB-197: the Synthesize tool (now on the studio site) mounts its card into a plain panel', async () => {
  const panel = document.createElement('div');
  const dispose = s.mountSimple(panel, fakeCtx().env);
  await flush();
  assert.ok(panel.querySelector('section.card.sm-card'));
  dispose();
});
