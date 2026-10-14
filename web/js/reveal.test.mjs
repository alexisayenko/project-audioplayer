import test from 'node:test';
import assert from 'node:assert/strict';
import { findRowIndex, scrollTarget } from './reveal.js';

test('findRowIndex', () => {
  const songs = [{ id: 'a' }, { id: 'b' }];
  assert.equal(findRowIndex(songs, 'b'), 1);
  assert.equal(findRowIndex(songs, 'z'), -1);
  assert.equal(findRowIndex([], 'a'), -1);
});

test('scrollTarget centres the row', () => {
  assert.equal(scrollTarget({ rowTop: 900, rowHeight: 56, scrollY: 100, viewportH: 800, docH: 5000 }), 628);
});

test('scrollTarget clamps to the document', () => {
  assert.equal(scrollTarget({ rowTop: 10, rowHeight: 56, scrollY: 0, viewportH: 800, docH: 5000 }), 0);
  assert.equal(scrollTarget({ rowTop: 700, rowHeight: 56, scrollY: 4000, viewportH: 800, docH: 5000 }), 4200);
  assert.equal(scrollTarget({ rowTop: 100, rowHeight: 56, scrollY: 0, viewportH: 800, docH: 500 }), 0);
});
