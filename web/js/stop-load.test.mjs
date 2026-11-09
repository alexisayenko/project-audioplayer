import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillLoading, stopLoading, switchMode } from './stop-load.js';

function fakeAudio({ src = '/files/a', duration = 360, bufferedEnd = 90 } = {}) {
  const calls = [];
  const a = {
    calls,
    duration,
    buffered: bufferedEnd == null ? { length: 0 } : { length: 1, end: () => bufferedEnd },
    getAttribute: (k) => (k === 'src' ? a.srcAttr : null),
    removeAttribute: (k) => { calls.push(`remove ${k}`); if (k === 'src') a.srcAttr = null; },
    load: () => calls.push('load'),
    srcAttr: src,
  };
  return a;
}

test('PLY-214: a song that is still downloading is stopped: the source is removed and load() ends the request', () => {
  const a = fakeAudio();
  assert.equal(stillLoading(a), true);
  assert.equal(stopLoading(a, 'auto'), true);
  assert.deepEqual(a.calls, ['remove src', 'load']);
});

test('PLY-214: a complete song, an element without a source, and mode off are left to the source change', () => {
  const done = fakeAudio({ bufferedEnd: 359.8 });
  assert.equal(stillLoading(done), false);
  assert.equal(stopLoading(done, 'auto'), false);
  assert.deepEqual(done.calls, []);
  const empty = fakeAudio({ src: null });
  assert.equal(stopLoading(empty, 'always'), false);
  const off = fakeAudio();
  assert.equal(stopLoading(off, 'off'), false);
  assert.deepEqual(off.calls, []);
});

test('PLY-214: mode always also stops a complete song; an unknown duration or an empty buffer counts as still loading', () => {
  const done = fakeAudio({ bufferedEnd: 360 });
  assert.equal(stopLoading(done, 'always'), true);
  assert.equal(stillLoading(fakeAudio({ duration: Number.NaN })), true);
  assert.equal(stillLoading(fakeAudio({ bufferedEnd: null })), true);
});

test('PLY-214: the mode is read from storage, auto when unset or unknown', () => {
  assert.equal(switchMode(() => null), 'auto');
  assert.equal(switchMode(() => 'always'), 'always');
  assert.equal(switchMode(() => 'off'), 'off');
  assert.equal(switchMode(() => 'nonsense'), 'auto');
});
