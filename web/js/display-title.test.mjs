import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTitle, displayString } from './display-title.js';

test('empty or missing remix gives no parenthesis', () => {
  assert.deepEqual(displayTitle({ title: 'Song', remixer: '' }), { title: 'Song', remix: '' });
  assert.deepEqual(displayTitle({ title: 'Song' }), { title: 'Song', remix: '' });
  assert.deepEqual(displayTitle({ title: 'Song', remixer: '  ' }), { title: 'Song', remix: '' });
  assert.equal(displayString({ title: 'Song', remixer: null }), 'Song');
  assert.equal(displayString(null), '');
});

test('single and multiple tokens', () => {
  assert.equal(displayString({ title: 'Song', remixer: 'Kav Verhouzer' }), 'Song (Kav Verhouzer)');
  assert.equal(displayString({ title: 'Song', remixer: 'A - B | C' }), 'Song (A, B, C)');
  assert.equal(displayString({ title: 'Song', remixer: 'Earth, Wind & Fire' }), 'Song (Earth, Wind & Fire)');
});

test('text already in the title is not repeated', () => {
  assert.equal(displayString({ title: 'Song (Kav Verhouzer Remix)', remixer: 'Kav Verhouzer' }), 'Song (Kav Verhouzer Remix)');
  assert.equal(displayString({ title: 'Song (Kav Verhouzer Remix)', remixer: 'kav  verhouzer!' }), 'Song (Kav Verhouzer Remix)');
  assert.equal(displayString({ title: 'Song (Kav Verhouzer Remix)', remixer: 'Kav Verhouzer - Bob' }), 'Song (Kav Verhouzer Remix) (Bob)');
});

test('Cyrillic and parentheses in the title', () => {
  assert.equal(displayString({ title: 'Песня', remixer: 'Ремиксер - Другой' }), 'Песня (Ремиксер, Другой)');
  assert.equal(displayString({ title: 'Песня (Ремиксер ремикс)', remixer: 'РЕМИКСЕР' }), 'Песня (Ремиксер ремикс)');
  assert.equal(displayString({ title: 'Song (Live)', remixer: 'X' }), 'Song (Live) (X)');
});
