import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('every stylesheet in web/ is linked from index.html', () => {
  const dir = new URL('../', import.meta.url);
  const html = readFileSync(new URL('index.html', dir), 'utf8');
  const linked = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
  assert.deepEqual(files.filter((f) => !linked.includes(f)), []);
});
