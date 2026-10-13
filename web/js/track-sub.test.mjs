import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackSub } from './track-sub.js';

test('trackSub', () => {
  assert.equal(trackSub({ artist: 'Kato', year: 2010 }), 'Kato · 2010');
  assert.equal(trackSub({ artist: 'Kato', year: null }), 'Kato');
  assert.equal(trackSub({ artist: '', year: 2010 }), '2010');
  assert.equal(trackSub({ artist: null, year: null }), '');
  assert.equal(trackSub({ artist: '  ', year: '  ' }), '');
  assert.equal(trackSub({ artist: ' Kato ', year: 1999 }), 'Kato · 1999');
  assert.equal(trackSub({}), '');
});
