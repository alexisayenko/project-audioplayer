import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWikiLink, wikiTarget, wikiDisplay, wikiNormalize } from './wiki-links.js';

test('wiki-links', () => {
  assert.ok(isWikiLink('https://en.wikipedia.org/wiki/Daft_Punk'));
  assert.ok(isWikiLink('https://www.wikidata.org/wiki/Q42'));
  assert.ok(!isWikiLink('https://evil.example/wiki/X'));
  assert.ok(!isWikiLink('http://en.wikipedia.org/wiki/X'));
  assert.ok(!isWikiLink('https://en.wikipedia.org.evil.example/wiki/X'));
  assert.ok(!isWikiLink(''));

  const full = { source_url: 'https://www.youtube.com/watch?v=abcdefghijk', wikipedia_song: 'https://en.wikipedia.org/wiki/A', wikipedia_artist: 'https://de.wikipedia.org/wiki/B' };
  assert.deepEqual(wikiTarget(full), { href: full.wikipedia_song, label: 'Song on Wikipedia' });
  assert.deepEqual(wikiTarget({ ...full, wikipedia_song: null, wikipedia_album: 'https://en.wikipedia.org/wiki/Al' }), { href: 'https://en.wikipedia.org/wiki/Al', label: 'Album on Wikipedia' });
  assert.deepEqual(wikiTarget({ ...full, wikipedia_song: null }), { href: full.wikipedia_artist, label: 'Artist on Wikipedia' });
  assert.deepEqual(wikiTarget({ ...full, wikipedia_song: 'javascript:alert(1)' }), { href: full.wikipedia_artist, label: 'Artist on Wikipedia' });
  assert.equal(wikiTarget({ source_url: 'javascript:alert(1)', wikipedia_song: 'javascript:alert(1)' }), null);
  assert.equal(wikiTarget({}), null);
  assert.equal(wikiTarget(null), null);

  assert.equal(wikiDisplay('https://en.wikipedia.org/wiki/Bawitdaba_(song)'), 'Bawitdaba (song)');
  assert.equal(wikiDisplay('http://m.en.wikipedia.org/wiki/Daft_Punk'), 'Daft Punk');
  assert.equal(wikiDisplay('https://en.m.wikipedia.org/wiki/Daft_Punk#History'), 'Daft Punk');
  assert.equal(wikiDisplay('https://en.wikipedia.org/wiki/Se%C3%A1n_Paul?x=1'), 'Seán Paul');
  assert.equal(wikiDisplay('https://en.wikipedia.org/wiki/100%_Pure'), '100% Pure');
  assert.equal(wikiDisplay('https://de.wikipedia.org/wiki/X'), 'https://de.wikipedia.org/wiki/X');
  assert.equal(wikiDisplay('https://www.wikidata.org/wiki/Q42'), 'https://www.wikidata.org/wiki/Q42');
  assert.equal(wikiDisplay(null), '');
  assert.equal(wikiNormalize('  '), '');
  assert.equal(wikiNormalize('Daft Punk'), 'https://en.wikipedia.org/wiki/Daft_Punk');
  assert.equal(wikiNormalize('Bawitdaba (song)'), 'https://en.wikipedia.org/wiki/Bawitdaba_(song)');
  assert.equal(wikiNormalize('Seán'), 'https://en.wikipedia.org/wiki/Se%C3%A1n');
  assert.equal(wikiNormalize('AC/DC'), 'https://en.wikipedia.org/wiki/AC/DC');
  assert.equal(wikiNormalize('Who? #1'), 'https://en.wikipedia.org/wiki/Who%3F_%231');
  assert.equal(wikiNormalize(' https://www.wikidata.org/wiki/Q42 '), 'https://www.wikidata.org/wiki/Q42');
  for (const u of ['https://en.wikipedia.org/wiki/Se%C3%A1n_Paul', 'https://en.wikipedia.org/wiki/Bawitdaba_(song)']) assert.equal(wikiNormalize(wikiDisplay(u)), u);
  assert.ok(isWikiLink(wikiNormalize('Daft Punk')));

  console.log('wiki-links ok');
});
