import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeBuild } from './build-info.js';

const SHA = '68df2bf0123456789abcdef0123456789abcdef0';

test('shows the short sha and the deploy time in the viewer local time', () => {
  const d = new Date('2026-10-17T12:05:30Z');
  const v = describeBuild({ sha: SHA, committed_at: '2026-10-17T08:00:00Z', deployed_at: '2026-10-17T12:05:30Z' });
  const p = (n) => String(n).padStart(2, '0');
  assert.equal(v.text, `Build 68df2bf · deployed ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
  assert.equal(v.title, `Commit ${SHA}\ncommitted 2026-10-17 08:00 UTC\ndeployed 2026-10-17 12:05 UTC`);
});

test('missing or bad dates degrade to the sha alone', () => {
  const v = describeBuild({ sha: SHA, committed_at: null, deployed_at: 'garbage' });
  assert.equal(v.text, 'Build 68df2bf');
  assert.equal(v.title, `Commit ${SHA}`);
});

test('no build, null, or a bad sha shows nothing', () => {
  for (const raw of [undefined, null, 'x', {}, { sha: null }, { sha: 'not a sha' }]) assert.equal(describeBuild(raw), null);
});
