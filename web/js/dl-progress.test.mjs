import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percent, ringModel, statusText, CIRC } from './dl-progress.js';
import * as D from './dl-queue.js';

test('percent clamps and survives junk', () => {
  assert.equal(percent(0.426), 43);
  assert.equal(percent(-1), 0);
  assert.equal(percent(7), 100);
  assert.equal(percent(NaN), 0);
  assert.equal(percent(undefined), 0);
  assert.equal(percent('0.5'), 50);
});

test('downloading: ring offset follows the percent, aria says so', () => {
  const m = ringModel({ kind: 'downloading', progress: 0.42 });
  assert.equal(m.label, 'Downloading 42%');
  assert.equal(m.now, 42);
  assert.equal(m.text, '42');
  assert.equal(m.line, 42);
  assert.equal(m.role, 'progressbar');
  assert.ok(Math.abs(m.offset - CIRC * 0.58) < 0.01);
  assert.equal(ringModel({ kind: 'downloading', progress: 0 }).offset, CIRC);
  assert.equal(ringModel({ kind: 'downloading', progress: 5 }).offset, 0);
});

test('queued, paused and converting are indeterminate (no aria-valuenow)', () => {
  const q = ringModel({ kind: 'queued' });
  assert.deepEqual([q.label, q.now, q.idle, q.dash], ['Queued', null, true, '3 4']);
  const p = ringModel({ kind: 'paused', minutes: 3 });
  assert.equal(p.label, 'Paused - resumes in 3 min');
  assert.equal(p.now, null);
  const c = ringModel({ kind: 'converting', progress: 1 });
  assert.deepEqual([c.label, c.now, c.indeterminate, c.line], ['Converting', null, true, 100]);
});

test('failed is an actionable button; done is complete; none is nothing', () => {
  const f = ringModel({ kind: 'failed', error: 'boom' });
  assert.deepEqual([f.role, f.actionable, f.label], ['button', true, 'Failed - click to retry']);
  const d = ringModel({ kind: 'done', progress: 1 });
  assert.deepEqual([d.now, d.offset, d.label], [100, 0, 'Done']);
  assert.equal(ringModel({ kind: 'none' }), null);
  assert.equal(ringModel(undefined), null);
});

test('statusText for queue rows and the mini-player', () => {
  assert.equal(statusText({ kind: 'downloading', progress: 0.42 }), 'Downloading 42%');
  assert.equal(statusText({ kind: 'downloading', progress: 0 }), 'Downloading...');
  assert.equal(statusText({ kind: 'converting' }), 'Converting');
  assert.equal(statusText({ kind: 'queued' }, true), 'Queued');
  assert.equal(statusText({ kind: 'queued' }), 'Queued for download');
  assert.equal(statusText({ kind: 'failed', error: 'x' }), 'Download failed: x');
  assert.equal(statusText({ kind: 'none' }), 'Not downloaded');
});

test('queue states map onto views: converting, remote queue, finishing', () => {
  let s = D.started(D.enqueue(D.empty(), ['a']), 'a');
  assert.equal(D.view(s, 'a', 0).kind, 'downloading');
  s = D.progress(s, 'a', 0, { remote: 'queued' });
  assert.equal(D.view(s, 'a', 0).kind, 'queued');
  s = D.progress(s, 'a', 0.5, { remote: 'downloading', speed: 100, eta: 3 });
  const v = D.view(s, 'a', 0);
  assert.deepEqual([v.kind, v.progress, v.speed, v.eta], ['downloading', 0.5, 100, 3]);
  s = D.progress(s, 'a', 1, { converting: true, remote: 'converting' });
  assert.equal(D.view(s, 'a', 0).kind, 'converting');
  assert.equal(D.active(s), 1);
  s = D.finishing(s, 'a');
  assert.deepEqual([D.view(s, 'a', 0).kind, D.view(s, 'a', 0).progress], ['done', 1]);
  assert.equal(D.active(s), 1);
  s = D.failed(s, 'a', 'x');
  assert.equal(D.view(D.retry(s, 'a'), 'a', 0).kind, 'queued');
});
