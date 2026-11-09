import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChunks, nextTask, restoreFocus, CHUNK_BUDGET_MS } from './defer.js';

test('a short list runs at once and calls done', () => {
  const seen = [];
  let done = 0;
  runChunks({ count: 3, step: (i) => seen.push(i), done: () => { done += 1; }, syncBelow: 5, later: () => assert.fail('no yield') });
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(done, 1);
});

test('a long list yields to the browser once the budget is used and resumes where it stopped', () => {
  let t = 0;
  const queue = [];
  const seen = [];
  let done = 0;
  runChunks({ count: 10, step: (i) => { seen.push(i); t += 3; }, done: () => { done += 1; }, budgetMs: 8, now: () => t, later: (fn) => queue.push(fn) });
  assert.deepEqual(seen, [0, 1, 2], 'three steps of 3 ms reach the 8 ms budget');
  assert.equal(queue.length, 1);
  assert.equal(done, 0);
  while (queue.length) queue.shift()();
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(done, 1);
});

test('cancel stops the remaining slices and done is not called', () => {
  let t = 0;
  const queue = [];
  const seen = [];
  let done = 0;
  const cancel = runChunks({ count: 10, step: (i) => { seen.push(i); t += 5; }, done: () => { done += 1; }, budgetMs: 8, now: () => t, later: (fn) => queue.push(fn) });
  cancel();
  queue.shift()();
  assert.deepEqual(seen, [0, 1]);
  assert.equal(queue.length, 0);
  assert.equal(done, 0);
});

test('the default budget is a few milliseconds, well under a long task', () => {
  assert.ok(CHUNK_BUDGET_MS > 0 && CHUNK_BUDGET_MS <= 10);
});

test('restoreFocus gives the focus back at the next frame, only when it was lost or still on the replaced control', () => {
  const frames = [];
  const win = { requestAnimationFrame: (fn) => frames.push(fn) };
  const body = {};
  const old = {};
  const target = { focused: 0, isConnected: true, focus() { this.focused += 1; } };
  const doc = { body, activeElement: old };
  restoreFocus(target, old, doc, win);
  assert.equal(target.focused, 0, 'nothing inside the press');
  frames.shift()();
  assert.equal(target.focused, 1);
  doc.activeElement = {};
  restoreFocus(target, old, doc, win);
  frames.shift()();
  assert.equal(target.focused, 1, 'the user moved on: the focus stays where it is');
  doc.activeElement = body;
  target.isConnected = false;
  restoreFocus(target, old, doc, win);
  frames.shift()();
  assert.equal(target.focused, 1, 'the control left the page');
  restoreFocus(null, old, doc, win);
  assert.equal(frames.length, 0);
});

test('nextTask uses scheduler.postTask when there is one, else a timer', async () => {
  const calls = [];
  nextTask(() => calls.push('a'), { scheduler: { postTask: (fn, o) => { calls.push(o.priority); fn(); return Promise.resolve(); } } });
  assert.deepEqual(calls, ['user-visible', 'a']);
  await new Promise((resolve) => { nextTask(resolve, {}); });
});
