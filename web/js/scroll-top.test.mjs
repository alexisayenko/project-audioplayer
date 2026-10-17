import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

const { document: doc } = installDom();
const { SCROLL_SCREENS, shouldShow, mountScrollTop } = await import('./scroll-top.js');

function fakeWin({ reduce = false } = {}) {
  const listeners = new Map();
  const win = {
    scrollY: 0, innerHeight: 800, frames: [], scrolls: [],
    addEventListener(t, fn, opts) { listeners.set(t, [...(listeners.get(t) || []), { fn, opts }]); },
    removeEventListener(t, fn) { listeners.set(t, (listeners.get(t) || []).filter((l) => l.fn !== fn)); },
    count: (t) => (listeners.get(t) || []).length,
    opts: (t) => listeners.get(t)?.[0]?.opts,
    emit(t) { (listeners.get(t) || []).forEach((l) => l.fn({ type: t })); },
    requestAnimationFrame(fn) { win.frames.push(fn); return win.frames.length; },
    runFrames() { const f = win.frames.splice(0); f.forEach((fn) => fn()); },
    scrollTo(o) { win.scrolls.push(o); },
    matchMedia: () => ({ matches: reduce }),
  };
  return win;
}
const buttons = () => doc.body.children.filter((c) => c.classList.contains('scroll-top'));

test('shouldShow: exactly 2 screens is hidden, beyond is shown', () => {
  assert.equal(SCROLL_SCREENS, 2);
  assert.equal(shouldShow(0, 800), false);
  assert.equal(shouldShow(1600, 800), false);
  assert.equal(shouldShow(1601, 800), true);
  assert.equal(shouldShow(5000, 800), true);
});

test('shouldShow: bad inputs are hidden', () => {
  for (const [y, h] of [[NaN, 800], [1000, NaN], [undefined, 800], [1000, undefined], [1000, 0], [1000, -5], [Infinity, 800], [1000, Infinity], [null, 800]]) {
    assert.equal(shouldShow(y, h), false, `${y}/${h}`);
  }
});

test('mount creates a hidden, labelled button with the arrow icon in the body', () => {
  const win = fakeWin();
  const destroy = mountScrollTop(doc, win);
  const [btn] = buttons();
  assert.equal(buttons().length, 1);
  assert.equal(btn.getAttribute('aria-label'), 'Scroll to top');
  assert.equal(btn.getAttribute('title'), 'Scroll to top');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.classList.contains('shown'), false);
  assert.ok(btn.children[0].innerHTML.includes('M12 19V5'));
  assert.equal(win.opts('scroll').passive, true);
  destroy();
});

test('button shows after scrolling beyond 2 screens and hides again', () => {
  const win = fakeWin();
  const destroy = mountScrollTop(doc, win);
  const [btn] = buttons();
  win.scrollY = 2000;
  win.emit('scroll');
  assert.equal(btn.classList.contains('shown'), false);
  win.runFrames();
  assert.equal(btn.classList.contains('shown'), true);
  win.scrollY = 1600;
  win.emit('scroll');
  win.runFrames();
  assert.equal(btn.classList.contains('shown'), false);
  destroy();
});

test('scroll events are throttled to one frame', () => {
  const win = fakeWin();
  const destroy = mountScrollTop(doc, win);
  win.emit('scroll'); win.emit('scroll'); win.emit('scroll');
  assert.equal(win.frames.length, 1);
  win.runFrames();
  win.emit('scroll');
  assert.equal(win.frames.length, 1);
  destroy();
});

test('resize re-evaluates against the new viewport height', () => {
  const win = fakeWin();
  win.scrollY = 1000;
  const destroy = mountScrollTop(doc, win);
  const [btn] = buttons();
  assert.equal(btn.classList.contains('shown'), false);
  win.innerHeight = 400;
  win.emit('resize');
  win.runFrames();
  assert.equal(btn.classList.contains('shown'), true);
  destroy();
});

test('mounting at an already scrolled position shows the button at once', () => {
  const win = fakeWin();
  win.scrollY = 3000;
  const destroy = mountScrollTop(doc, win);
  assert.equal(buttons()[0].classList.contains('shown'), true);
  destroy();
});

test('click scrolls to the top smoothly, or instantly under reduced motion', () => {
  for (const [reduce, behavior] of [[false, 'smooth'], [true, 'auto']]) {
    const win = fakeWin({ reduce });
    const destroy = mountScrollTop(doc, win);
    buttons()[0].dispatchEvent({ type: 'click', bubbles: true, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(win.scrolls, [{ top: 0, behavior }]);
    destroy();
  }
});

test('destroy removes the button and the listeners', () => {
  const win = fakeWin();
  const destroy = mountScrollTop(doc, win);
  assert.equal(win.count('scroll'), 1);
  assert.equal(win.count('resize'), 1);
  destroy();
  assert.equal(buttons().length, 0);
  assert.equal(win.count('scroll'), 0);
  assert.equal(win.count('resize'), 0);
  destroy();
  assert.equal(buttons().length, 0);
});

test('mounting twice leaves one button and one set of listeners', () => {
  const win = fakeWin();
  const first = mountScrollTop(doc, win);
  const second = mountScrollTop(doc, win);
  assert.equal(buttons().length, 1);
  assert.equal(win.count('scroll'), 1);
  first();
  assert.equal(buttons().length, 1);
  second();
  assert.equal(buttons().length, 0);
});
