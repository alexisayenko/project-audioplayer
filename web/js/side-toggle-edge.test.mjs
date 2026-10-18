import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const rule = (sel) => (css.match(new RegExp(`^[ \\t]+${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) || [])[1] || '';

test('the sidebar toggle is a small round surface button straddling the sidebar edge', () => {
  const r = rule('.side-toggle');
  assert.match(r, /width: var\(--control-sm\)/);
  assert.match(r, /border-radius: var\(--radius-pill\)/);
  assert.match(r, /background-color: var\(--surface\)/);
  assert.match(r, /border: var\(--stroke-hairline\) solid var\(--line\)/);
  assert.match(rule('body:not(.side-collapsed) .side-toggle'), /margin-right: calc\(-1 \* \(var\(--space-4\)/);
  assert.match(rule('body.side-collapsed .side-toggle'), /margin-right: calc\(-1 \* \(var\(--space-2\)/);
});

test('the sidebar itself does not clip, so the toggle can sit half outside it', () => {
  assert.doesNotMatch(css, /^\s*\.side \{ overflow: hidden; \}/m);
  assert.match(css, /\.brand, #nav a, \.server, \.build-line \{ overflow: hidden; \}/);
});

test('the toggle exists only from 720px', () => {
  assert.match(css, /^\.side-toggle \{ display: none; \}/m);
});
