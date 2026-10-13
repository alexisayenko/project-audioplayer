import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkKey, findInLibrary } from './library-match.js';

const V = 'jNQXAC9IVRw';
const songs = [
  { id: V, title: 'Me at the zoo', artist: 'jawed', sources: [{ source: 'youtube', url: `https://www.youtube.com/watch?v=${V}` }] },
  { id: 'soundcloud-123', title: 'Track', artist: 'Artist', sources: [{ source: 'soundcloud', url: 'https://soundcloud.com/Some-User/My-Track' }] },
  { id: 'other', title: 'No sources' },
];

test('YouTube URL shapes match by id', () => {
  for (const u of [
    `https://youtu.be/${V}`,
    `https://youtu.be/${V}?si=abc&t=42`,
    `https://www.youtube.com/watch?v=${V}&t=10s&list=PL123`,
    `https://www.youtube.com/watch?list=PL123&v=${V}`,
    `https://m.youtube.com/watch?v=${V}`,
    `https://www.youtube.com/shorts/${V}?si=x`,
    `https://www.youtube.com/embed/${V}`,
    `https://music.youtube.com/watch?v=${V}&si=abc`,
    `youtube.com/watch?v=${V}`,
  ]) assert.equal(findInLibrary(u, songs)?.title, 'Me at the zoo', u);
});

test('SoundCloud matches the canonical URL', () => {
  assert.equal(findInLibrary('https://soundcloud.com/some-user/my-track?si=1&utm_source=x', songs)?.id, 'soundcloud-123');
  assert.equal(findInLibrary('https://m.soundcloud.com/Some-User/My-Track', songs)?.id, 'soundcloud-123');
});

test('no match', () => {
  assert.equal(findInLibrary('https://youtu.be/aaaaaaaaaaa', songs), null);
  assert.equal(findInLibrary('https://soundcloud.com/some-user/other-track', songs), null);
  assert.equal(findInLibrary('https://soundcloud.com/some-user', songs), null);
  assert.equal(findInLibrary('https://example.com/watch?v=' + V, songs), null);
  assert.equal(findInLibrary('hello world', songs), null);
  assert.equal(findInLibrary('', songs), null);
  assert.equal(findInLibrary('aaaaaaaaaaa', songs), null);
  assert.equal(findInLibrary('abcdefghij', songs), null);
  assert.equal(findInLibrary(V + 'x', songs), null);
  assert.equal(findInLibrary(V.slice(0, 5) + ' ' + V.slice(6), songs), null);
  assert.equal(findInLibrary(`https://youtu.be/${V}`, []), null);
  assert.equal(linkKey(null), null);
});

test('a bare YouTube video id is a link', () => {
  assert.deepEqual(linkKey(V), { kind: 'youtube', key: V });
  assert.deepEqual(linkKey(`  ${V}\n`), { kind: 'youtube', key: V });
  assert.deepEqual(linkKey('QCuUAClm-hQ'), { kind: 'youtube', key: 'QCuUAClm-hQ' });
  assert.deepEqual(linkKey('a_b-c_d-e_f'), { kind: 'youtube', key: 'a_b-c_d-e_f' });
  assert.equal(linkKey(V.slice(0, 10)), null);
  assert.equal(linkKey(V + 'x'), null);
  assert.equal(linkKey('hello world'), null);
  assert.equal(findInLibrary(V, songs)?.title, 'Me at the zoo');
  assert.equal(findInLibrary(` ${V} `, songs)?.title, 'Me at the zoo');
  assert.deepEqual(linkKey(`https://youtu.be/${V}?si=x`), { kind: 'youtube', key: V });
});
