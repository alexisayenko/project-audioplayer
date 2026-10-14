import test from 'node:test';
import assert from 'node:assert/strict';
import { playerInset, watchPlayerInset } from './player-inset.js';

test('playerInset is the stage overlap with the player plus a gap', () => {
  assert.equal(playerInset(800, 700), 108);
  assert.equal(playerInset(800, 700, 0), 100);
});

test('playerInset never goes negative and ignores bad input', () => {
  assert.equal(playerInset(700, 800), 0);
  assert.equal(playerInset(NaN, 700), 0);
  assert.equal(playerInset(800, undefined), 0);
});

test('watchPlayerInset reports 0 without a player and the overlap with one', () => {
  const host = { getBoundingClientRect: () => ({ bottom: 800 }) };
  const win = { addEventListener() {}, removeEventListener() {} };
  const got = [];
  const none = { body: {}, getElementById: () => null };
  watchPlayerInset(host, (v) => got.push(v), none, win)();
  const mini = { hidden: false, getClientRects: () => [1], getBoundingClientRect: () => ({ top: 700 }) };
  const withMini = { body: {}, getElementById: () => mini };
  watchPlayerInset(host, (v) => got.push(v), withMini, win)();
  mini.hidden = true;
  watchPlayerInset(host, (v) => got.push(v), withMini, win)();
  assert.deepEqual(got, [0, 108, 0]);
});
