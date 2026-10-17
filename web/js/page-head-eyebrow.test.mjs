import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('the ELECTROPHONE line above page titles is hidden from 720px, where the sidebar shows the name', () => {
  assert.match(css, /@media \(min-width: 720px\) \{ \.page-head \.t-eyebrow \{ display: none; \} \}/);
});

test('below 480px the same line stays and carries the record mark', () => {
  const phone = css.match(/@media \(max-width: 479px\) \{\s*\.page-head \.t-eyebrow::before \{[^}]*\}/);
  assert.ok(phone, 'phone mark rule exists');
  assert.doesNotMatch(css, /@media \(max-width: 719px\) \{ \.page-head \.t-eyebrow \{ display: none/);
});
