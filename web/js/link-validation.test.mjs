import test from 'node:test';
import assert from 'node:assert/strict';
import { linkError, linkErrors, ownSourceKind, storedLinkStates } from './song-links.js';

test('youtube links', () => {
  for (const ok of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&x=1', 'https://youtu.be/dQw4w9WgXcQ?si=1', '', '  ']) assert.equal(linkError('youtube', ok), null, ok);
  for (const bad of ['dQw4w9WgXcQ', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'ftp://youtu.be/dQw4w9WgXcQ']) assert.match(linkError('youtube', bad), /YouTube/, bad);
});

test('soundcloud links', () => {
  assert.equal(linkError('soundcloud', 'https://soundcloud.com/artist/track'), null);
  assert.equal(linkError('soundcloud', 'https://soundcloud.com/artist/track/s-AbC123'), null);
  for (const bad of ['https://soundcloud.com/artist', 'https://on.soundcloud.com/abc123', 'https://soundcloud.com/discover/track', 'https://youtube.com/a/b']) assert.match(linkError('soundcloud', bad), /SoundCloud/, bad);
});

test('spotify links', () => {
  assert.equal(linkError('spotify', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x'), null);
  assert.equal(linkError('spotify', 'https://open.spotify.com/intl-de/album/4uLU6hMCjMI75M1A2tKUQC'), null);
  for (const bad of ['https://open.spotify.com/playlist/4uLU6hMCjMI75M1A2tKUQC', 'https://open.spotify.com/track/short', 'https://spotify.com/track/4uLU6hMCjMI75M1A2tKUQC']) assert.match(linkError('spotify', bad), /Spotify/, bad);
});

test('the song\'s own source link cannot be cleared', () => {
  assert.equal(ownSourceKind({ id: 'dQw4w9WgXcQ' }), 'youtube');
  assert.equal(ownSourceKind({ id: 'soundcloud-123' }), 'soundcloud');
  assert.equal(ownSourceKind({ id: 'spotify-abc' }), null);
  assert.ok(linkErrors({ youtube: '', soundcloud: '', spotify: '' }, { ownKind: 'youtube' }).youtube);
  assert.deepEqual(linkErrors({ youtube: 'https://youtu.be/dQw4w9WgXcQ', soundcloud: '', spotify: '' }, { ownKind: 'youtube' }), {});
});

test('stored spotify_url lights the Spotify icon', () => {
  assert.deepEqual(storedLinkStates({ spotify_url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' }).spotify, { on: true, url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
});
