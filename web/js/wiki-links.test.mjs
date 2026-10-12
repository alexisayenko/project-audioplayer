import assert from 'node:assert/strict';
import { isWikiLink, songLinks, lookupSummary } from './wiki-links.js';

assert.ok(isWikiLink('https://en.wikipedia.org/wiki/Daft_Punk'));
assert.ok(isWikiLink('https://www.wikidata.org/wiki/Q42'));
assert.ok(!isWikiLink('https://evil.example/wiki/X'));
assert.ok(!isWikiLink('http://en.wikipedia.org/wiki/X'));
assert.ok(!isWikiLink('https://en.wikipedia.org.evil.example/wiki/X'));
assert.ok(!isWikiLink(''));

const full = { source_url: 'https://www.youtube.com/watch?v=abcdefghijk', wikipedia_song: 'https://en.wikipedia.org/wiki/A', wikipedia_artist: 'https://de.wikipedia.org/wiki/B' };
assert.deepEqual(songLinks(full).map((l) => l.label), ['Source', 'Wikipedia (song)', 'Wikipedia (band)']);
assert.deepEqual(songLinks({ ...full, wikipedia_song: null }).map((l) => l.label), ['Source', 'Wikipedia (band)']);
assert.deepEqual(songLinks({ source_url: 'javascript:alert(1)', wikipedia_song: 'javascript:alert(1)' }), []);
assert.deepEqual(songLinks({}), []);

assert.equal(lookupSummary({ tags: ['a', 'b'] }, 1997), 'Found: year 1997, 2 suggested tags.');
assert.equal(lookupSummary({ tags: ['a'] }, null), 'Found: 1 suggested tag.');
assert.equal(lookupSummary({ tags: [] }, null), 'Nothing found for these links.');
console.log('wiki-links ok');
