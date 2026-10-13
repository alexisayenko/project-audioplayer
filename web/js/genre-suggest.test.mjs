import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestGenres, matchRange } from './genre-suggest.js';

const all = ['synthpop', 'pop', 'indie pop', 'k-pop', 'popular', 'rock', 'pop rock', 'drum and bass', 'bossa nova', 'électro', 'hip hop', 'trip hop', 'soul'];

test('genre-suggest', () => {
  assert.deepEqual(suggestGenres('', all), []);
  assert.deepEqual(suggestGenres('   ', all), []);
  assert.deepEqual(suggestGenres('po', all), ['pop', 'popular', 'pop rock', 'indie pop', 'k-pop', 'synthpop']);
  assert.deepEqual(suggestGenres('pop', all, ['pop']), ['popular', 'pop rock', 'indie pop', 'k-pop', 'synthpop']);
  assert.deepEqual(suggestGenres('POP', all, ['POP']).includes('pop'), false);
  assert.deepEqual(suggestGenres('electro', all), ['électro']);
  assert.deepEqual(suggestGenres('ÉLE', all), ['électro']);
  assert.equal(suggestGenres('o', all).length, 6);
  assert.deepEqual(suggestGenres('hop', ['trip hop', 'hip hop', 'shophop']), ['trip hop', 'hip hop', 'shophop']);
  assert.deepEqual(suggestGenres('x', null), []);
  assert.deepEqual(suggestGenres('pop', ['pop', 'Pop']), ['pop']);
});

test('matchRange', () => {
  assert.deepEqual(matchRange('indie pop', 'pop'), [6, 9]);
  assert.equal(matchRange('rock', 'zz'), null);
  assert.equal(matchRange('rock', ''), null);
});
