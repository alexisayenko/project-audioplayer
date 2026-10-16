import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const SEL = '.mini-keys .key.ghost.on';

test('selected toggle has a transparent interior and no later background override', () => {
  const at = css.indexOf(`${SEL} {`);
  assert.ok(at >= 0, 'selected toggle rule exists');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  assert.match(body, /background(-color)?:\s*transparent/);
  assert.match(body, /,\s*0 0 [1-9]\d*px color-mix\(in srgb, var\(--fill\) 25%, transparent\)/, 'faint outer glow at 25%');
  assert.doesNotMatch(body, /inset 0 0 [1-9]\d*px/, 'no inset glow');
  const after = css.slice(css.indexOf('}', at) + 1);
  for (const m of after.matchAll(/([^{}]*\.key\.ghost\.on[^{}]*)\{([^}]*)\}/g)) {
    if (m[1].includes('@media')) continue;
    if (/:hover/.test(m[1])) continue;
    assert.doesNotMatch(m[2], /background/, `later rule ${m[1].trim()} sets a background`);
  }
});

test('slider thumbs (seek and volume, both engines) carry the 1px accent border like the selected toggles', () => {
  const rules = [...css.matchAll(/^(\.scrub-thumb|\.slider::-webkit-slider-thumb|\.slider::-moz-range-thumb) \{([^}]*)\}/gm)];
  assert.equal(rules.length, 3);
  for (const m of rules) assert.match(m[2], /border:\s*var\(--stroke-hairline\) solid var\(--fill\)/, m[1]);
});

test('cover play/pause overlay is centred on the cover box: no override of the base centring margins', () => {
  const base = css.match(/^\.rc-ov \{([^}]*)\}/m)[1];
  assert.match(base, /left: 50%; top: 50%/);
  assert.match(base, /margin: calc\(var\(--rc\) \/ -2\) 0 0 calc\(var\(--rc\) \/ -2\)/);
  const over = css.match(/^\.cover-btn \.rc-ov \{([^}]*)\}/m)[1];
  assert.doesNotMatch(over, /margin|top|left|transform/);
});
