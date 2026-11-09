import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { store } = await import('./store.js');
const { createPerf, PHASE_PREFIX } = await import('./perf.js');
const { phaseRows, createMeterCore } = await import('./latency-core.js');
const { coverButton, coverModel, showQueuePosition, QUEUED_LAZY, queueNote } = await import('./row-cover.js');
const { createQueueFollow } = await import('./queue-follow.js');
const { el } = await import('./dom.js');

test('store.get answers from a map: the first song with an id, rebuilt when the list is replaced or grows', () => {
  const a = { id: 'a', n: 1 };
  store.songs = [a, { id: 'a', n: 2 }, { id: 'b' }];
  assert.equal(store.get('a'), a);
  assert.equal(store.get('zzz'), undefined);
  const c = { id: 'c' };
  store.songs = [...store.songs, c];
  assert.equal(store.get('c'), c);
  store.songs.push({ id: 'd' });
  assert.equal(store.get('d').id, 'd');
  store.songs = [];
  assert.equal(store.get('a'), undefined);
});

function fakeWin(ls) {
  let t = 1000;
  const marks = [];
  const win = {
    location: { search: '', hash: '' },
    localStorage: { getItem: () => ls },
    performance: { now: () => t, mark: (n) => marks.push(n), measure: () => {} },
    requestAnimationFrame: () => {},
    document: { addEventListener: () => {} },
  };
  return { win, advance: (ms) => { t += ms; }, marks };
}

test('lmPhase while the meter is off only runs the function and records nothing', () => {
  const f = fakeWin(null);
  const p = createPerf({ win: f.win });
  let ran = 0;
  assert.equal(p.phase('x', () => { ran += 1; return 7; }), 7);
  assert.equal(ran, 1);
  assert.equal(f.marks.length, 0);
});

test('lmPhase while the meter is on marks the phase with its duration, also when the function throws', () => {
  const f = fakeWin('1');
  const p = createPerf({ win: f.win });
  const seen = [];
  p.onMark((name, t, detail) => seen.push([name, detail]));
  assert.equal(p.phase('render', () => { f.advance(12.34); return 'ok'; }), 'ok');
  assert.deepEqual(seen, [[`${PHASE_PREFIX}render`, '12.3 ms']]);
  assert.throws(() => p.phase('boom', () => { f.advance(2); throw new Error('x'); }), /x/);
  assert.deepEqual(seen[1], [`${PHASE_PREFIX}boom`, '2 ms']);
});

test('phaseRows sums the runs of a phase and lists the longest first; the Copy text has a phases section', () => {
  const marks = [
    { name: 'press', ms: 0, detail: 'pointerdown' },
    { name: 'phase: render: queue rows', ms: 20, detail: '10.5 ms' },
    { name: 'phase: library rows', ms: 40, detail: '30 ms' },
    { name: 'phase: render: queue rows', ms: 60, detail: '4.5 ms' },
    { name: 'phase: broken', ms: 70, detail: '' },
  ];
  assert.deepEqual(phaseRows(marks), [
    { name: 'library rows', ms: 30, runs: 1, endMs: 40 },
    { name: 'render: queue rows', ms: 15, runs: 2, endMs: 60 },
  ]);
  const core = createMeterCore();
  core.press(0, 'pointerdown');
  core.mark('phase: library rows', 40, '30 ms');
  core.mark('phase: render: queue rows', 25, '10 ms');
  const text = core.toText();
  assert.match(text, /phases \(ms of main-thread work/);
  const section = text.slice(text.indexOf('phases ('));
  assert.ok(section.indexOf('library rows') < section.indexOf('render: queue rows'), 'longest first');
  assert.match(section, /30 ms {2}library rows/);
});

test('a lazy queued cover says only "In the queue"; showQueuePosition fills in the exact position, and only for queued controls', () => {
  const b = coverButton(el('img'), coverModel({ audio: true, queueable: true, here: false }), 'Alpha', { run() {}, touch: false, queued: QUEUED_LAZY });
  assert.equal(b.title, 'Play Alpha. In the queue');
  assert.equal(b.getAttribute('aria-description'), 'In the queue');
  assert.ok(b.classList.contains('queued'));
  const act = el('button', { class: 'act-queue on', title: 'In the queue. Click to remove' });
  const row = el('li', {}, act, b);
  showQueuePosition(row, { pos: 7, total: 781 });
  assert.equal(b.title, 'Play Alpha. In the queue, position 7 of 781');
  assert.equal(b.getAttribute('aria-description'), 'In the queue, position 7 of 781');
  assert.equal(act.title, 'In the queue, position 7 of 781. Click to remove');
  showQueuePosition(row, null);
  assert.equal(b.title, 'Play Alpha. In the queue, position 7 of 781', 'a song that left the queue keeps what it had until it is rebuilt');
  const plain = coverButton(el('img'), coverModel({ audio: true, queueable: true, here: false }), 'Beta', { run() {}, touch: false });
  assert.equal(plain.getAttribute('data-label'), null);
  assert.equal(queueNote(null), '');
});

function followFixture(hidden) {
  const calls = [];
  const rows = Array.from({ length: 30 }, (_, i) => ({ getBoundingClientRect: () => ({ top: i * 60, height: 60 }) }));
  const list = {
    scrollTop: 0, clientHeight: 300, scrollHeight: 1800, children: rows, rects: 0,
    getClientRects() { this.rects += 1; return [1]; },
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener() {},
    scrollTo(o) { calls.push(o); },
  };
  const state = { hidden };
  const follow = createQueueFollow(list, { observe: false, reduced: () => false, hiddenFast: () => state.hidden });
  return { list, follow, calls, state };
}

test('the queue follow does not ask the layout while the page is hidden, and scrolls once it shows', () => {
  const f = followFixture(true);
  f.follow('a', 10);
  assert.equal(f.list.rects, 0);
  assert.equal(f.calls.length, 0);
  f.state.hidden = false;
  f.follow('a', 10);
  assert.equal(f.calls.length, 1);
});

test('resync scrolls to the current row again after the rows were built later', () => {
  const f = followFixture(false);
  f.follow('a', 10);
  f.calls.length = 0;
  f.follow('a', 10);
  assert.equal(f.calls.length, 0);
  f.follow.resync();
  assert.equal(f.calls.length, 1);
});
