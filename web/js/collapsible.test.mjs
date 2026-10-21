import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { loadCollapsed, saveCollapsed, toggleCollapsed, createCollapsible, PANEL_KEYS } = await import('./collapsible.js');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };

test('default expanded on wide screens, collapsed on narrow first visit', () => {
  assert.equal(loadCollapsed(mem(), 'k', 1200), false);
  assert.equal(loadCollapsed(mem(), 'k', 479), true);
  assert.equal(loadCollapsed(mem(), 'k', 480), false);
});

test('stored value wins over the width default', () => {
  const s = mem();
  saveCollapsed(s, 'k', false);
  assert.equal(loadCollapsed(s, 'k', 360), false);
  saveCollapsed(s, 'k', true);
  assert.equal(loadCollapsed(s, 'k', 1200), true);
});

test('bad or missing storage never throws', () => {
  assert.equal(loadCollapsed(bad, 'k', 1200), false);
  assert.equal(loadCollapsed(bad, 'k', 300), true);
  assert.equal(saveCollapsed(bad, 'k', true), false);
  assert.equal(loadCollapsed(undefined, 'k', 1200), false);
  assert.equal(toggleCollapsed(true), false);
});

test('panel keys', () => {
  assert.deepEqual(Object.values(PANEL_KEYS), ['ap2.panel.stats', 'ap2.panel.genres', 'ap2.panel.genreInfo', 'ap2.panel.links']);
});

test('chevron button carries aria state and toggles', () => {
  const seen = [];
  const c = createCollapsible({ id: 'x-body', content: [], onToggle: (v) => seen.push(v) });
  assert.equal(c.button.getAttribute('aria-controls'), 'x-body');
  assert.equal(c.button.getAttribute('aria-expanded'), 'true');
  assert.equal(c.button.getAttribute('aria-label'), 'Collapse panel');
  c.button.click();
  assert.equal(c.button.getAttribute('aria-expanded'), 'false');
  assert.equal(c.button.getAttribute('aria-label'), 'Expand panel');
  assert.ok(c.root.classList.contains('collapsed'));
  c.button.click();
  assert.deepEqual(seen, [true, false]);
  assert.equal(createCollapsible({ id: 'y', content: [], collapsed: true }).button.getAttribute('aria-expanded'), 'false');
});
