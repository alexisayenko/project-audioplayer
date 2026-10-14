import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { createViz } = await import('./viz-canvas.js');
const { createTerrain } = await import('./viz-terrain-gl.js');
const F = await import('./viz-flight.js');
const { createStylePanel, flightReadout: panelReadout } = await import('./viz-panel.js');
const { defaultParts } = await import('./viz-parts.js');

function fakeGL() {
  const vps = [];
  const gl = new Proxy({}, {
    get(_t, name) {
      if (name === 'vps') return vps;
      if (/^[A-Z0-9_]+$/.test(name)) return 1;
      return (...args) => {
        if (name.startsWith('create')) return { kind: name.slice(6) };
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'checkFramebufferStatus') return gl.FRAMEBUFFER_COMPLETE;
        if (name === 'getUniformLocation') return { name: args[1] };
        if (name === 'uniformMatrix4fv' && args[0].name === 'u_vp') vps.push(Float32Array.from(args[2]));
        return undefined;
      };
    },
  });
  return gl;
}

function rig() {
  const gl = fakeGL();
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set(t, k, v) { t[k] = v; return true; } });
  const canvas = { getContext: () => ctx, width: 0, height: 0, clientWidth: 0, clientHeight: 0 };
  const glc = { style: {}, hidden: true, width: 0, height: 0, remove() {}, addEventListener() {}, removeEventListener() {} };
  const s = { clock: 1000, pending: null };
  const deps = {
    doc: { addEventListener() {}, removeEventListener() {} },
    getAnalyser: () => ({ frequencyBinCount: 1024, fftSize: 2048, minDecibels: -100, maxDecibels: -30, context: { sampleRate: 48000 }, getFloatFrequencyData: (a) => a.fill(-50) }),
    isPlaying: () => s.playing,
    isVisible: () => true,
    reducedQuery: () => ({ matches: false, addEventListener() {} }),
    isCoarse: () => false,
    getColors: () => ({ a: [255, 0, 0], b: [0, 255, 0], accent: [0, 0, 255], scrim: [0, 0, 0], line: [255, 255, 255] }),
    raf: (fn) => { s.pending = fn; return 1; },
    caf: () => { s.pending = null; },
    now: () => s.clock,
    dpr: () => 1,
    ResizeObserver: undefined,
    createGLCanvas: () => glc,
    createTerrain: (c, o) => createTerrain(c, { ...o, gl, quality: 1 }),
  };
  s.playing = true;
  const viz = createViz({ canvas, mode: 'full', deps });
  viz.resize(1280, 720);
  viz.setVizMode('terrain');
  viz.setEnabled(true);
  const frames = (n, ms = 16) => { for (let i = 0; i < n; i += 1) { s.clock += ms; const fn = s.pending; s.pending = null; if (fn) fn(s.clock); } };
  return { viz, gl, s, frames };
}

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

const reset = () => { localStorage.removeItem(F.FLIGHT_KEY); F.resetFlightForTests(); };
const mkPanel = () => createStylePanel({ doc: document, mode: 'terrain', width: 1200, parts: { state: defaultParts(), onChange() {}, onRefuse() {} } });
const click = (el) => el.dispatchEvent(new Event('click'));

test('panel switch -> flight singleton -> uploaded camera matrix changes over fake time', () => {
  reset();
  const r = rig();
  const panel = mkPanel();
  r.frames(40);
  const still = r.gl.vps.slice(-30);
  assert.ok(still.every((m) => dist(m, still[0]) < 0.05), 'camera is still while the switch is off');
  click(panel.el.querySelector('#viz-flight-toggle'));
  assert.equal(F.flight.isOn(), true);
  r.frames(Math.round(8000 / 16));
  const base = still[0];
  const seen = [];
  for (let i = 0; i < 6; i += 1) { r.frames(Math.round(2000 / 16)); seen.push(dist(base, r.gl.vps.at(-1))); }
  assert.ok(Math.max(...seen) > 0.5, `matrix drift ${seen.map((v) => v.toFixed(2))}`);
  let path = 0;
  let prev = r.gl.vps.at(-1);
  for (let i = 0; i < 6; i += 1) { r.frames(Math.round(1000 / 16)); path += dist(prev, r.gl.vps.at(-1)); prev = r.gl.vps.at(-1); }
  assert.ok(path > 0.2, `still moving over the next 6 s, path ${path}`);
  panel.dispose();
});

test('flight time does not advance while paused, matrix then holds', () => {
  reset();
  const r = rig();
  F.setFlightOn(true);
  r.frames(Math.round(6000 / 16));
  r.s.playing = false;
  r.frames(20);
  const a = r.gl.vps.at(-1);
  r.frames(60);
  assert.ok(dist(a, r.gl.vps.at(-1)) < 0.02);
});

test('readout shows the applied offsets while on and hides when off or reduced', () => {
  reset();
  const r = rig();
  const panel = mkPanel();
  const read = panel.el.querySelector('.viz-flight-readout');
  assert.equal(read.hidden, true);
  F.setFlightOn(true);
  r.frames(Math.round(12000 / 16));
  panel.setMode('terrain');
  assert.equal(read.hidden, false);
  assert.match(read.textContent, /^eye [+-]\d\.\d {2}yaw [+-]\d+\.\ddeg$/);
  const o = F.flight.applied();
  assert.ok(Math.abs(o.eye) > 0.05 || Math.abs(o.yaw) > 0.5);
  r.s.playing = false;
  r.frames(5);
  panel.setMode('terrain');
  assert.match(read.textContent, /paused/);
  F.setFlightOn(false);
  assert.equal(read.hidden, true);
  F.setFlightOn(true);
  F.setReducedForTests(true);
  assert.equal(read.hidden, true);
  reset();
  panel.dispose();
});

test('flightReadout formats signs and the paused hint', () => {
  assert.equal(panelReadout({ eye: 0.44, yaw: -6.24, pitch: 0 }, true), 'eye +0.4  yaw -6.2deg');
  assert.match(panelReadout({ eye: 0, yaw: 0, pitch: 0 }, false), /paused/);
});

test('max speeds are clearly visible: yaw over 1 deg/s and eye over 0.1 units/s at the default camera', () => {
  const fl = F.createFlight({ seed: 3 });
  fl.setOn(true);
  let prev = null;
  let vy = 0;
  let ve = 0;
  for (let i = 0; i <= 120 * 60; i += 1) {
    fl.tick(i * 1000 / 60, true);
    const o = fl.offsets({ eye: 3.31, pitch: -13.5, yaw: 0 });
    if (prev && i > 300) { vy = Math.max(vy, Math.abs(o.yaw - prev.yaw) * 60); ve = Math.max(ve, Math.abs(o.eye - prev.eye) * 60); }
    prev = o;
  }
  assert.ok(vy > 1 && vy < 10, `yaw ${vy}`);
  assert.ok(ve > 0.1 && ve < 0.7, `eye ${ve}`);
});
