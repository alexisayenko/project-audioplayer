import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const SEL = '.tray .key.ghost.on, .mini-keys .key.ghost.on';

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
