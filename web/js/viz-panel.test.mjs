import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { panelSections, panelTitle, panelHasContent, defaultCollapsed, readCollapsed, createStylePanel, PANEL_COLLAPSED_KEY } = await import('./viz-panel.js');
const { defaultParts } = await import('./viz-parts.js');

test('sections per mode: Terrain style select, Mirrored spectrum parts, Ring nothing', () => {
  assert.deepEqual(panelSections('terrain'), { style: true, flight: true, parts: false });
  assert.deepEqual(panelSections('bars'), { style: false, flight: false, parts: true });
  assert.deepEqual(panelSections('ring'), { style: false, flight: false, parts: false });
  assert.equal(panelHasContent('ring'), false);
  assert.equal(panelHasContent('bars'), true);
});

test('title names the active mode', () => {
  assert.match(panelTitle('terrain'), /^Terrain style$/);
  assert.match(panelTitle('bars'), /style$/);
});

test('collapsed default: narrow collapsed, wide open, stored value wins', () => {
  assert.equal(defaultCollapsed(375), true);
  assert.equal(defaultCollapsed(1200), false);
  const store = (v) => ({ getItem: (k) => (k === PANEL_COLLAPSED_KEY ? v : null) });
  assert.equal(readCollapsed(store(null), 375), true);
  assert.equal(readCollapsed(store('0'), 375), false);
  assert.equal(readCollapsed(store('1'), 1200), true);
  assert.equal(readCollapsed({ getItem() { throw new Error('x'); } }, 1200), false);
});

test('panel: header toggles and persists, sections follow the mode, parts refuse the last one', () => {
  const saved = {};
  globalThis.localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } };
  const changes = [];
  const panel = createStylePanel({ mode: 'terrain', width: 1200, parts: { state: defaultParts(), onChange: (s) => changes.push(s), onRefuse() {} } });
  const [head, body] = panel.el.children;
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  head.click();
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(body.hidden, true);
  assert.equal(saved[PANEL_COLLAPSED_KEY], '1');
  assert.equal(panel.isEmpty(), false);
  panel.setMode('ring');
  assert.equal(panel.isEmpty(), true);
  panel.setMode('bars');
  assert.equal(panel.isEmpty(), false);
  assert.equal(head.textContent, panelTitle('bars'));
  panel.toggles.pills.get('freq.bass').click();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].freq.bass, false);
});

test('dock and debug status keep at least an 8px left offset (safe-area aware)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../viz.css', import.meta.url), 'utf8');
  const dock = css.split('\n').find((l) => l.startsWith('.viz-dock {'));
  assert.match(dock, /left: max\(8px, env\(safe-area-inset-left\)\)/);
  const sig = readFileSync(new URL('./viz-signal.js', import.meta.url), 'utf8');
  assert.match(sig, /left: 'max\(8px, env\(safe-area-inset-left\)\)'/);
});
