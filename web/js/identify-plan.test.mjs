import test from 'node:test';
import assert from 'node:assert/strict';
import { disabledReason, matchedText, sourcesText, statusLine, yearAction, linkPlan, suggestedTags } from './identify-plan.js';

test('disabledReason explains why the button is off', () => {
  assert.match(disabledReason({ id: null, audio: false }), /Save the song/);
  assert.match(disabledReason({ id: 'x', audio: false }), /Download the audio/);
  assert.match(disabledReason({ id: 'x', audio: true, available: { acoustid: false, discogs: false } }), /Not configured/);
  assert.equal(disabledReason({ id: 'x', audio: true, available: { acoustid: false, discogs: true } }), null);
  assert.equal(disabledReason({ id: 'x', audio: true }), null);
});

test('matched text shows artist, title and rounded percent', () => {
  assert.equal(matchedText({ artist: 'Daft Punk', title: 'Around the World', confidence: 0.974 }), 'Matched: Daft Punk - Around the World (97%)');
  assert.equal(matchedText({ title: 'T' }), 'Matched: T');
  assert.equal(matchedText(null), '');
});

test('status line combines match and sources', () => {
  const res = { status: 'ok', matched: { artist: 'A', title: 'T', confidence: 1 }, sources: ['acoustid', 'musicbrainz', 'discogs'] };
  assert.equal(statusLine(res), 'Matched: A - T (100%) · AcoustID, MusicBrainz, Discogs');
  assert.equal(statusLine({ status: 'ok', matched: null, sources: ['discogs'] }), 'Suggestions · Discogs');
  assert.equal(statusLine({ status: 'no_match' }), 'Nothing identified');
  assert.equal(statusLine({ status: 'unavailable' }), 'Not configured on the server');
  assert.equal(statusLine({ status: 'not_run' }), '');
  assert.equal(sourcesText(['x']), 'x');
});

test('year action is offered only when it differs', () => {
  assert.equal(yearAction({ suggested_year: 1997 }, ''), 1997);
  assert.equal(yearAction({ suggested_year: 1997 }, '1997'), null);
  assert.equal(yearAction({ suggested_year: 1997 }, 1997), null);
  assert.equal(yearAction({ suggested_year: null }, ''), null);
  assert.equal(yearAction({ suggested_year: '1997' }, ''), null);
});

test('link plan keeps http(s) links only and maps to song fields', () => {
  assert.deepEqual(linkPlan({ links: { musicbrainz: 'https://musicbrainz.org/recording/x', discogs: 'javascript:1', wikipedia_song: 'https://en.wikipedia.org/wiki/A', wikipedia_artist: null } }),
    { wikipedia_song: 'https://en.wikipedia.org/wiki/A', wikipedia_artist: null, wikipedia_album: null, musicbrainz_url: 'https://musicbrainz.org/recording/x', discogs_url: null });
  assert.equal(linkPlan({ links: {} }), null);
  assert.equal(linkPlan(null), null);
});

test('suggested tags keep only genre, country and lang', () => {
  assert.deepEqual(suggestedTags({ suggested_tags: ['genre:house', 'country:fr', 'lang:en', 'decade:90s', 'plain', 5] }), ['genre:house', 'country:fr', 'lang:en']);
  assert.deepEqual(suggestedTags({}), []);
});

test('linkPlan carries the album article', () => {
  assert.equal(linkPlan({ links: { wikipedia_album: 'https://en.wikipedia.org/wiki/Al_(album)' } }).wikipedia_album, 'https://en.wikipedia.org/wiki/Al_(album)');
});
