import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from './dl-queue.js';

const T = 1_000_000;

test('limited pauses everything, puts the job first and clamps minutes', () => {
  let s = D.enqueue(D.empty(), ['a', 'b']);
  s = D.started(s, 'b');
  s = D.limited(s, 'b', T, 0);
  assert.equal(D.pausedFor(s, T), 60000, 'zero/NaN minutes mean at least one');
  assert.deepEqual(D.startable(s, T, 5), []);
  assert.equal(D.view(s, 'a', T).kind, 'paused');
  assert.equal(D.view(s, 'a', T).minutes, 1);
  assert.deepEqual(s.jobs.map((j) => j.id), ['b', 'a']);
  assert.deepEqual(D.startable(D.resume(s, T + 60000), T + 60000, 1), ['b']);
});

test('resume only clears an elapsed pause', () => {
  const s = D.limited(D.enqueue(D.empty(), ['a']), 'a', T, 2);
  assert.equal(D.resume(s, T + 1), s);
  assert.equal(D.resume(s, T + 120000).pausedUntil, 0);
  const idle = D.empty();
  assert.equal(D.resume(idle, T), idle);
});

test('limited with garbage minutes falls back to one minute', () => {
  const s = D.limited(D.enqueue(D.empty(), ['a']), 'a', T, 'x');
  assert.equal(D.pausedFor(s, T), 60000);
});

test('progress clamps and normalises server extras', () => {
  let s = D.started(D.enqueue(D.empty(), ['a']), 'a');
  s = D.progress(s, 'a', 4, { speed: -1, eta: 'x' });
  assert.equal(s.jobs[0].progress, 1);
  assert.equal(s.jobs[0].speed, null);
  assert.equal(s.jobs[0].eta, null);
  s = D.progress(s, 'a', -2, { speed: 100, eta: 0, converting: true });
  assert.equal(s.jobs[0].progress, 0);
  assert.equal(s.jobs[0].speed, 100);
  assert.equal(s.jobs[0].eta, 0);
  assert.equal(D.view(s, 'a', T).kind, 'converting');
  s = D.progress(s, 'a', NaN);
  assert.equal(s.jobs[0].progress, 0);
});

test('remote queued state shows as queued while the local job runs', () => {
  let s = D.started(D.enqueue(D.empty(), ['a']), 'a');
  s = D.progress(s, 'a', 0, { remote: 'queued' });
  assert.equal(D.view(s, 'a', T).kind, 'queued');
});

test('finishing shows done at full progress, done removes the job', () => {
  let s = D.started(D.enqueue(D.empty(), ['a']), 'a');
  s = D.finishing(s, 'a');
  assert.equal(D.view(s, 'a', T).kind, 'done');
  assert.equal(D.view(s, 'a', T).progress, 1);
  assert.equal(D.active(s), 1, 'still occupies its slot until removed');
  assert.equal(D.view(D.done(s, 'a'), 'a', T).kind, 'none');
});

test('failed keeps a default message; operations on unknown ids are no-ops', () => {
  let s = D.started(D.enqueue(D.empty(), ['a']), 'a');
  assert.equal(D.failed(s, 'a', '').jobs[0].error, 'Download failed');
  assert.equal(D.retry(s, 'a'), s, 'only failed jobs retry');
  assert.equal(D.retry(s, 'zzz'), s);
  assert.equal(D.prioritize(s, 'zzz'), s);
  assert.equal(D.prioritize(s, 'a'), s, 'a running job is not reordered');
  assert.deepEqual(D.progress(s, 'zzz', 0.5).jobs, s.jobs);
});

test('prune returns the same state when nothing changes', () => {
  const s = D.enqueue(D.empty(), ['a', 'b']);
  assert.equal(D.prune(s, ['a', 'b', 'c']), s);
  assert.deepEqual(D.prune(s, ['a']).jobs.map((j) => j.id), ['a']);
});

test('backoff schedule is 1,2,3,5 then stays at 5 seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map(D.backoff), [1000, 2000, 3000, 5000, 5000, 5000]);
});

test('front enqueue of several ids keeps their relative order', () => {
  let s = D.enqueue(D.empty(), ['x']);
  s = D.enqueue(s, ['a', 'b'], true);
  assert.deepEqual(s.jobs.map((j) => j.id), ['a', 'b', 'x']);
});

test('minutesLeft rounds up', () => {
  const s = D.limited(D.enqueue(D.empty(), ['a']), 'a', T, 3);
  assert.equal(D.minutesLeft(s, T + 1), 3);
  assert.equal(D.minutesLeft(s, T + 2 * 60000 + 1), 1);
  assert.equal(D.minutesLeft(s, T + 10 * 60000), 0);
});
