import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, queryTokens } from './search-query.js';
import { songSearchText } from './search-text.js';

const maduk = { title: 'Ghost Assassin', mainArtists: ['Maduk'], featuredArtists: ['Veela'], version: { type: 'remix', name: 'VIP', artists: [] } };
const hay = songSearchText(maduk);
const m = (q, h = hay) => matchesQuery(h, q);

test('full "Artist - Title" string finds the song', () => {
  assert.ok(m('Maduk ft Veela - Ghost Assassin VIP'));
  assert.ok(m('Maduk feat. Veela - Ghost Assassin VIP'));
  assert.ok(m('Maduk featuring Veela – Ghost Assassin VIP'));
  assert.ok(m('Maduk ft. Veela — Ghost Assassin VIP'));
});

test('display form with the version in parentheses', () => {
  assert.ok(m('Maduk - Ghost Assassin (VIP)'));
  assert.ok(m('Maduk, Veela - Ghost Assassin (VIP)'));
});

test('ampersand and x/vs are separators', () => {
  const two = songSearchText({ title: 'Song', mainArtists: ['A', 'B'], featuredArtists: [] });
  assert.ok(m('a & b', two));
  assert.ok(m('A x B - Song', two));
  assert.ok(m('a vs b', two));
});

test('a token that is not in the song still fails', () => {
  assert.ok(!m('Maduk - Ghost Assassin Remix Zebra'));
  assert.ok(!m('Veela - Other Song'));
});

test('diacritics and case are ignored', () => {
  assert.ok(matchesQuery(songSearchText({ title: 'Café del Mar', mainArtists: ['Énergie'], featuredArtists: [] }), 'ENERGIE - cafe del mar'));
});

test('old behaviour kept: whole substring and noise-only queries', () => {
  assert.ok(m('ghost assa'));
  assert.ok(m(''));
  assert.ok(matchesQuery('a x b', 'x'));
  assert.deepEqual(queryTokens('A - B (ft. C)'), ['a', 'b', 'c']);
});
