import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playlistLink, MIX_MESSAGE, PRIVATE_MESSAGE } from './playlist-link.js';

const LIST = 'PLabcdefghijklmnop';

test('a playlist page, a video inside a playlist and a youtu.be link with a list are playlists', () => {
  const page = playlistLink(`https://www.youtube.com/playlist?list=${LIST}&si=track`);
  assert.deepEqual(page, { kind: 'playlist', id: LIST, video: null, url: `https://www.youtube.com/playlist?list=${LIST}` });
  const inside = playlistLink(`youtube.com/watch?v=dQw4w9WgXcQ&list=${LIST}&index=2`);
  assert.equal(inside.kind, 'playlist');
  assert.equal(inside.video, 'dQw4w9WgXcQ');
  assert.equal(playlistLink(`https://youtu.be/dQw4w9WgXcQ?list=${LIST}`).video, 'dQw4w9WgXcQ');
  assert.equal(playlistLink('https://music.youtube.com/playlist?list=OLAK5uy_abc').kind, 'playlist');
});

test('Mix lists: a bare Mix page is refused, a video taken from a Mix stays a single video', () => {
  assert.equal(playlistLink('https://www.youtube.com/playlist?list=RDCLAK5uy_abc').kind, 'mix');
  assert.equal(playlistLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1'), null);
  assert.match(MIX_MESSAGE, /Mix/);
});

test('Liked videos and Watch later are private', () => {
  assert.equal(playlistLink('https://www.youtube.com/playlist?list=WL').kind, 'private');
  assert.equal(playlistLink('https://www.youtube.com/playlist?list=LL').kind, 'private');
  assert.match(PRIVATE_MESSAGE, /private/);
});

test('other links, hosts and malformed text are not playlists', () => {
  for (const text of ['', 'hello', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/playlist', 'https://evil.com/playlist?list=PLabc123',
    'https://www.youtube.com.evil.com/playlist?list=PLabc123', 'https://www.youtube.com/playlist?list=a%20b', 'https://soundcloud.com/a/b?list=PLabc123', 'http://[::1']) {
    assert.equal(playlistLink(text), null, text);
  }
});
