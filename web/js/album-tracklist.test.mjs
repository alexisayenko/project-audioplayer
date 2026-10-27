import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackList, parseDuration, startsOf, listLength, scaleStarts, mismatchText } from './album-tracklist.js';
import { trackClock } from './album-draft-model.js';
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const SAMPLE = `1 Dancing Galaxylyrics 9:18
2 Soundform 8:12
3 Quantum Leap 9:45
4 Third Eye 8:25
5 Mother Earth 10:19
6 Solar Wind 9:09
7 Deep Space 11:01
8 Ambient Galaxy (Disco Valley Mix) 13:45
Total length: 79:54`;

test('example list: starts, total and the Total line', () => {
  const r = parseTrackList(SAMPLE);
  assert.equal(r.tracks.length, 8);
  assert.equal(r.total, 79 * 60 + 54);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(startsOf(r.tracks).map(mmss), ['0:00', '9:18', '17:30', '27:15', '35:40', '45:59', '55:08', '66:09']);
  assert.equal(listLength(r.tracks), 79 * 60 + 54);
  assert.equal(r.tracks[7].title, 'Ambient Galaxy (Disco Valley Mix)');
});

test('numbering styles and optional artist', () => {
  const r = parseTrackList('1. A - One 3:00\n2) B – Two (4:05)\n3 - Three [5:10]\nFour 1:02:03\n05 C - Five 2:00');
  assert.deepEqual(r.tracks.map((t) => [t.artist, t.title, t.length]), [
    ['A', 'One', 180], ['B', 'Two', 245], ['', 'Three', 310], ['', 'Four', 3723], ['C', 'Five', 120]]);
});

test('hyphen inside a word is not an artist split', () => {
  const r = parseTrackList('Mid-Air 3:00');
  assert.deepEqual(r.tracks, [{ artist: '', title: 'Mid-Air', length: 180 }]);
});

test('blank lines ignored, missing lengths warn and count zero', () => {
  const r = parseTrackList('\n1 One 3:00\n\n2 Two\n3 Three 2:00\n');
  assert.equal(r.tracks.length, 3);
  assert.equal(r.tracks[1].length, null);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Two/);
  assert.deepEqual(startsOf(r.tracks), [0, 180, 180]);
});

test('Total line that disagrees with the sum warns', () => {
  const r = parseTrackList('1 A 3:00\nTotal length: 10:00');
  assert.equal(r.total, 600);
  assert.equal(r.warnings.length, 1);
});

test('parseDuration', () => {
  assert.equal(parseDuration('9:18'), 558);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('1:75'), null);
  assert.equal(parseDuration('x'), null);
});

test('scale to video length and mismatch text', () => {
  const r = parseTrackList(SAMPLE);
  const starts = startsOf(r.tracks);
  const sum = listLength(r.tracks);
  const scaled = scaleStarts(starts, sum, sum * 2);
  assert.equal(scaled[1], 2 * starts[1]);
  assert.equal(scaled[0], 0);
  assert.equal(mismatchText(sum, sum + 5, trackClock), '');
  assert.equal(mismatchText(sum, sum + 90, trackClock), 'Track list is 1:30 shorter than the video');
  assert.equal(mismatchText(sum, sum - 61, trackClock), 'Track list is 1:01 longer than the video');
  assert.equal(mismatchText(sum, 0, trackClock), '');
});
