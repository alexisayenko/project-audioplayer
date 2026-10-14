import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanTitle, cleanTitleEx } from './title-clean.js';

const CASES = JSON.parse(readFileSync(new URL('../../server/tests/fixtures/title_clean_cases.json', import.meta.url), 'utf8'));

test('enough cases', () => assert.ok(CASES.length >= 40));

for (const [raw, want] of CASES) {
  test(`clean ${JSON.stringify(raw)}`, () => {
    assert.equal(cleanTitle(raw), want);
    assert.equal(cleanTitle(want), want);
  });
}

test('removed pieces', () => {
  assert.deepEqual(cleanTitleEx('De Hofnar - Zonnestraal [Free Download]'), { title: 'De Hofnar - Zonnestraal', removed: ['[Free Download]'] });
  assert.deepEqual(cleanTitleEx('[Free Download]'), { title: '[Free Download]', removed: [] });
});

test('trailing and leading separators trimmed, long whitespace runs stay fast', () => {
  assert.equal(cleanTitle('Artist - Track (Official Video) | - '), 'Artist - Track');
  const t0 = Date.now();
  assert.equal(cleanTitle(`Artist${' '.repeat(50000)}x`), 'Artist x');
  assert.ok(Date.now() - t0 < 1000);
});
