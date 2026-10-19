import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { coverModel, coverLabel, coverButton, touchOnly, isRowControl, coverAttrs, currentCoverModel, queueCoverModel, paintQueueCovers, keepCovers } = await import('./row-cover.js');
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

test('Now playing covers: the current row follows play/pause, others start that item', () => {
  const cur = queueCoverModel(true, true);
  assert.deepEqual([cur.action, cur.persistent, cur.icon], ['pause', true, 'pause']);
  assert.equal(queueCoverModel(true, false).action, 'resume');
  const other = queueCoverModel(false, true);
  assert.deepEqual([other.action, other.persistent, other.icon], ['play', false, 'play']);
  assert.equal(coverLabel(other, 'Song A'), 'Play Song A');
  assert.equal(coverLabel(cur, 'Song A'), 'Pause Song A');
});

test('paintQueueCovers repaints rows in place and keeps the same buttons', () => {
  const mk = (n) => { const b = el('button', { class: 'row-cover', 'aria-label': 'x' }, el('span', { class: 'rc-ov' })); b.dataset.title = n; return el('li', { class: 'qrow' }, b); };
  const list = el('ul', {}, mk('A'), mk('B'));
  const before = list.querySelectorAll('.row-cover');
  paintQueueCovers(list, 1, true, (r) => r.querySelector('.row-cover').dataset.title);
  const after = list.querySelectorAll('.row-cover');
  assert.equal(before[1], after[1]);
  assert.equal(after[1].getAttribute('aria-label'), 'Pause B');
  assert.equal(after[0].getAttribute('aria-label'), 'Play A');
});

test('keepCovers moves a loaded cover into the rebuilt row with the same source and leaves others alone', () => {
  const row = (id, src) => {
    const img = el('img', { class: 'cover' });
    if (src) img.setAttribute('src', src);
    return el('li', { class: 'song', 'data-id': id }, el('button', { class: 'row-cover' }, img));
  };
  const prev = [row('a', '/covers/a?v=1'), row('b', '/covers/b?v=1'), row('c', null)];
  const next = [row('a', '/covers/a?v=1'), row('b', '/covers/b?v=2'), row('c', null), row('d', '/covers/d')];
  const kept = prev[0].querySelector('img');
  const freshB = next[1].querySelector('img');
  const freshC = next[2].querySelector('img');
  keepCovers(prev, next);
  assert.equal(next[0].querySelector('img'), kept);
  assert.equal(next[1].querySelector('img'), freshB);
  assert.equal(next[2].querySelector('img'), freshC);
  assert.equal(next[3].querySelector('img').getAttribute('src'), '/covers/d');
  assert.equal(prev[0].querySelector('img'), null);
});

test('coverButton queue mark: passive corner badge only when queued; the playing control stays and keeps its label', () => {
  const img = document.createElement('img');
  const base = { audio: true, queueable: true, here: true, playing: true };
  const plain = coverButton(img, coverModel(base), 'Alpha', { run() {}, touch: false });
  assert.equal(plain.querySelector('.q-mark'), null);
  assert.equal(plain.getAttribute('aria-label'), 'Pause Alpha');
  const q = coverButton(document.createElement('img'), coverModel(base), 'Alpha', { run() {}, touch: true, queued: { pos: 2, total: 5 } });
  const mark = q.querySelector('.q-mark');
  assert.equal(mark.getAttribute('aria-hidden'), 'true');
  assert.equal(mark.querySelector('button'), null);
  assert.ok(q.classList.contains('act-pause') && q.classList.contains('persist') && q.classList.contains('queued'));
  assert.ok(q.querySelector('.rc-ov'), 'the playing overlay is still there');
  assert.equal(q.getAttribute('aria-label'), 'Pause Alpha');
  assert.equal(q.getAttribute('aria-description'), 'In the queue, position 2 of 5');
  assert.equal(q.title, 'Pause Alpha. In the queue, position 2 of 5');
});
