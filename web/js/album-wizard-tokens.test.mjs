import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
const M = await import('./album-wizard-model.js');
const { sourceLine, sourceParts, fromChannel } = await import('./album-wizard-details.js');
const { VIDEO, PLAYLIST } = await import('./album-wizard-fixture.mjs');

const make = (kind = 'video', preview = kind === 'video' ? VIDEO : PLAYLIST) => {
  const d = M.newDraft();
  M.applyPreview(d, kind, kind === 'video' ? VIDEO.url : preview.playlist.url, preview);
  return d;
};

test('artistName joins the pills with " & " and ignores blanks, so the server still gets one artist text', () => {
  assert.equal(M.artistName('Hallucinogen - Simon Posford'), 'Hallucinogen & Simon Posford');
  assert.equal(M.artistName('  Hallucinogen  '), 'Hallucinogen');
  assert.equal(M.artistName(' - '), '');
  assert.equal(M.artistName('Delta Aquarids / Panayotis Kritidis'), 'Delta Aquarids & Panayotis Kritidis');
});

test('the artist token text drives the issues, the Discogs search key, the payload artist and the track fallback', () => {
  const d = make();
  d.fields.artist = 'Hallucinogen - Friend';
  assert.deepEqual(M.fieldIssues(d.fields), []);
  assert.equal(M.fieldIssues({ ...d.fields, artist: ' - ' }).length, 1);
  assert.equal(M.albumNow(d).albumArtist, 'Hallucinogen & Friend');
  M.buildReview(d);
  assert.deepEqual(M.reviewView(d).rows.map((r) => r.artists), ['Hallucinogen & Friend', 'Hallucinogen & Friend', 'Guest']);
  assert.equal(M.createPayload(d).album.albumArtist, 'Hallucinogen & Friend');
  assert.equal(M.genresPayload(d).artist, 'Hallucinogen & Friend');
});

test('a changed pill changes the Discogs search key', () => {
  const f = { artist: 'A - B', album: 'X', year: '' };
  assert.notEqual(M.searchKey(f), M.searchKey({ ...f, artist: 'A' }));
  assert.equal(M.searchKey(f), M.searchKey({ ...f, artist: 'a - b ' }));
});

test('the source line is channel, title, track count and total time; one track is singular', () => {
  const v = make();
  assert.equal(sourceLine(v), 'Topic · Hallucinogen - Twisted (1995) [FULL ALBUM] · 3 tracks · 20:00');
  v.st.duration = 4062;
  v.st.rows.length = 1;
  assert.deepEqual(sourceParts(v), ['Topic', 'Hallucinogen - Twisted (1995) [FULL ALBUM]', '1 track', '1:07:42']);
  const p = make('playlist');
  assert.equal(sourceLine(p), 'Topic · Twisted · 3 tracks · 20:00');
  p.st.rows[0].durationS = null;
  assert.equal(sourceLine(p), 'Topic · Twisted · 3 tracks · 15:00');
  p.st.playlist = { title: 'Mix', uploader: '' };
  assert.equal(sourceLine(p), 'Mix · 3 tracks · 15:00');
});

test('the channel is only flagged when it became the artist and is not a Topic channel', () => {
  const d = make();
  assert.equal(fromChannel(d), false);
  d.st.uploader = 'Panayotis Kritidis';
  d.base.artist = 'Panayotis Kritidis';
  assert.equal(fromChannel(d), true);
  d.base.artist = 'Delta Aquarids';
  assert.equal(fromChannel(d), false);
  d.st.uploader = 'Delta Aquarids - Topic';
  d.base.artist = 'Delta Aquarids - Topic';
  assert.equal(fromChannel(d), false);
});

test('applyTracks fills a video that had no time codes and rebuilds the review without touching the fields', () => {
  const d = make('video', { ...VIDEO, source: 'none', tracks: [] });
  assert.equal(d.st.rows.length, 0);
  d.fields.album = 'Edited';
  M.buildReview(d);
  assert.deepEqual(M.createIssues(d), ['Tick at least one track.']);
  M.applyTracks(d, { ...VIDEO, source: 'pasted' }, 'x');
  assert.equal(d.st.rows.length, 3);
  assert.equal(d.st.source, 'pasted');
  assert.equal(d.fields.album, 'Edited');
  assert.equal(d.pasteText, 'x');
  assert.equal(M.createIssues(d).length, 0);
});

test('CSS: the Year input keeps four digits plus its padding in any row and the Fetch button sits inside the address well', () => {
  const css = readFileSync(new URL('../albums.css', import.meta.url), 'utf8');
  const rule = css.match(/input\[type=text\]\.album-year \{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /box-sizing: content-box/);
  assert.match(rule, /flex: none/);
  assert.match(rule, /min-width: 6ch/);
  assert.doesNotMatch(css, /\.wiz-details \.field \.album-year/);
  assert.match(css, /\.wiz-well \.wiz-fetch \{[^}]*flex: none/);
});
