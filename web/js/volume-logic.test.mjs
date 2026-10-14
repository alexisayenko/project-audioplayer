import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampVolume, parseVolume, stepVolume, volumePercent, volumeAnnounce, canSetVolume, nextRepeatLabel, playHotkey,
} from './volume-logic.js';
import { nextStep, toggleRepeat } from './queue-logic.js';

test('clamp and parse validate stored volume', () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(7), 1);
  assert.equal(clampVolume('0.4'), 0.4);
  assert.equal(clampVolume(NaN), 1);
  for (const bad of [null, undefined, '', ' ', 'abc', 'NaN']) assert.equal(parseVolume(bad), 1, String(bad));
  assert.equal(parseVolume('0.25'), 0.25);
  assert.equal(parseVolume('5'), 1);
  assert.equal(parseVolume('-3'), 0);
  assert.equal(parseVolume('x', 0.5), 0.5);
});

test('step moves by 5 points, clamped, without float drift', () => {
  assert.equal(stepVolume(0.4, 1), 0.45);
  assert.equal(stepVolume(0.1 + 0.2, 1), 0.35);
  assert.equal(stepVolume(0.98, 1), 1);
  assert.equal(stepVolume(0.02, -1), 0);
  assert.equal(volumePercent(0.4), 40);
  assert.equal(volumeAnnounce(0.4, false), 'Volume 40%');
  assert.equal(volumeAnnounce(0.4, true), 'Muted');
  assert.equal(volumeAnnounce(0, false), 'Muted');
});

test('canSetVolume detects a read-only volume (iPhone) and restores the value', () => {
  const ok = { volume: 0.6 };
  assert.equal(canSetVolume(ok), true);
  assert.equal(ok.volume, 0.6);
  const readOnly = { get volume() { return 1; }, set volume(_) {} };
  assert.equal(canSetVolume(readOnly), false);
  const throws = { get volume() { return 1; }, set volume(_) { throw new Error('ro'); } };
  assert.equal(canSetVolume(throws), false);
});

test('repeat cycle off -> all -> one -> off and labels', () => {
  const next = { off: 'all', all: 'one', one: 'off' };
  let m = 'off';
  const seen = [];
  for (let i = 0; i < 3; i++) { m = next[m]; seen.push(nextRepeatLabel(m)); }
  assert.deepEqual(seen, ['Repeat all', 'Repeat one', 'Repeat off']);
  assert.equal(toggleRepeat('all', 'all'), 'off');
});

test('shuffle plays every song once before repeating; repeat all wraps; repeat one pins', () => {
  const queue = ['a', 'b', 'c', 'd', 'e'];
  let st = { queue, index: 0, shuffle: true, repeat: 'off', played: [] };
  const order = [queue[0]];
  for (let i = 0; i < 4; i++) {
    const step = nextStep(st, false, Math.random);
    assert.ok(step);
    order.push(queue[step.index]);
    st = { ...st, index: step.index, played: step.played };
  }
  assert.equal(new Set(order).size, 5);
  assert.equal(nextStep(st, false), null);
  const wrap = nextStep({ ...st, repeat: 'all' }, false);
  assert.ok(wrap && wrap.index >= 0);
  assert.equal(nextStep({ queue, index: 2, shuffle: false, repeat: 'one', played: [] }, false).index, 2);
  assert.equal(nextStep({ queue, index: 4, shuffle: false, repeat: 'all', played: [] }, false).index, 0);
});

test('hotkeys only with the overlay open and no control focused', () => {
  const ev = (key, over = {}) => ({ key, target: { closest: () => null }, ...over });
  assert.equal(playHotkey(ev('s'), { open: true }), 'shuffle');
  assert.equal(playHotkey(ev('R'), { open: true }), 'repeat');
  assert.equal(playHotkey(ev('ArrowUp'), { open: true }), 'vol-up');
  assert.equal(playHotkey(ev('ArrowDown'), { open: true }), 'vol-down');
  assert.equal(playHotkey(ev('s'), { open: false }), null);
  assert.equal(playHotkey(ev('s', { ctrlKey: true }), { open: true }), null);
  assert.equal(playHotkey(ev('s', { repeat: true }), { open: true }), null);
  assert.equal(playHotkey(ev('ArrowUp', { target: { closest: () => ({}) } }), { open: true }), null);
  assert.equal(playHotkey(ev('m'), { open: true }), null);
});
