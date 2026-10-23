import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { VOCAB, SONGS } = await import('./genre-levels-fixture.mjs');
const LINKS = [
  { source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/House_music', kind: 'page' },
  { source: 'apple_music', url: 'https://music.apple.com/us/search?term=house', kind: 'search' },
  { source: 'spotify', url: 'https://open.spotify.com/search/house', kind: 'search' },
  { source: 'discogs', url: 'https://www.discogs.com/search/?style=house&type=release', kind: 'search' },
  { source: 'rym', url: 'https://rateyourmusic.com/genre/house/', kind: 'page' },
  { source: 'musicbrainz', url: 'https://musicbrainz.org/genre/x', kind: 'page' },
];
const vocab = { ...VOCAB, levels: { ...VOCAB.levels, house: { ...VOCAB.levels.house, source_links: LINKS }, 'deep house': { ...VOCAB.levels['deep house'], source_links: [{ source: 'wikipedia', url: 'javascript:alert(1)', kind: 'page' }] } } };
const { shownSourceLinks } = await import('./genre-source-links.js');

test('shownSourceLinks keeps Wikipedia and Rate Your Music in that order and drops unsafe urls', () => {
  assert.deepEqual(shownSourceLinks(LINKS).map((l) => [l.label, l.kind]), [['Wikipedia', 'page'], ['Rate Your Music', 'page']]);
  assert.deepEqual(shownSourceLinks([{ source: 'wikipedia', url: 'javascript:alert(1)' }]), []);
  assert.deepEqual(shownSourceLinks(undefined), []);
});
