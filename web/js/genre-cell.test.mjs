import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genreText } from './genre-cell.js';

test('joins genre values only', () => {
  assert.equal(genreText(['genre:rock', 'country:de', 'genre:post-punk', 'mood:calm']), 'rock, post-punk');
});
test('empty when none', () => {
  assert.equal(genreText([]), '');
  assert.equal(genreText(undefined), '');
  assert.equal(genreText(['genre:', 'lang:en']), '');
});
