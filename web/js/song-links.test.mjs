import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostKind, storedLinkStates, wikipediaLink } from './song-links.js';

test('hostKind classifies services by host, with www./m./music. variants', () => {
  assert.equal(hostKind('https://www.youtube.com/watch?v=jNQXAC9IVRw'), 'youtube');
  assert.equal(hostKind('https://m.youtube.com/watch?v=x'), 'youtube');
  assert.equal(hostKind('https://music.youtube.com/watch?v=x'), 'youtube');
  assert.equal(hostKind('https://youtu.be/jNQXAC9IVRw'), 'youtube');
  assert.equal(hostKind('https://soundcloud.com/a/b'), 'soundcloud');
  assert.equal(hostKind('https://m.soundcloud.com/a/b'), 'soundcloud');
  assert.equal(hostKind('https://open.spotify.com/track/1'), 'spotify');
});

test('hostKind rejects look-alike hosts, other schemes and junk', () => {
  for (const u of ['https://notyoutube.com/x', 'https://youtube.com.evil.example/x', 'javascript:alert(1)', 'ftp://youtube.com/x', 'not a url', '', null, undefined]) {
    assert.equal(hostKind(u), null, String(u));
  }
});

test('storedLinkStates turns every stored link into a live icon', () => {
  const s = storedLinkStates({
    source_url: 'https://youtu.be/jNQXAC9IVRw',
    musicbrainz_url: 'https://musicbrainz.org/recording/1',
    discogs_url: 'https://www.discogs.com/release/1',
    wikipedia_song: 'https://en.wikipedia.org/wiki/Song',
  });
  assert.deepEqual(Object.keys(s).sort(), ['discogs', 'musicbrainz', 'wikipedia', 'youtube']);
  assert.deepEqual(s.youtube, { on: true, url: 'https://youtu.be/jNQXAC9IVRw' });
  assert.equal(s.wikipedia.label, 'Wikipedia (song)');
});

test('storedLinkStates reads sources[] too: YouTube, SoundCloud, both, Spotify', () => {
  const s = storedLinkStates({
    source_url: 'https://soundcloud.com/a/b',
    sources: [{ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }, { url: 'https://open.spotify.com/track/1' }, { url: 'https://example.com/x' }],
  });
  assert.equal(s.youtube.url, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(s.soundcloud.url, 'https://soundcloud.com/a/b');
  assert.equal(s.spotify.url, 'https://open.spotify.com/track/1');
  assert.equal(Object.keys(s).length, 3);
});

test('storedLinkStates is empty without links and ignores junk URLs', () => {
  assert.deepEqual(storedLinkStates({}), {});
  assert.deepEqual(storedLinkStates(null), {});
  assert.deepEqual(storedLinkStates({
    source_url: 'javascript:alert(1)', musicbrainz_url: 'mb', discogs_url: '  ', wikipedia_song: 'http://insecure.example', wikipedia_artist: 'Band',
    sources: [{ url: 'nope' }, null, 5],
  }), {});
});

test('Wikipedia prefers the song page, falls back to the artist page', () => {
  const both = { wikipedia_song: 'https://en.wikipedia.org/wiki/S', wikipedia_artist: 'https://en.wikipedia.org/wiki/A' };
  assert.deepEqual(wikipediaLink(both), { url: 'https://en.wikipedia.org/wiki/S', label: 'Wikipedia (song)' });
  const only = storedLinkStates({ wikipedia_artist: 'https://en.wikipedia.org/wiki/A' });
  assert.deepEqual(only.wikipedia, { on: true, url: 'https://en.wikipedia.org/wiki/A', label: 'Wikipedia (artist)' });
  assert.equal(wikipediaLink({}), null);
});

test('wikipediaLink falls back from song to album to artist', () => {
  const a = 'https://en.wikipedia.org/wiki/A', al = 'https://en.wikipedia.org/wiki/Al', s = 'https://en.wikipedia.org/wiki/S';
  assert.equal(wikipediaLink({ wikipedia_song: s, wikipedia_album: al, wikipedia_artist: a }).url, s);
  assert.deepEqual(wikipediaLink({ wikipedia_album: al, wikipedia_artist: a }), { url: al, label: 'Wikipedia (album)' });
  assert.equal(wikipediaLink({ wikipedia_artist: a }).url, a);
});
