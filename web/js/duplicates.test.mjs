import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';
import { findDuplicates, normText, summary, titleKey } from './duplicates.js';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
globalThis.location = { hash: '', href: 'http://localhost/', host: 'x' };

const s = (id, title, duration, extra = {}) => ({ id, title, artist: 'A', duration, ...extra });
const ids = (groups) => groups.map((g) => g.map((x) => x.id));

test('length only: within tolerance groups, outside does not', () => {
  const songs = [s('a', 'One', 200), s('b', 'Two', 209), s('c', 'Three', 211), s('d', 'Four', 400)];
  assert.deepEqual(ids(findDuplicates(songs, { byTitle: false })), [['a', 'b']]);
  assert.deepEqual(ids(findDuplicates(songs, { byTitle: false, tolerance: 11 })), [['a', 'b', 'c']]);
});

test('no chaining: a group spans at most the tolerance from its first song', () => {
  const songs = [s('a', 'a', 100), s('b', 'b', 108), s('c', 'c', 116), s('d', 'd', 124)];
  assert.deepEqual(ids(findDuplicates(songs, { byTitle: false })), [['a', 'b'], ['c', 'd']]);
});

test('boundary is inclusive and the result is order independent', () => {
  const a = [s('x', 'x', 110), s('y', 'y', 100)];
  assert.deepEqual(ids(findDuplicates(a, { byTitle: false })), [['y', 'x']]);
  assert.deepEqual(ids(findDuplicates([...a].reverse(), { byTitle: false })), [['y', 'x']]);
});

test('unknown durations are ignored', () => {
  const songs = [s('a', 'a', 0), s('b', 'b', null), s('c', 'c', undefined), s('d', 'd', NaN)];
  assert.deepEqual(findDuplicates(songs, { byTitle: false }), []);
});

test('title match is on by default and normalises case, accents, punctuation and noise', () => {
  const songs = [s('a', 'Café del Mar', 200), s('b', 'cafe  del mar!', 205), s('c', 'Cafe Del Mar (Official Video)', 203), s('d', 'Other', 201)];
  assert.deepEqual(ids(findDuplicates(songs)), [['a', 'c', 'b']]);
  assert.deepEqual(ids(findDuplicates(songs, { byTitle: false })), [['a', 'd', 'c', 'b']]);
});

test('versions stay apart; a different bracket is not noise', () => {
  const v = (kind, name) => ({ version: { kind, name }, mainArtists: ['A'], title: 'Song' });
  const songs = [s('a', 'Song', 200, v('remix', 'X Remix')), s('b', 'Song', 201, v('live', 'Live')), s('c', 'Song (Live)', 202), s('d', 'Song (X Remix)', 203)];
  assert.notEqual(titleKey(songs[0]), titleKey(songs[1]));
  assert.notEqual(titleKey(s('p', 'Song (Live)', 1)), titleKey(s('q', 'Song', 1)));
});

test('empty titles never match by title; summary counts', () => {
  assert.deepEqual(findDuplicates([s('a', '', 100), s('b', '', 101)]), []);
  assert.deepEqual(summary([[1, 2], [3, 4, 5]]), { groups: 2, songs: 5 });
  assert.equal(normText('Ünï-cödé'), 'unicode'.replace('unicode', 'uni code'));
});

const { store } = await import('./store.js');
const { duplicatesCard } = await import('./duplicates-tool.js');

test('card: toggles, shows groups and total, empty state, switch re-runs', () => {
  store.songs = [s('a', 'Same', 200, { audio_state: 'server' }), s('b', 'Same', 205), s('c', 'Different', 202)];
  const card = duplicatesCard();
  document.body.append(card);
  const [toggle] = card.querySelectorAll('button');
  toggle.click();
  assert.match(card.textContent, /1 group, 2 songs/);
  assert.equal(card.querySelectorAll('.dup-song').length, 2);
  const box = card.querySelector('#dup-title');
  assert.equal(box.checked, true);
  box.checked = false;
  box.dispatchEvent(new Event('change'));
  assert.match(card.textContent, /1 group, 3 songs/);
  const tol = card.querySelector('#dup-tolerance');
  tol.value = '1';
  tol.dispatchEvent(new Event('input'));
  assert.match(card.textContent, /No duplicates found/);
  card.remove();
});
