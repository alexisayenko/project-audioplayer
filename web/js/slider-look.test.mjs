import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const rule = (sel) => {
  const at = css.indexOf(`\n${sel} {`);
  assert.ok(at >= 0, `${sel} rule exists`);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

test('slider focus is one ring that hugs the thumb, keyboard only, never a ring around a ring', () => {
  const rules = [...css.matchAll(/^:where\(html:not\(\[data-input="pointer"\]\)\) (\.scrubber:focus-visible \.scrub-thumb|\.slider:focus-visible::-webkit-slider-thumb|\.slider:focus-visible::-moz-range-thumb) \{([^}]*)\}/gm)];
  assert.equal(rules.length, 3);
  for (const m of rules) {
    assert.match(m[2], /outline:\s*var\(--stroke-focus\) solid var\(--ring-color\)/, m[1]);
    assert.match(m[2], /outline-offset:\s*0;/, m[1]);
    assert.doesNotMatch(m[2], /box-shadow/, m[1]);
  }
  assert.match(rule('.slider:focus-visible'), /outline:\s*none/);
});

test('thumbs keep their token size: 16px seek, 12px volume, no override on focus or press', () => {
  assert.match(css, /--thumb-seek: 16px|var\(--thumb-seek\)/);
  assert.doesNotMatch(css, /:focus-visible[^{]*(scrub-thumb|slider-thumb|range-thumb)[^{]*\{[^}]*(width|height|transform)/);
  assert.match(rule('.scrub-thumb'), /width: var\(--thumb-seek\); height: var\(--thumb-seek\)/);
  assert.match(rule('.slider::-webkit-slider-thumb'), /width: var\(--thumb-volume\); height: var\(--thumb-volume\)/);
});

test('dock time readout reserves only the current song format, left-aligned, set by --time-ch', () => {
  const src = readFileSync(new URL('./player-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fitElapsed/);
  assert.match(src, /setProperty\('--time-ch'/);
  assert.match(css, /\.mini-foot \.t-time \{ flex: none; --time-ch: 4; --time-neg: 0; width: calc\(\(var\(--time-ch\) \* 2 \+ var\(--time-neg\) \+ 3\) \* 1ch\); text-align: left; \}/);
  assert.match(css, /\.mini-foot \.t-elapsed \{ width: calc\(\(var\(--time-ch\) \+ var\(--time-neg\)\) \* 1ch\); min-width: 0; text-align: left; \}/);
  assert.match(css, /\.mini-foot #mini-dur \{ display: inline-block; width: calc\(\(var\(--time-ch\) \+ 3\) \* 1ch\); white-space: pre; text-align: left; \}/);
});
