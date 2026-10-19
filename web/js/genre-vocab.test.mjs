import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, resolveGenre, searchGenres, didYouMean, unknownGenre, vkey } from './genre-vocab.js';
import { ApiError } from './api.js';

const row = (name, family = 'Rock', level = 'genre') => ({ name, family, level, parents: [family], extra: false });
const idx = buildIndex({
  genres: [row('rock', 'Rock', 'genre'), row('hip hop', 'Hip Hop', 'genre'), row('house', 'Electronic'), row('drum and bass', 'Electronic'), row('rhythm & blues', 'Funk / Soul'), row('progressive house', 'Electronic'), row('synth-pop', 'Pop')],
  aliases: { dnb: 'drum and bass', 'drum n bass': 'drum and bass', ghost: 'not in list' },
});

test('vkey ignores case, spaces, hyphens, accents and and/&', () => {
  assert.equal(vkey('Rhythm & Blues'), vkey('rhythm and blues'));
  assert.equal(vkey('Synth-Pop'), vkey('synth pop'));
  assert.equal(vkey('Électro'), 'electro');
});

test('resolveGenre: canonical, variant, alias, trailing music, unknown', () => {
  assert.equal(resolveGenre('  Hip-Hop ', idx).name, 'hip hop');
  assert.equal(resolveGenre('synth pop', idx).name, 'synth-pop');
  assert.equal(resolveGenre('DNB', idx).name, 'drum and bass');
  assert.equal(resolveGenre('house music', idx).name, 'house');
  assert.equal(resolveGenre('rhythm and blues', idx).name, 'rhythm & blues');
  assert.equal(resolveGenre('ghost', idx), null);
  assert.equal(resolveGenre('', idx), null);
  assert.equal(resolveGenre('rock', null), null);
});

test('searchGenres: prefix first, then word, then inside; chosen excluded; aliases appended', () => {
  assert.deepEqual(searchGenres('hou', idx).map((e) => e.name), ['house', 'progressive house']);
  assert.deepEqual(searchGenres('house', idx, ['house']).map((e) => e.name), ['progressive house']);
  assert.deepEqual(searchGenres('dn', idx).map((e) => e.name), ['drum and bass']);
  assert.deepEqual(searchGenres('', idx), []);
});

test('didYouMean: typos come back close first, nothing for noise', () => {
  assert.equal(didYouMean('rok', idx)[0], 'rock');
  assert.ok(didYouMean('hous', idx).includes('house'));
  assert.ok(didYouMean('hip-hap', idx).includes('hip hop'));
  assert.deepEqual(didYouMean('qqqqzzzz', idx), []);
  assert.deepEqual(didYouMean('rok', null), []);
  assert.ok(didYouMean('hous', idx, 5, ['house']).every((n) => n !== 'house'));
});

test('unknownGenre reads the 422 of a rejected save', () => {
  const e = new ApiError(422, 'Unknown genre: rok. Did you mean: rock?', 'unknown_genre');
  e.data = { error: 'unknown_genre', value: 'rok', suggestions: ['rock'] };
  assert.deepEqual(unknownGenre(e), { value: 'rok', suggestions: ['rock'] });
  assert.equal(unknownGenre(new ApiError(500, 'x')), null);
  assert.equal(unknownGenre(new Error('x')), null);
});
