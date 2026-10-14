import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { coverModel, coverLabel, coverButton, touchOnly, isRowControl, coverAttrs, currentCoverModel } = await import('./row-cover.js');
const { el } = await import('./dom.js');

const base = { audio: true, queueable: true, here: false, playing: false, dl: 'none' };

test('a non-current playable row offers Play on hover only', () => {
  const m = coverModel(base);
  assert.deepEqual([m.action, m.persistent, m.verb, m.icon], ['play', false, 'Play', 'play']);
});

test('the current song shows Pause while playing and Play while paused, both persistent', () => {
  const on = coverModel({ ...base, here: true, playing: true });
  assert.deepEqual([on.action, on.persistent, on.icon, on.verb], ['pause', true, 'pause', 'Pause']);
  const off = coverModel({ ...base, here: true, playing: false });
  assert.deepEqual([off.action, off.persistent, off.icon, off.verb], ['resume', true, 'play', 'Play']);
});

test('without audio and with Auto-download on, the row plays like Play now', () => {
  assert.equal(coverModel({ ...base, audio: false, queueable: true }).action, 'play');
});

test('without audio and Auto-download off, the cover downloads', () => {
  const m = coverModel({ ...base, audio: false, queueable: false });
  assert.deepEqual([m.action, m.icon, m.verb], ['download', 'download', 'Download']);
  assert.equal(coverModel({ audio: false, queueable: false, here: false, playing: false, dl: 'failed' }).action, 'download');
});

test('while a download runs the cover is inert', () => {
  const m = coverModel({ audio: false, queueable: false, here: false, playing: false, dl: 'running' });
  assert.equal(m.action, 'none');
  assert.equal(m.disabled, true);
});

test('coverLabel names the song', () => {
  assert.equal(coverLabel(coverModel(base), 'Alpha'), 'Play Alpha');
  assert.equal(coverLabel(coverModel({ ...base, here: true, playing: true }), 'Alpha'), 'Pause Alpha');
});

test('touchOnly reads (hover: none) from the injected matchMedia and survives failures', () => {
  assert.equal(touchOnly((q) => ({ matches: q === '(hover: none)' })), true);
  assert.equal(touchOnly(() => ({ matches: false })), false);
  assert.equal(touchOnly(() => { throw new Error('x'); }), false);
  assert.equal(touchOnly(null), false);
});

test('coverButton is a real button with an aria-label, an overlay icon and a tooltip off touch', () => {
  const calls = [];
  const img = el('img', { class: 'cover', alt: '' });
  const b = coverButton(img, coverModel(base), 'Alpha', { run: (a) => calls.push(a), touch: false });
  assert.equal(b.localName, 'button');
  assert.equal(b.getAttribute('aria-label'), 'Play Alpha');
  assert.equal(b.title, 'Play Alpha');
  assert.ok(b.querySelector('.rc-ov svg'));
  assert.ok(b.contains(img));
  b.click();
  assert.deepEqual(calls, ['play']);
  const t = coverButton(img, coverModel({ ...base, here: true, playing: true }), 'Alpha', { run() {}, touch: true });
  assert.ok(t.classList.contains('persist'));
  assert.equal(t.getAttribute('title'), null);
  const d = coverButton(img, coverModel({ ...base, audio: false, queueable: false, dl: 'running' }), 'Alpha', { run() {} });
  assert.equal(d.disabled, true);
});

test('isRowControl is true for links and buttons except the title button', () => {
  const li = el('li', {}, el('a', { href: 'x' }, el('b')), el('button', { class: 'open' }, el('i')), el('button', { class: 'more' }, el('i')), el('span'));
  const [a, title, more, span] = li.childNodes;
  assert.equal(isRowControl(a.firstChild), true);
  assert.equal(isRowControl(title.firstChild), false);
  assert.equal(isRowControl(more.firstChild), true);
  assert.equal(isRowControl(span), false);
  assert.equal(isRowControl(null), false);
});

test('currentCoverModel is the library state of the current song', () => {
  const p = currentCoverModel(true);
  assert.deepEqual([p.action, p.verb, p.icon, p.persistent], ['pause', 'Pause', 'pause', true]);
  const r = currentCoverModel(false);
  assert.deepEqual([r.action, r.verb, r.icon, r.persistent], ['resume', 'Play', 'play', true]);
});

test('coverAttrs gives label, class and tooltip (none on touch)', () => {
  const a = coverAttrs(currentCoverModel(true), 'Alpha', false, 'cover-btn');
  assert.equal(a.label, 'Pause Alpha');
  assert.equal(a.title, 'Pause Alpha');
  assert.equal(a.cls, 'row-cover cover-btn act-pause persist');
  assert.equal(a.disabled, false);
  assert.equal(coverAttrs(currentCoverModel(false), 'Alpha', true).title, null);
});
