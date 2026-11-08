import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const L = await import('./cover-loader.js');

const imgs = (n, tag = 'c') => Array.from({ length: n }, (_, i) => {
  const img = document.createElement('img');
  img.dataset.src = `/covers/${tag}${i}`;
  document.body.append(img);
  return img;
});
const srcs = (list) => list.filter((i) => i.getAttribute('src')).length;
const settle = (img) => img.dispatchEvent(new globalThis.Event('load'));

class Media {
  constructor() { this.on = {}; }
  addEventListener(name, fn) { (this.on[name] ||= []).push(fn); }
  fire(name) { (this.on[name] || []).forEach((fn) => fn()); }
}

beforeEach(() => L.resetCoverLoader());

test('at most 3 covers load at once; each finished load starts the next', () => {
  const list = imgs(8);
  list.forEach((i) => L.queueCover(i));
  assert.equal(srcs(list), 3);
  assert.deepEqual(L.coverLoadState(), { paused: false, loading: 3, waiting: 5 });
  settle(list[0]);
  assert.equal(srcs(list), 4);
  list[1].dispatchEvent(new globalThis.Event('error'));
  assert.equal(srcs(list), 5);
  for (let i = 2; i < 8; i += 1) settle(list[i]);
  settle(list[3]); settle(list[4]); settle(list[5]);
  assert.equal(srcs(list), 8);
  assert.equal(L.coverLoadState().loading, 0);
});

test('a hung load gives its slot back after the slot timeout', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const list = imgs(4);
  list.forEach((i) => L.queueCover(i));
  assert.equal(srcs(list), 3);
  t.mock.timers.tick(L.SLOT_TIMEOUT_MS);
  assert.equal(srcs(list), 4);
});

test('starting a song pauses the queue until canplay', () => {
  const audio = new Media();
  L.watchMedia(audio);
  const list = imgs(5);
  audio.fire('loadstart');
  list.forEach((i) => L.queueCover(i));
  assert.equal(srcs(list), 0);
  assert.equal(L.coverLoadState().paused, true);
  audio.fire('canplay');
  assert.equal(srcs(list), 3);
  assert.equal(L.coverLoadState().paused, false);
});

test('playing, error, emptied and abort also resume', () => {
  for (const ev of ['playing', 'error', 'emptied', 'abort']) {
    L.resetCoverLoader();
    const audio = new Media();
    L.watchMedia(audio);
    const [img] = imgs(1, ev);
    audio.fire('loadstart');
    L.queueCover(img);
    assert.equal(srcs([img]), 0, ev);
    audio.fire(ev);
    assert.equal(srcs([img]), 1, ev);
  }
});

test('covers are never starved: the pause ends after 8 s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new Media();
  L.watchMedia(audio);
  const list = imgs(2);
  audio.fire('loadstart');
  list.forEach((i) => L.queueCover(i));
  t.mock.timers.tick(L.PAUSE_TIMEOUT_MS - 1);
  assert.equal(srcs(list), 0);
  t.mock.timers.tick(1);
  assert.equal(srcs(list), 2);
});

test('a new load restarts the pause timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new Media();
  L.watchMedia(audio);
  const [img] = imgs(1);
  audio.fire('loadstart');
  t.mock.timers.tick(5000);
  audio.fire('loadstart');
  L.queueCover(img);
  t.mock.timers.tick(5000);
  assert.equal(srcs([img]), 0);
  t.mock.timers.tick(3000);
  assert.equal(srcs([img]), 1);
});

test('the current song cover is exempt from the pause and the cap', () => {
  const audio = new Media();
  L.watchMedia(audio);
  audio.fire('loadstart');
  const [now, ...rest] = imgs(4);
  rest.forEach((i) => L.queueCover(i));
  L.loadCoverNow(now);
  assert.equal(now.getAttribute('src'), '/covers/c0');
  assert.equal(srcs(rest), 0);
  assert.equal(L.coverLoadState().loading, 0);
});

test('dropped (scrolled away) and disconnected covers are not loaded', () => {
  const audio = new Media();
  L.watchMedia(audio);
  audio.fire('loadstart');
  const [a, b, c] = imgs(3);
  [a, b, c].forEach((i) => L.queueCover(i));
  L.dropCover(a);
  Object.defineProperty(b, 'isConnected', { value: false });
  audio.fire('canplay');
  assert.equal(a.getAttribute('src'), null);
  assert.equal(b.getAttribute('src'), null);
  assert.equal(c.getAttribute('src'), '/covers/c2');
});

test('front puts rows ahead of the queue, in order', () => {
  const audio = new Media();
  L.watchMedia(audio);
  audio.fire('loadstart');
  const [x, ...first] = imgs(4);
  L.queueCover(x);
  L.queueCovers(first, { front: true });
  audio.fire('canplay');
  assert.deepEqual(first.map((i) => i.getAttribute('src')), ['/covers/c1', '/covers/c2', '/covers/c3']);
  assert.equal(x.getAttribute('src'), null);
  settle(first[0]);
  assert.equal(x.getAttribute('src'), '/covers/c0');
});

test('an image already showing its cover is not queued again', () => {
  const [img] = imgs(1);
  img.setAttribute('src', '/covers/c0');
  L.queueCover(img);
  assert.deepEqual(L.coverLoadState(), { paused: false, loading: 0, waiting: 0 });
});
