import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, availableModes, pickMode, nextMode, isSceneMode, usesFlight, createModeRenderer } from './viz-modes.js';
import { buildShareUrl, parseShareParams } from './share.js';
import { panelSections, panelHasContent } from './viz-panel.js';
import { createSynth } from './viz-synth-gl.js';
import { createGroundPass } from './viz-synth-ground.js';

function linkingGL() {
  const calls = [];
  const consts = new Map();
  return new Proxy({}, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!consts.has(name)) consts.set(name, consts.size + 1);
        return consts.get(name);
      }
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'getUniformLocation') return (_p, n) => ({ name: n });
      if (typeof name === 'string' && name.startsWith('create')) return () => ({ kind: name });
      return (...a) => { calls.push([name, ...a]); };
    },
  });
}

const canvas = () => ({ width: 300, height: 150, addEventListener() {}, removeEventListener() {}, getContext: () => null });

test('synthwave is the fourth mode, GL only, a scene mode without flight', () => {
  assert.equal(MODES[3].id, 'synthwave');
  assert.ok(!availableModes({ webgl: false }).some((m) => m.id === 'synthwave'));
  assert.equal(pickMode('synthwave', { webgl: false }), 'bars');
  assert.equal(pickMode('synthwave', { webgl: true }), 'synthwave');
  assert.equal(nextMode('terrain', { webgl: true }), 'synthwave');
  assert.equal(nextMode('synthwave', { webgl: true }), 'bars');
  assert.ok(isSceneMode('synthwave'));
  assert.ok(!usesFlight('synthwave'));
});

test('the factory builds synthwave and falls back to bars when it returns null', () => {
  const a = createModeRenderer('synthwave', canvas(), canvas(), { factories: { synthwave: () => null } });
  assert.equal(a.id, 'bars');
  const made = { draw() {}, resize() {}, dispose() {}, setQuality() {}, setLite() {}, setDprCap() {}, stats: {} };
  const b = createModeRenderer('synthwave', canvas(), canvas(), { factories: { synthwave: () => made } });
  assert.equal(b.id, 'synthwave');
});

test('share links round trip viz=synthwave', () => {
  const url = buildShareUrl({ origin: 'https://x.test', id: 'abc', t: 5, viz: 'synthwave' });
  assert.match(url, /viz=synthwave/);
  assert.equal(parseShareParams(url.slice(url.indexOf('#'))).viz, 'synthwave');
});

test('the style panel shows the synth section only for synthwave', () => {
  assert.equal(panelSections('synthwave').synth, true);
  assert.equal(panelSections('terrain').synth, false);
  assert.ok(panelHasContent('synthwave'));
});

test('the shell hands the ground pass its field in the 4-argument form and terrain is uploaded', () => {
  const gl = linkingGL();
  let pass = null;
  const synth = createSynth(canvas(), {
    gl,
    reduced: false,
    passes: { ground: (g, d) => { pass = createGroundPass(g, d); return pass; } },
  });
  synth.resize(640, 360, 1);
  const spec = new Float32Array(64).fill(0.8);
  for (let i = 0; i < 10; i += 1) synth.draw(spec, 1000 + i * 40);
  assert.ok(pass.stats.uploads > 0);
  assert.ok(pass.stats.tiers > 0);
});
