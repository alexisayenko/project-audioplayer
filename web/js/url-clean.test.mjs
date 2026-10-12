import assert from 'node:assert/strict';
import { cleanUrl, cleanPasted, classifySoundcloud, classifySpotify, sourceOf, sourceLabel } from './url-clean.js';

const V = 'jNQXAC9IVRw';
const C = `https://www.youtube.com/watch?v=${V}`;
for (const raw of [
  `https://youtu.be/${V}?si=abc123`,
  `https://youtu.be/${V}?t=42&si=abc123`,
  `https://www.youtube.com/watch?v=${V}&si=abc123`,
  `https://www.youtube.com/watch?si=abc123&v=${V}`,
  `https://www.youtube.com/watch?feature=share&v=${V}&pp=x&utm_source=a`,
  `https://m.youtube.com/watch?v=${V}&t=5s`,
  `https://music.youtube.com/watch?v=${V}&si=abc&list=RDAMVM${V}`,
  `https://www.youtube.com/shorts/${V}?si=abc`,
  `https://www.youtube.com/embed/${V}?feature=oembed`,
  `https://www.youtube.com/live/${V}?si=abc`,
  `youtube.com/watch?v=${V}`,
  `  ${C}  `,
  C,
  V,
]) assert.equal(cleanUrl(raw), C, raw);

assert.equal(cleanUrl('https://example.com/a?id=7&utm_source=x&UTM_medium=y&si=1&fbclid=z&gclid=g&pp=p&feature=f'), 'https://example.com/a?id=7');
assert.equal(cleanUrl('https://example.com/a?si=1'), 'https://example.com/a');
assert.equal(cleanUrl('https://example.com/a?id=7#frag'), 'https://example.com/a?id=7#frag');
assert.equal(cleanUrl('nonsense'), 'nonsense');
assert.equal(cleanUrl('ftp://example.com/a?si=1'), 'ftp://example.com/a?si=1');
assert.equal(cleanUrl(''), '');
const P = 'S-u6qdeaPoE';
const PC = `https://www.youtube.com/watch?v=${P}`;
for (const raw of [
  `https://youtu.be/${P}?si=CHT3sdfIXci1E7k-`,
  `\n  https://youtu.be/${P}?si=CHT3sdfIXci1E7k-  \r\n`,
  `https://youtu.be/${P}?si=a\nhttps://youtu.be/AAAAAAAAAAA`,
  `listen to this: https://youtu.be/${P}?si=abc, nice`,
  `youtu.be/${P}?si=abc`,
]) assert.equal(cleanPasted(raw), PC, raw);
assert.equal(cleanPasted('some words'), 'some words');
assert.equal(cleanPasted(''), '');
const SC = 'https://soundcloud.com/some-artist/some-track';
for (const raw of [
  SC,
  'http://soundcloud.com/some-artist/some-track',
  'https://www.soundcloud.com/some-artist/some-track',
  'https://m.soundcloud.com/some-artist/some-track',
  'soundcloud.com/some-artist/some-track',
  `  ${SC}?si=abc&utm_source=clipboard&utm_medium=text  `,
  `${SC}/?ref=x#t=10`,
]) assert.equal(cleanUrl(raw), SC, raw);
assert.equal(cleanUrl(`${SC}/s-AbC123?si=zzz`), `${SC}/s-AbC123`);
assert.equal(cleanUrl('https://on.soundcloud.com/AbC123?si=x'), 'https://on.soundcloud.com/AbC123');
assert.equal(cleanPasted(`Check this out ${SC}?si=abc&utm_source=clipboard thanks`), SC);
assert.equal(cleanPasted('https://on.soundcloud.com/AbC123?si=x'), 'https://on.soundcloud.com/AbC123');
assert.equal(cleanPasted('soundcloud.com/some-artist/some-track?si=1'), SC);
for (const raw of [
  'https://soundcloud.com/some-artist',
  'https://soundcloud.com/some-artist/sets/my-set',
  'https://soundcloud.com/some-artist/likes',
  'https://soundcloud.com/discover/sets/x',
  `${SC}/albums`,
  'https://on.soundcloud.com/a/b',
]) assert.equal(classifySoundcloud(raw).kind, 'unsupported', raw);
for (const raw of ['https://evilsoundcloud.com/a/b', 'https://soundcloud.com.evil.example/a/b', 'nonsense', '']) assert.equal(classifySoundcloud(raw), null, raw);
assert.equal(cleanUrl('https://soundcloud.com/some-artist/sets/my-set?si=1'), 'https://soundcloud.com/some-artist/sets/my-set?si=1'.replace('?si=1', ''));
assert.equal(sourceOf('soundcloud-1234567890'), 'soundcloud');
assert.equal(sourceOf('dQw4w9WgXcQ'), 'youtube');
assert.equal(sourceOf('soundcloud-abc'), 'youtube');
assert.equal(sourceLabel('soundcloud'), 'SoundCloud');
assert.equal(sourceLabel('youtube'), 'YouTube');
console.log('url-clean tests passed');

// Spotify (task-0007): track links in every form become https://open.spotify.com/track/<id>.
const SPID = '4cOdK2wGLETKBW3PvgPWqT';
const SP = `https://open.spotify.com/track/${SPID}`;
for (const raw of [
  SP,
  `http://open.spotify.com/track/${SPID}`,
  `open.spotify.com/track/${SPID}`,
  `${SP}?si=AbC123xyz`,
  `${SP}?si=AbC123xyz&utm_source=copy-link#x`,
  `https://open.spotify.com/intl-de/track/${SPID}?si=1`,
  `https://open.spotify.com/intl-pt-br/track/${SPID}`,
  `https://play.spotify.com/track/${SPID}`,
  `spotify:track:${SPID}`,
  `  ${SP}  `,
]) {
  assert.deepEqual(classifySpotify(raw), { kind: 'track', url: SP }, raw);
  assert.equal(cleanUrl(raw), SP, raw);
}
assert.deepEqual(classifySpotify('https://spotify.link/AbC123?si=x'), { kind: 'short', url: 'https://spotify.link/AbC123' });
assert.equal(cleanUrl('spotify.link/AbC123'), 'https://spotify.link/AbC123');
for (const raw of [
  'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3',
  'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  'https://open.spotify.com/artist/0q5WvBK5P3cPqBzfKJTVz5',
  'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
  'spotify:album:1DFixLWuPkv3KT3TnV35m3',
  'https://open.spotify.com/track/short',
  'https://spotify.link/',
]) assert.deepEqual(classifySpotify(raw), { kind: 'unsupported', url: '' }, raw);
assert.equal(classifySpotify('https://example.com/track/x'), null);
assert.equal(cleanPasted(`Listen: ${SP}?si=abc nice`), SP);
assert.equal(cleanPasted(`check spotify:track:${SPID} out`), SP);
assert.equal(cleanPasted('https://spotify.link/AbC123?si=x'), 'https://spotify.link/AbC123');
assert.equal(sourceOf(`spotify-${SPID}`), 'spotify');
assert.equal(sourceOf('spotify-short'), 'youtube');
assert.equal(sourceLabel('spotify'), 'Spotify');
assert.equal(sourceLabel(undefined), 'YouTube');
