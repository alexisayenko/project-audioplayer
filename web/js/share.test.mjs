import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareUrl, parseShareParams, parseClock, fmtClock, clampT, isShareHash, camDiffers, SHARE_MODES, SHARE_STYLES,
} from './share.js';
import { TERRAIN_STYLES } from './viz-terrain-style.js';

const O = 'https://electrophone.cc';

test('style list matches the terrain styles', () => {
  assert.deepEqual([...SHARE_STYLES].sort(), TERRAIN_STYLES.map((s) => s.id).sort());
  assert.deepEqual(SHARE_MODES, ['bars', 'ring', 'terrain']);
});

test('buildShareUrl matches the documented scheme', () => {
  assert.equal(buildShareUrl({ origin: O, id: 'abc_123', t: 83, viz: 'terrain', style: 'single', fs: true }),
    `${O}/#/play/abc_123?v=1&t=83&viz=terrain&style=single&fs=1`);
  assert.equal(buildShareUrl({ origin: `${O}/`, id: 'x', t: 0, viz: 'bars', style: 'single', bg: false }), `${O}/#/play/x?v=1&viz=bars&bg=0`);
  assert.equal(buildShareUrl({ origin: O, id: 'bad id' }), null);
  assert.equal(buildShareUrl({ origin: O, id: 'x', t: 500, duration: 120.9 }), `${O}/#/play/x?v=1&t=120`);
});

test('round trip with camera', () => {
  const url = buildShareUrl({ origin: O, id: 'a-b', t: 7, viz: 'terrain', style: 'melody', bg: true, fs: true, cam: { eye: 3.7, pitch: -13, yaw: 5 } });
  const p = parseShareParams(url.slice(O.length + 1));
  assert.deepEqual(p, { id: 'a-b', t: 7, viz: 'terrain', style: 'melody', bg: true, fs: true, cam: { eye: 3.7, pitch: -13, yaw: 5 } });
});

test('parse validates, clamps and ignores unknown params', () => {
  const p = parseShareParams('#/play/abc?v=9&t=99999999&viz=evil&style=nope&bg=2&fs=yes&cam=1,2&zzz=1');
  assert.deepEqual(p, { id: 'abc', t: 0, viz: null, style: null, bg: null, fs: false, cam: null });
  assert.equal(parseShareParams('#/play/abc?t=-5').t, 0);
  assert.equal(parseShareParams('#/play/abc?t=1e3').t, 0);
  assert.equal(parseShareParams('#/play/abc?t=1000000').t, 86400);
  const c = parseShareParams('#/play/abc?cam=99,99,99').cam;
  assert.ok(c.eye <= 4 && c.pitch <= 15 && c.yaw <= 45);
  assert.equal(parseShareParams('#/play/?t=1'), null);
  assert.equal(parseShareParams('#/play/%E0%A4%A'), null);
  assert.equal(parseShareParams('#/play/<script>'), null);
  assert.equal(parseShareParams('#/library'), null);
  assert.equal(parseShareParams('#/play/abc').id, 'abc');
});

test('isShareHash only matches the play route', () => {
  assert.equal(isShareHash('#/play/x?t=1'), true);
  assert.equal(isShareHash('#/playback'), false);
  assert.equal(isShareHash('#/library'), false);
});

test('clock parsing and formatting', () => {
  assert.equal(parseClock('1:23'), 83);
  assert.equal(parseClock('83'), 83);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(parseClock('1:75'), null);
  assert.equal(parseClock('abc'), null);
  assert.equal(parseClock(''), null);
  assert.equal(fmtClock(83), '1:23');
  assert.equal(fmtClock(3723), '1:02:03');
  assert.equal(clampT(NaN), 0);
  assert.equal(clampT(50.7, 30), 30);
});

test('camDiffers is false for the default camera', () => {
  assert.equal(camDiffers({}), false);
  assert.equal(camDiffers({ eye: 1 }), true);
});
