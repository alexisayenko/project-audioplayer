import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from './dl-queue.js';

const T0 = 1_000_000;

test('enqueue dedups and never re-adds failed ids', () => {
  let s = D.enqueue(D.empty(), ['a', 'b', 'a']);
  assert.deepEqual(s.jobs.map((j) => j.id), ['a', 'b']);
  s = D.failed(s, 'a', 'boom');
  const again = D.enqueue(s, ['a']);
  assert.equal(again, s);
  assert.equal(D.view(s, 'a', T0).kind, 'failed');
  assert.equal(D.view(D.retry(s, 'a'), 'a', T0).kind, 'queued');
});

test('startable respects concurrency and order', () => {
  let s = D.enqueue(D.empty(), ['a', 'b', 'c']);
  assert.deepEqual(D.startable(s, T0, 1), ['a']);
  s = D.started(s, 'a');
  assert.deepEqual(D.startable(s, T0, 1), []);
  assert.deepEqual(D.startable(s, T0, 2), ['b']);
  s = D.done(s, 'a');
  assert.deepEqual(D.startable(s, T0, 1), ['b']);
});

test('front enqueue goes ahead of queued jobs but not running ones', () => {
  let s = D.enqueue(D.empty(), ['a', 'b']);
  s = D.started(s, 'a');
  s = D.enqueue(s, ['z'], true);
  assert.deepEqual(s.jobs.map((j) => j.id), ['a', 'z', 'b']);
  s = D.prioritize(s, 'b');
  assert.deepEqual(s.jobs.map((j) => j.id), ['a', 'b', 'z']);
});

test('progress is clamped and shown while downloading', () => {
  let s = D.started(D.enqueue(D.empty(), ['a']), 'a');
  s = D.progress(s, 'a', 1.7);
  assert.deepEqual(D.view(s, 'a', T0), { kind: 'downloading', progress: 1, error: '', minutes: 0, speed: null, eta: null });
});

test('hourly limit pauses everything and resumes after the wait', () => {
  let s = D.enqueue(D.empty(), ['a', 'b']);
  s = D.started(s, 'a');
  s = D.limited(s, 'a', T0, 12);
  assert.equal(s.jobs[0].id, 'a');
  assert.equal(s.jobs[0].status, 'queued');
  assert.deepEqual(D.startable(s, T0 + 1000, 1), []);
  assert.equal(D.view(s, 'b', T0 + 1000).kind, 'paused');
  assert.equal(D.view(s, 'b', T0 + 1000).minutes, 12);
  assert.equal(D.minutesLeft(s, T0 + 11 * 60000 + 1), 1);
  const later = T0 + 12 * 60000;
  assert.deepEqual(D.startable(s, later, 1), ['a']);
  const r = D.resume(s, later);
  assert.equal(r.pausedUntil, 0);
  assert.equal(D.view(r, 'b', later).kind, 'queued');
  assert.equal(D.resume(s, T0 + 1000), s);
});

test('limit minutes are at least one', () => {
  const s = D.limited(D.enqueue(D.empty(), ['a']), 'a', T0, 0);
  assert.equal(D.minutesLeft(s, T0), 1);
});

test('prune drops queued and failed jobs that left the playlist, keeps the running one', () => {
  let s = D.enqueue(D.empty(), ['a', 'b', 'c', 'd']);
  s = D.started(s, 'a');
  s = D.failed(s, 'd', 'x');
  s = D.prune(s, ['c']);
  assert.deepEqual(s.jobs.map((j) => j.id), ['a', 'c']);
  assert.equal(D.prune(s, ['a', 'c']), s);
});

test('unknown songs have no download state', () => {
  assert.equal(D.view(D.empty(), 'q', T0).kind, 'none');
});

test('poll backoff grows then caps', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(D.backoff), [1000, 2000, 3000, 5000, 5000]);
});
