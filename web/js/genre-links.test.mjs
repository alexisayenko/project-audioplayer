import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

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
stubFetch((u) => (u.includes('vocabulary') ? { body: vocab } : { body: { songs: SONGS } }));
const { shownSourceLinks } = await import('./genre-source-links.js');
const { renderGenresRework } = await import('./genres-rework.js');

test('shownSourceLinks keeps Wikipedia, Apple Music and Discogs in that order and drops unsafe urls', () => {
  assert.deepEqual(shownSourceLinks(LINKS).map((l) => [l.label, l.kind]), [['Wikipedia', 'page'], ['Apple Music', 'search'], ['Discogs', 'search'], ['Rate Your Music', 'page']]);
  assert.deepEqual(shownSourceLinks([{ source: 'wikipedia', url: 'javascript:alert(1)' }]), []);
  assert.deepEqual(shownSourceLinks(undefined), []);
});

test('selecting a genre shows its three source links in new tabs; a genre without links shows none', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  renderGenresRework(root, { view: 'radial' });
  await flush();
  const bar = root.querySelector('.gmr-links');
  assert.equal(bar.hidden, true);
  const rows = root.querySelectorAll('[role="treeitem"]');
  const rowOf = (name) => rows.find((r) => r.querySelector('.gmr-name').textContent === name);
  rowOf('house').click();
  await flush();
  const links = bar.querySelectorAll('a');
  assert.deepEqual(links.map((a) => a.textContent), ['Wikipedia', 'Apple Music', 'Discogs', 'Rate Your Music']);
  assert.ok(links.every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel').includes('noopener')));
  assert.equal(links[0].getAttribute('href'), 'https://en.wikipedia.org/wiki/House_music');
  assert.equal(bar.hidden, false);
  const rows2 = root.querySelectorAll('[role="treeitem"]');
  rows2.find((r) => r.querySelector('.gmr-name').textContent === 'deep house')?.click();
  await flush();
  assert.equal(bar.hidden, true);
});
