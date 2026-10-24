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
  assert.match(css, /^\s+\.side-toggle \{ margin-right: calc\(-1 \* \(var\(--space-4\) \+ var\(--stroke-hairline\) \/ 2 \+ var\(--control-sm\) \/ 2\)\); \}/m);
  assert.doesNotMatch(css, /side-collapsed \.side-toggle \{[^}]*margin/);
  assert.match(r, /margin-block: 0 calc\(-1 \* var\(--control-sm\)\)/);
});

test('the toggle sits one space-2 below the brand block and takes no height; the open sidebar and the rail share one first-item offset, 12px under the brand block', () => {
  assert.match(css, /^\.side \{[^}]*gap: var\(--space-2\)/m);
  assert.match(css, /#nav \{[^}]*gap: var\(--space-2\)/);
  assert.match(css, /\.side \{ --side-lockup-gap: var\(--space-3\);/);
  assert.match(css, /#nav \{ gap: var\(--space-1\); margin-top: calc\(var\(--side-lockup-gap\) - 2 \* var\(--space-2\) - var\(--space-1\)\); \}/);
  assert.doesNotMatch(rule('body.side-collapsed .side'), /--side-lockup-gap/);
  assert.equal(rule('body.side-collapsed #nav'), '');
  assert.equal(rule('body.side-collapsed .side-toggle'), '');
});

test('the sidebar itself does not clip, so the toggle can sit half outside it', () => {
  assert.doesNotMatch(css, /^\s*\.side \{ overflow: hidden; \}/m);
  assert.match(css, /\.brand, #nav a, \.build-line \{ overflow: hidden; \}/);
});

test('the toggle exists only from 720px', () => {
  assert.match(css, /^\.side-toggle \{ display: none; \}/m);
});

test('the open sidebar has the tight proposal top and the 1.5x lockup, the rail shares its vertical layout: same top padding, same 48px brand block, same mark', () => {
  assert.match(rule('body.side-collapsed .side'), /padding-inline: var\(--space-2\)/);
  assert.doesNotMatch(rule('body.side-collapsed .side'), /padding:/);
  assert.match(css, /^\s*\.side \{ --side-lockup-gap: var\(--space-3\); padding: var\(--space-2\) var\(--space-4\) var\(--space-4\); \}/m);
  assert.doesNotMatch(css, /has-mini:not\(\.side-collapsed\) \.side \{ padding-bottom/);
  assert.match(css, /\.brand \{ flex: none; align-items: flex-start; padding: 0 0 0 var\(--space-2\); \}/);
  assert.match(css, /\.brand-lockup \{ gap: var\(--space-1\); \}/);
  assert.match(rule('.brand-mark .ic'), /width: calc\(var\(--icon-nav\) \* 1\.5\); height: calc\(var\(--icon-nav\) \* 1\.5\)/);
  assert.equal(rule('body.side-collapsed .brand-mark .ic'), '');
  assert.match(rule('.brand-wordmark'), /display: block; flex: none; height: calc\(var\(--icon-button\) \* 1\.5\); margin-left: 0/);
  const hidden = rule('body.side-collapsed .brand .brand-wordmark');
  assert.match(hidden, /display: block/);
  assert.match(hidden, /visibility: hidden/);
  assert.doesNotMatch(hidden, /height:/);
  assert.match(hidden, /max-width: 0/);
  assert.doesNotMatch(hidden, /display: none/);
  assert.match(hidden, /padding: 0/);
  assert.match(rule('body.side-collapsed .brand'), /padding: 0;/);
  assert.match(rule('body.side-collapsed .build-line:not([hidden])'), /display: block; visibility: hidden; white-space: nowrap/);
});
