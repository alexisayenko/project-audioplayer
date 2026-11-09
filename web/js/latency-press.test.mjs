import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressKind, isPlayKey, fileIdOf, resourceRows } from './latency-core.js';

const node = (sel, { row = null } = {}) => ({
  closest(q) {
    if (q === 'li[data-id]') return row ? { dataset: { id: row } } : null;
    const hit = q.split(',').map((s) => s.trim()).includes(sel);
    return hit ? this.self : null;
  },
  get self() { return { matches: (q) => q.split(',').map((s) => s.trim()).includes(sel), closest: (q) => (q === 'li[data-id]' ? (row ? { dataset: { id: row } } : null) : this.self) }; },
});

test('fileIdOf reads the id of a /files/ address', () => {
  assert.equal(fileIdOf('https://electrophone.cc/files/abc%20d?x=1'), 'abc d');
  assert.equal(fileIdOf('/files/xyz'), 'xyz');
  assert.equal(fileIdOf('/covers/xyz'), null);
  assert.equal(fileIdOf(null), null);
});

test('pressKind: Play while paused begins a run, Next and Previous always do', () => {
  assert.equal(pressKind(node('#mini-play'), { paused: true }), 'play');
  assert.equal(pressKind(node('#mini-next'), { paused: false }), 'skip');
  assert.equal(pressKind(node('#mini-prev'), { paused: true }), 'skip');
});

test('pressKind: while playing, a row Play on another song begins a run, on the current song (a pause) does not', () => {
  assert.equal(pressKind(node('.act-play', { row: 'b' }), { paused: false, currentId: 'a' }), 'play');
  assert.equal(pressKind(node('.act-play', { row: 'a' }), { paused: false, currentId: 'a' }), null);
  assert.equal(pressKind(node('.act-play', { row: 'a' }), { paused: true, currentId: 'a' }), 'play');
});

test('pressKind: the dock Play while playing is a pause; a Play album button starts songs; other targets are not presses', () => {
  assert.equal(pressKind(node('#mini-play'), { paused: false, currentId: 'a' }), null);
  assert.equal(pressKind(node('.act-play'), { paused: false, currentId: 'a' }), 'play');
  assert.equal(pressKind(node('.something-else'), { paused: true }), null);
  assert.equal(pressKind(null, { paused: true }), null);
});

test('isPlayKey: Space on the page and the media key, not typing or activating a control', () => {
  assert.equal(isPlayKey({ key: ' ', target: { tagName: 'BODY' } }), true);
  assert.equal(isPlayKey({ key: 'MediaPlayPause', target: { tagName: 'INPUT' } }), true);
  assert.equal(isPlayKey({ key: ' ', target: { tagName: 'INPUT' } }), false);
  assert.equal(isPlayKey({ key: ' ', target: { tagName: 'BUTTON' } }), false);
  assert.equal(isPlayKey({ key: ' ', target: { tagName: 'DIV', isContentEditable: true } }), false);
  assert.equal(isPlayKey({ key: ' ', repeat: true, target: { tagName: 'BODY' } }), false);
  assert.equal(isPlayKey({ key: ' ', metaKey: true, target: { tagName: 'BODY' } }), false);
  assert.equal(isPlayKey({ key: 'Enter', target: { tagName: 'BODY' } }), false);
});

test('resourceRows keeps the /files/ requests from the press on, as offsets in ms', () => {
  const rows = resourceRows([
    { name: 'https://electrophone.cc/covers/a.jpg', initiatorType: 'img', startTime: 1100 },
    { name: 'https://electrophone.cc/files/old', startTime: 500, requestStart: 510, responseStart: 520, responseEnd: 530 },
    { name: 'https://electrophone.cc/files/abc?x=1', startTime: 1000.04, requestStart: 1005, responseStart: 1210.56, responseEnd: 1760, transferSize: 4152631 },
    { name: 'https://electrophone.cc/files/abc', startTime: 1020, requestStart: 0, responseStart: 0, responseEnd: 1300, encodedBodySize: 2 },
  ], 1000, { curId: 'abc' });
  assert.deepEqual(rows, [
    { name: '/files/abc?x=1', who: 'cur', start: 0, connect: 0, requestStart: 5, responseStart: 210.6, responseEnd: 760, bytes: 4152631 },
    { name: '/files/abc', who: 'cur', start: 20, connect: 0, requestStart: 0, responseStart: 0, responseEnd: 300, bytes: 2 },
  ]);
});

test('resourceRows marks the previous song, lists a request that was still running at the press, and stops after 5 s', () => {
  const rows = resourceRows([
    { name: 'https://x/files/prev', startTime: 900, requestStart: 905, responseStart: 910, responseEnd: 1180, transferSize: 786432 },
    { name: 'https://x/files/prev', startTime: 100, responseEnd: 400 },
    { name: 'https://x/files/cur', startTime: 1010, connectStart: 1010, connectEnd: 1060.4, requestStart: 1065, responseStart: 1100, responseEnd: 1400, transferSize: 786432 },
    { name: 'https://x/files/third', startTime: 1020, responseEnd: 1030, encodedBodySize: 2 },
    { name: 'https://x/plays', initiatorType: 'fetch', startTime: 1500, responseEnd: 1520 },
    { name: 'https://x/covers/c.jpg', initiatorType: 'img', startTime: 1500, responseEnd: 1520 },
    { name: 'https://x/files/cur', startTime: 6001, responseEnd: 6100 },
  ], 1000, { prevId: 'prev', curId: 'cur' });
  assert.deepEqual(rows.map((r) => [r.who, r.name, r.start]), [
    ['prev', '/files/prev', -100],
    ['cur', '/files/cur', 10],
    ['other', '/files/third', 20],
    ['api', '/plays', 500],
  ]);
  assert.equal(rows[1].connect, 50.4);
});

test('resourceRows: replaying the same song is cur, not prev', () => {
  const rows = resourceRows([{ name: '/files/a', startTime: 1000, responseEnd: 1100 }], 1000, { prevId: 'a', curId: 'a' });
  assert.equal(rows[0].who, 'cur');
});
