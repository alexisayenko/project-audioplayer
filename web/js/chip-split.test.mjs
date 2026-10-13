import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAll, splitChips } from './chip-split.js';

test('splitAll splits on comma and slash', () => {
  assert.deepEqual(splitAll('rock/pop, jazz'), ['rock', 'pop', 'jazz']);
  assert.deepEqual(splitAll(' , / '), []);
  assert.deepEqual(splitAll('synth-pop'), ['synth-pop']);
});

test('splitChips commits finished parts and keeps the remainder', () => {
  assert.deepEqual(splitChips('rock/pop, ja'), { parts: ['rock', 'pop'], rest: 'ja' });
  assert.deepEqual(splitChips('rock'), { parts: [], rest: 'rock' });
  assert.deepEqual(splitChips('rock,'), { parts: ['rock'], rest: '' });
  assert.deepEqual(splitChips('a,b,c'), { parts: ['a', 'b'], rest: 'c' });
});
