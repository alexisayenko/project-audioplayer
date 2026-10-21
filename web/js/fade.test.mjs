import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePercent, fadeLabel, fadeHint, capFade, gainAt, schedule, startsSong, FADE_MAX, FADE_CEILING } from './fade.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('normalizePercent snaps to whole percent and treats out-of-range or junk as off', () => {
  assert.equal(normalizePercent('8'), 8);
  assert.equal(normalizePercent(7.6), 8);
  assert.equal(normalizePercent(FADE_MAX), 15);
  for (const v of [0, -1, 16, 99, '', null, undefined, 'x', NaN]) assert.equal(normalizePercent(v), 0);
});

test('fadeLabel shows Off at zero and percent otherwise', () => {
  assert.equal(fadeLabel(0), 'Off');
  assert.equal(fadeLabel(10), '10 %');
});

test('capFade is a share of the song, at most 60 s and half of the song', () => {
  near(capFade(8, 180), 14.4);
  assert.equal(capFade(10, 600), 60);
  assert.equal(capFade(15, 1800), FADE_CEILING);
  near(capFade(10, 20), 2);
  assert.equal(capFade(15, 4), 0.6);
  assert.equal(capFade(8, 0), 0);
  assert.equal(capFade(8, NaN), 0);
  assert.equal(capFade(0, 180), 0);
  assert.equal(capFade(99, 180), 0);
});

test('fadeHint shows the seconds for the loaded song and nothing without one', () => {
  assert.equal(fadeHint(10, 180), '≈ 18 s on this song');
  assert.equal(fadeHint(5, 100), '≈ 5 s on this song');
  assert.equal(fadeHint(10, 600), '≈ 60 s on this song');
  assert.equal(fadeHint(0, 180), '');
  assert.equal(fadeHint(10, NaN), '');
});

test('settings at 0 mean no fade at all', () => {
  const s = schedule({ time: 0, duration: 100, fadeIn: 0, fadeOut: 0 });
  assert.equal(s.level, 1);
  assert.deepEqual(s.points, []);
  assert.equal(gainAt({ time: 99.9, duration: 100, fadeIn: 0, fadeOut: 0 }), 1);
});

test('fade in ramps from 0 to 1 over the percent of the song from the start', () => {
  const s = schedule({ time: 0, duration: 100, fadeIn: 4, fadeOut: 0 });
  assert.equal(s.level, 0);
  assert.deepEqual(s.points, [{ dt: 4, gain: 1 }]);
  near(gainAt({ time: 1, duration: 100, fadeIn: 4 }), 0.25);
  assert.equal(gainAt({ time: 4, duration: 100, fadeIn: 4 }), 1);
});

test('fade in does not apply when inactive (seek, restore)', () => {
  assert.equal(gainAt({ time: 1, duration: 100, fadeIn: 4, inActive: false }), 1);
  assert.deepEqual(schedule({ time: 1, duration: 100, fadeIn: 4, inActive: false }).points, []);
});

test('fade out holds then ramps to 0 over the last percent of the song', () => {
  const s = schedule({ time: 10, duration: 100, fadeIn: 0, fadeOut: 3 });
  assert.equal(s.level, 1);
  assert.deepEqual(s.points, [{ dt: 87, gain: 1 }, { dt: 90, gain: 0 }]);
});

test('a 3-minute song at 8 % fades over 14.4 s at the end', () => {
  const s = schedule({ time: 0, duration: 180, fadeOut: 8 });
  near(s.points[0].dt, 165.6);
  near(s.points[1].dt, 180);
});

test('a 10-minute song at 10 % and a 30-minute mix at 15 % both fade over 60 s', () => {
  const a = schedule({ time: 0, duration: 600, fadeOut: 10 });
  near(a.points[0].dt, 540);
  const b = schedule({ time: 0, duration: 1800, fadeIn: 15 });
  assert.deepEqual(b.points, [{ dt: 60, gain: 1 }]);
});

test('a 20 s clip at 10 % fades over 2 s with no minimum', () => {
  const s = schedule({ time: 0, duration: 20, fadeIn: 10 });
  assert.deepEqual(s.points, [{ dt: 2, gain: 1 }]);
});

test('seeking into the fade-out window starts at (duration - t) / fadeSeconds', () => {
  const s = schedule({ time: 98.5, duration: 100, fadeOut: 3 });
  near(s.level, 0.5);
  assert.deepEqual(s.points, [{ dt: 1.5, gain: 0 }]);
  near(gainAt({ time: 590, duration: 600, fadeOut: 10 }), 10 / 60);
});

test('both fades never overlap: each is at most half of the song', () => {
  const s = schedule({ time: 0, duration: 4, fadeIn: 15, fadeOut: 15 });
  assert.equal(s.level, 0);
  near(s.points[0].dt, 0.6);
  near(gainAt({ time: 2, duration: 4, fadeIn: 15, fadeOut: 15 }), 1);
});

test('no fade while the duration is unknown, in or out', () => {
  assert.equal(gainAt({ time: 50, duration: NaN, fadeOut: 3 }), 1);
  assert.deepEqual(schedule({ time: 0, duration: NaN, fadeOut: 3 }).points, []);
  const s = schedule({ time: 0, duration: NaN, fadeIn: 5 });
  assert.equal(s.level, 1);
  assert.deepEqual(s.points, []);
});

test('a Studio loop (enabled false) disables both fades', () => {
  assert.equal(gainAt({ time: 0, duration: 100, fadeIn: 4, fadeOut: 4, enabled: false }), 1);
  assert.deepEqual(schedule({ time: 98, duration: 100, fadeIn: 4, fadeOut: 4, enabled: false }), { level: 1, points: [] });
});

test('playback rate shortens the ramp times', () => {
  const s = schedule({ time: 0, duration: 100, fadeIn: 4, rate: 2 });
  assert.deepEqual(s.points, [{ dt: 2, gain: 1 }]);
});

test('startsSong is true only near zero', () => {
  assert.equal(startsSong(0), true);
  assert.equal(startsSong(0.1), true);
  assert.equal(startsSong(5), false);
});
