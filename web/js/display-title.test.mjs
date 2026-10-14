import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';
import { displayTitle, displayString } from './display-title.js';

installDom();

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

import { remixTooltip, titleNodes } from './display-title.js';

test('remix year goes into the tooltip of the remix part only', () => {
  const song = { title: 'Song', remixer: 'Kav Verhouzer Remix', remix_year: 2024 };
  assert.equal(remixTooltip(song), 'Kav Verhouzer Remix (2024)');
  assert.equal(displayString(song), 'Song (Kav Verhouzer Remix)');
  assert.deepEqual(displayTitle(song), { title: 'Song', remix: 'Kav Verhouzer Remix' });
  assert.equal(remixTooltip({ ...song, remix_year: null }), 'Kav Verhouzer Remix');
  assert.equal(remixTooltip({ title: 'Song', remix_year: 2024 }), '');
});

test('titleNodes puts a real space between title and remix', () => {
  const nodes = titleNodes({ title: 'Song', remixer: 'Kav' });
  assert.equal(nodes.length, 3);
  assert.equal(nodes.map((n) => n.textContent).join(''), 'Song (Kav)');
  assert.equal(nodes[1].textContent, ' ');
  assert.equal(titleNodes({ title: 'Song' }).length, 1);
});
