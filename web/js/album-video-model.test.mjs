import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  videoLink, youtubeAt, formatClock, parseClock, lengthText, splitArtists, joinArtists, stateOf, endOf, rowIssue, issues,
  summary, offsetAll, sortRows, isSorted, addRow, payload, previewErrorText, createErrorText,
} from './album-video-model.js';

const PV = {
  videoId: 'yeUFSnA9Puk', url: 'https://youtu.be/yeUFSnA9Puk', title: 'Mix', uploader: 'DJ', duration: 3600, source: 'description', rawText: 'x',
  tracks: [
    { index: 0, start: 0, end: 600, artists: ['A', 'B'], title: 'One', version: null, warnings: [], match: null },
    { index: 1, start: 600, end: 1800, artists: ['C'], title: 'Two', version: 'Remix', warnings: ['no artist'], match: { songId: 's9', title: 'Two', artists: ['C'] } },
    { index: 2, start: 1800, end: 3600, artists: [], title: 'Three', version: null, warnings: [], match: null },
  ],
  album: { title: 'Mix', albumArtist: 'Various Artists', type: 'mix', year: 2020, coverUrl: 'https://i/x.jpg' },
  warnings: [],
};

test('videoLink accepts single video links only', () => {
  assert.equal(videoLink('https://youtu.be/yeUFSnA9Puk?si=abc').id, 'yeUFSnA9Puk');
  assert.equal(videoLink('youtube.com/watch?v=yeUFSnA9Puk&t=3').id, 'yeUFSnA9Puk');
  assert.equal(videoLink('https://music.youtube.com/watch?v=yeUFSnA9Puk').id, 'yeUFSnA9Puk');
  assert.equal(videoLink('https://www.youtube.com/shorts/yeUFSnA9Puk').id, 'yeUFSnA9Puk');
  assert.equal(videoLink('https://www.discogs.com/release/1'), null);
  assert.equal(videoLink('https://www.youtube.com/watch?v=short'), null);
  assert.equal(videoLink('https://www.youtube.com/playlist?list=PLabc'), null);
  assert.equal(videoLink(''), null);
  assert.equal(youtubeAt('abc', 83.7), 'https://youtu.be/abc?t=83');
});

test('clock parsing and formatting', () => {
  assert.equal(formatClock(3725), '01:02:05');
  assert.equal(formatClock(-4), '00:00:00');
  assert.equal(parseClock('1:02:05'), 3725);
  assert.equal(parseClock('02:05'), 125);
  assert.equal(parseClock('90'), 90);
  assert.equal(parseClock('1:75'), null);
  assert.equal(parseClock('x'), null);
  assert.equal(lengthText(5400), '1 h 30 min');
  assert.equal(lengthText(2700), '45 min');
  assert.equal(lengthText(20), '20 s');
  assert.deepEqual(splitArtists(' A & B &  '), ['A', 'B']);
  assert.equal(joinArtists(['A', 'B']), 'A & B');
});

test('stateOf: matches start unticked, album defaults from the preview', () => {
  const st = stateOf(PV, 'u');
  assert.deepEqual(st.rows.map((r) => r.include), [true, false, true]);
  assert.equal(st.rows[0].artists, 'A & B');
  assert.equal(st.album.type, 'mix');
  assert.equal(st.album.year, '2020');
  assert.equal(st.fades, true);
  assert.equal(st.endTime, 3600);
  assert.equal(endOf(st, 0), 600);
  assert.equal(endOf(st, 2), 3600);
  assert.equal(stateOf({ ...PV, album: { ...PV.album, type: 'album' } }).fades, false);
  assert.equal(stateOf({ ...PV, album: { ...PV.album, type: 'weird' } }).album.type, 'album');
});

test('summary line counts included tracks, their length and warnings', () => {
  const st = stateOf(PV);
  assert.equal(summary(st), '2 tracks · 40 min');
  st.rows[1].include = true;
  assert.equal(summary(st), '3 tracks · 1 h 00 min · 1 warning');
  st.rows[0].include = false;
  st.rows[1].include = false;
  st.rows[2].include = false;
  assert.match(summary(st), /^0 tracks · 1 warning$/);
});

test('validation: order, bounds, titles, year, at least one track', () => {
  const st = stateOf(PV);
  assert.deepEqual(issues(st), []);
  st.rows[1].include = true;
  st.rows[1].start = 0;
  assert.match(rowIssue(st, 1), /after the previous/);
  st.rows[1].start = 600;
  st.rows[2].start = 4000;
  assert.match(rowIssue(st, 2), /end of the video/);
  st.rows[2].start = 1800;
  st.rows[0].title = ' ';
  assert.match(issues(st)[0], /Track 1: Title is empty/);
  st.rows[0].title = 'One';
  st.album.year = '20';
  assert.match(issues(st)[0], /Year/);
  st.album.year = '';
  st.album.title = '';
  assert.match(issues(st)[0], /album a title/);
  st.album.title = 'x';
  st.endTime = 1800;
  assert.match(rowIssue(st, 2), /after it starts/);
  st.endTime = 3600;
  st.badEnd = true;
  assert.match(issues(st)[0], /last end time/);
  st.badEnd = false;
  for (const r of st.rows) r.include = false;
  assert.match(issues(st)[0], /at least one/);
});

test('offset clamps, sort and add keep the rows consistent', () => {
  const st = stateOf(PV);
  offsetAll(st, -5);
  assert.deepEqual(st.rows.map((r) => r.start), [0, 595, 1795]);
  offsetAll(st, 5000);
  assert.deepEqual(st.rows.map((r) => r.start), [3600, 3600, 3600]);
  st.rows[0].start = 900;
  st.rows[1].start = 100;
  assert.equal(isSorted(st), false);
  sortRows(st);
  assert.equal(isSorted(st), true);
  assert.deepEqual(st.rows.map((r) => r.no), [1, 2, 3]);
  st.rows[2].start = 1800;
  const added = addRow(st);
  assert.equal(st.rows.at(-1), added);
  assert.equal(added.no, 4);
  assert.equal(added.include, true);
  assert.ok(added.start > st.rows.at(-2).start && added.start < st.endTime);
});

test('payload follows the create contract', () => {
  const st = stateOf(PV);
  st.rows[1].useExisting = true;
  st.rows[1].include = true;
  st.rows[0].artists = 'A & B';
  st.album.genres = ['house'];
  const p = payload(st);
  assert.equal(p.url, 'https://youtu.be/yeUFSnA9Puk');
  assert.deepEqual(p.album, { title: 'Mix', albumArtist: 'Various Artists', type: 'mix', year: 2020, genres: ['house'], coverUrl: 'https://i/x.jpg' });
  assert.deepEqual(p.tracks[0], { include: true, start: 0, end: 600, artists: ['A', 'B'], title: 'One', version: null, trackNo: 1, useExistingSongId: null });
  assert.equal(p.tracks[1].useExistingSongId, 's9');
  assert.equal(p.tracks[1].version, 'Remix');
  assert.equal(p.tracks[2].end, 3600);
  assert.equal(p.fades, true);
  st.rows[1].include = false;
  assert.equal(payload(st).tracks[1].useExistingSongId, null);
  st.album.year = '';
  assert.equal(payload(st).album.year, null);
});

test('error texts', () => {
  assert.equal(previewErrorText({ status: 413, data: { detail: 'video longer than 4 hours' } }), 'Video longer than 4 hours.');
  assert.match(previewErrorText({ status: 400 }), /not a valid/);
  assert.match(previewErrorText({ status: 404 }), /private/);
  assert.equal(previewErrorText({ status: 418, message: 'teapot' }), 'teapot');
  assert.match(createErrorText({ status: 400, code: 'library_full_songs' }), /library is full/);
  assert.match(createErrorText({ status: 429 }), /Hourly/);
  assert.match(createErrorText({ status: 422, data: { detail: 'bad_times' } }), /wrong times/);
  assert.match(createErrorText({ status: 422, data: { detail: 'start must be before end' } }), /could not be saved/);
  assert.match(createErrorText({ status: 409, data: { detail: { code: 'already_exists', id: 'a1' } } }), /already exists/);
  assert.match(createErrorText({ status: 409, data: { detail: 'album_limit' } }), /album limit/);
});
