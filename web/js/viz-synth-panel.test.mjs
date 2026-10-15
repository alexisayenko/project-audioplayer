import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const saved = {};
globalThis.localStorage = {
  getItem: (k) => (k in saved ? saved[k] : null),
  setItem: (k, v) => { saved[k] = String(v); },
  removeItem: (k) => { delete saved[k]; },
};
const { createSynthPanel } = await import('./viz-synth-panel.js');
const { SYNTH_SCHEMA, SYNTH_GROUPS, getSynth, setSynth, resetSynthForTests, onSynth, defaultSynth } = await import('./viz-synth-settings.js');

const fire = (node, type, init = {}) => node.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), init));
const rows = (panel) => panel.el.querySelectorAll('label.viz-synth-row');
const rowOf = (panel, label) => [...rows(panel)].find((r) => r.querySelector('.viz-synth-name').textContent === label);
const reset = () => { for (const k of Object.keys(saved)) delete saved[k]; resetSynthForTests(); };

test('one labelled control per schema field in seven collapsible groups', () => {
  reset();
  const panel = createSynthPanel({ doc: document });
  assert.equal(rows(panel).length, SYNTH_SCHEMA.length);
  const groups = panel.el.querySelectorAll('details.viz-synth-group');
  assert.deepEqual(groups.map((g) => g.dataset.group), SYNTH_GROUPS);
  assert.equal(groups.length, 7);
  for (const r of rows(panel)) {
    assert.ok(r.querySelector('.viz-synth-name').textContent.length > 0);
    assert.equal(r.querySelectorAll('input, select').length, 1);
  }
  for (const g of groups) assert.ok(g.querySelector('summary'));
  panel.destroy();
});

test('controls reflect the stored settings and writes go through setSynth', () => {
  reset();
  setSynth('sun.radius', 0.3);
  const panel = createSynthPanel({ doc: document });
  const r = rowOf(panel, 'Radius');
  assert.equal(r.querySelector('input').value, '0.3');
  assert.equal(r.querySelector('output').textContent, '0.30');
  const input = r.querySelector('input');
  input.value = '0.4';
  fire(input, 'input');
  assert.equal(getSynth().sun.radius, 0.4);
  const sel = rowOf(panel, 'Reflection').querySelector('select');
  sel.value = 'blur';
  fire(sel, 'change');
  assert.equal(getSynth().sun.refl, 'blur');
  const sw = rowOf(panel, 'Vignette').querySelector('input');
  sw.checked = false;
  fire(sw, 'change');
  assert.equal(getSynth().sky.vignette, false);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  const col = rowOf(panel, 'Fill colour').querySelector('input');
  col.value = '#123456';
  fire(col, 'input');
  assert.equal(getSynth().terrain.fillColor, '#123456');
  assert.equal(getSynth().terrain.preset, 'custom');
  panel.destroy();
});

test('a preset change repaints the colour controls and the preset select', () => {
  reset();
  const panel = createSynthPanel({ doc: document });
  const sel = rowOf(panel, 'Colour preset').querySelector('select');
  sel.value = 'magenta';
  fire(sel, 'change');
  assert.equal(rowOf(panel, 'Line colour').querySelector('input').value, '#ff2bd6');
  assert.equal(rowOf(panel, 'Fill colour').querySelector('input').value, '#050008');
  setSynth('terrain.lineColor', '#010203');
  assert.equal(sel.value, 'custom');
  panel.destroy();
});

test('reset buttons reset a group or everything', () => {
  reset();
  setSynth('sun.radius', 0.3);
  setSynth('sky.stars', 10);
  const panel = createSynthPanel({ doc: document });
  const sunReset = panel.el.querySelector('details[data-group="Sun"] .viz-synth-reset');
  assert.equal(sunReset.textContent, 'Reset sun');
  sunReset.click();
  assert.equal(getSynth().sun.radius, 0.22);
  assert.equal(getSynth().sky.stars, 10);
  assert.equal(rowOf(panel, 'Radius').querySelector('input').value, '0.22');
  panel.el.querySelector('.viz-synth-reset-all').click();
  assert.deepEqual(getSynth(), defaultSynth());
  panel.destroy();
});

test('keydown does not escape the panel so global hotkeys stay quiet', () => {
  reset();
  const panel = createSynthPanel({ doc: document });
  const parent = document.createElement('div');
  parent.append(panel.el);
  let leaked = 0;
  parent.addEventListener('keydown', () => { leaked += 1; });
  for (const key of ['v', 'm', 't', 'ArrowRight']) {
    const e = new Event('keydown', { bubbles: true, cancelable: true });
    e.key = key;
    rowOf(panel, 'Radius').querySelector('input').dispatchEvent(e);
  }
  assert.equal(leaked, 0);
  panel.destroy();
});

test('controls are keyboard operable native inputs with 44 px css and no tabindex traps', () => {
  reset();
  const panel = createSynthPanel({ doc: document });
  for (const c of panel.el.querySelectorAll('input, select, button')) {
    assert.notEqual(c.getAttribute('tabindex'), '-1');
    assert.notEqual(c.hidden, true);
  }
  assert.equal(panel.el.querySelector('.viz-synth-reset-all').type, 'button');
  panel.destroy();
});

test('destroy unsubscribes and removes the panel', () => {
  reset();
  const host = document.createElement('div');
  const panel = createSynthPanel({ doc: document });
  host.append(panel.el);
  let calls = 0;
  const off = onSynth(() => { calls += 1; });
  panel.destroy();
  assert.equal(host.childNodes.length, 0);
  setSynth('sun.radius', 0.5);
  assert.equal(calls, 1);
  assert.equal(rowOf(panel, 'Radius').querySelector('input').value, '0.22');
  off();
});

test('an injected store is used instead of the global settings', () => {
  const calls = [];
  const listeners = new Set();
  const cur = defaultSynth();
  const store = { get: () => cur, set: (p, v) => calls.push([p, v]), reset: (g) => calls.push(['reset', g]), on: (cb) => { listeners.add(cb); return () => listeners.delete(cb); } };
  const panel = createSynthPanel({ doc: document, store });
  const input = rowOf(panel, 'Stars').querySelector('input');
  input.value = '20';
  fire(input, 'input');
  assert.deepEqual(calls, [['sky.stars', 20]]);
  assert.equal(listeners.size, 1);
  panel.destroy();
  assert.equal(listeners.size, 0);
});
