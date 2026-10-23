import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const rule = (sel) => (css.match(new RegExp(`^[ \\t]+${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) || [])[1] || '';

test('the sidebar toggle is a small rounded-square surface button straddling the sidebar edge', () => {
  const r = rule('.side-toggle');
  assert.match(r, /width: var\(--control-sm\)/);
  assert.match(r, /border-radius: var\(--radius-sm\)/);
  assert.match(r, /background-color: var\(--surface\)/);
  assert.match(r, /border: var\(--stroke-hairline\) solid var\(--line\)/);
  assert.match(rule('body:not(.side-collapsed) .side-toggle'), /margin-right: calc\(-1 \* \(var\(--space-4\)/);
  assert.match(rule('body.side-collapsed .side-toggle'), /margin-right: calc\(-1 \* \(var\(--space-2\)/);  assert.match(r, /margin-block: 0 calc\(-1 \* var\(--space-1\)\)/);
});

test('the toggle sits one space-2 below the brand block and one space-1 above the first menu item, in both states', () => {
  assert.match(css, /^\.side \{[^}]*gap: var\(--space-2\)/m);
  assert.match(css, /#nav \{[^}]*gap: var\(--space-2\)/);
  assert.doesNotMatch(rule('body.side-collapsed .side-toggle'), /margin-block/);
  assert.doesNotMatch(rule('body:not(.side-collapsed) .side-toggle'), /margin-block/);
});

test('the sidebar itself does not clip, so the toggle can sit half outside it', () => {
  assert.doesNotMatch(css, /^\s*\.side \{ overflow: hidden; \}/m);
  assert.match(css, /\.brand, #nav a, \.build-line \{ overflow: hidden; \}/);
});

test('the toggle exists only from 720px', () => {
  assert.match(css, /^\.side-toggle \{ display: none; \}/m);
});

test('collapsed and expanded sidebars share vertical padding and keep the brand wordmark box so nothing moves', () => {
  assert.match(rule('body.side-collapsed .side'), /padding: var\(--space-6\) var\(--space-2\)/);
  assert.match(css, /^\s*\.side \{ padding: var\(--space-6\) var\(--space-4\); \}/m);
  const hidden = rule('body.side-collapsed .brand .brand-wordmark');
  assert.match(hidden, /display: block/);
  assert.match(hidden, /visibility: hidden/);
  assert.match(hidden, /max-width: 0/);
  assert.doesNotMatch(hidden, /display: none/);
  assert.match(hidden, /padding: 0/);
  assert.match(rule('body.side-collapsed .brand'), /padding: var\(--space-1\) 0 0/);
});
