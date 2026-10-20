import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueFollow, USER_SCROLL_MS } from './queue-follow.js';

function setup({ visible = true, reduce = false } = {}) {
  const calls = [];
  const handlers = {};
  let t = 10000;
  const rows = Array.from({ length: 50 }, (_, i) => ({ getBoundingClientRect: () => ({ top: i * 60 - list.scrollTop, height: 60 }) }));
  const list = {
    visible,
    scrollTop: 0, clientHeight: 300, scrollHeight: 3000,
    children: rows,
    getClientRects() { return this.visible ? [1] : []; },
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener(n, fn) { handlers[n] = fn; },
    scrollTo(o) { calls.push(o); },
  };
  const follow = createQueueFollow(list, { now: () => t, reduced: () => reduce, observe: false });
  return { list, follow, calls, handlers, tick: (ms) => { t += ms; } };
}

test('song change scrolls the row to the centre, smooth', () => {
  const s = setup();
  s.follow('a', 0);
  s.calls.length = 0;
  s.follow('b', 20);
  assert.deepEqual(s.calls, [{ top: 20 * 60 + 30 - 150, behavior: 'smooth' }]);
});

test('repaint of the same song does not scroll', () => {
  const s = setup();
  s.follow('a', 5);
  s.calls.length = 0;
  s.follow('a', 5);
  s.follow('a', 5);
  assert.equal(s.calls.length, 0);
});

test('play and pause repaints (same song) do not scroll', () => {
  const s = setup();
  s.follow('a', 5);
  s.calls.length = 0;
  for (let i = 0; i < 3; i++) s.follow('a', 5);
  assert.equal(s.calls.length, 0);
});

test('first sight with a song current scrolls instantly', () => {
  const s = setup();
  s.follow('a', 30);
  assert.deepEqual(s.calls, [{ top: 30 * 60 + 30 - 150, behavior: 'auto' }]);
});

test('opening a hidden list scrolls once it is visible, even for an unchanged song', () => {
  const s = setup({ visible: false });
  s.follow('a', 30);
  assert.equal(s.calls.length, 0);
  s.follow('b', 31);
  assert.equal(s.calls.length, 0);
  s.list.visible = true;
  s.follow('b', 31);
  assert.deepEqual(s.calls, [{ top: 31 * 60 + 30 - 150, behavior: 'auto' }]);
  s.follow('b', 31);
  assert.equal(s.calls.length, 1);
});

test('no current song does nothing and resets', () => {
  const s = setup();
  s.follow(null, -1);
  assert.equal(s.calls.length, 0);
  s.follow('a', 2);
  s.follow(null, -1);
  s.follow('a', 2);
  assert.equal(s.calls.length, 2);
});

test('user scroll guard skips an open scroll but not a real song change', () => {
  const s = setup({ visible: false });
  s.follow('a', 30);
  s.handlers.wheel();
  s.tick(USER_SCROLL_MS - 100);
  s.list.visible = true;
  s.follow('a', 30);
  assert.equal(s.calls.length, 1, 'first sight is a song change, so it scrolls');
  s.list.visible = false;
  s.follow('a', 30);
  s.handlers.touchmove();
  s.list.visible = true;
  s.follow('a', 30);
  assert.equal(s.calls.length, 1, 'open within 2 s of a user scroll is skipped');
  s.follow('b', 40);
  assert.equal(s.calls.length, 2);
  s.list.visible = false;
  s.follow('b', 40);
  s.tick(USER_SCROLL_MS + 1);
  s.list.visible = true;
  s.follow('b', 40);
  assert.equal(s.calls.length, 3);
});

test('reduced motion scrolls instantly on a change', () => {
  const s = setup({ reduce: true });
  s.follow('a', 0);
  s.follow('b', 20);
  assert.equal(s.calls.at(-1).behavior, 'auto');
});

test('target is clamped at the list ends', () => {
  const s = setup();
  s.follow('a', 0);
  assert.equal(s.calls[0].top, 0);
  s.follow('b', 49);
  assert.equal(s.calls.at(-1).top, 2700);
});
