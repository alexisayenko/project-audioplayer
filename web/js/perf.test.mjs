import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerf, readEnabled } from './perf.js';

function fakeWin({ ls = null, search = '', hash = '', observer = true } = {}) {
  let t = 1000;
  const frames = [];
  const clicks = [];
  const logs = [];
  const marks = [];
  const f = { resources: [] };
  const win = {
    location: { search, hash },
    localStorage: ls === null ? undefined : { getItem: (k) => (k === 'ap2.perf' ? ls : null) },
    performance: { now: () => t, getEntriesByType: () => f.resources, mark: (n, o) => marks.push([n, o?.startTime]), measure: () => {} },
    requestAnimationFrame: (fn) => frames.push(fn),
    document: { addEventListener: (type, fn) => { if (type === 'click') clicks.push(fn); } },
    console: { log: (...a) => logs.push(['log', ...a]), table: (r) => logs.push(['table', r]) },
  };
  if (observer) {
    win.PerformanceObserver = class {
      constructor(cb) { win.longtask = cb; }
      observe() {}
    };
  }
  return Object.assign(f, { win, advance: (ms) => { t += ms; }, frames, clicks, logs, marks });
}

function fakeAudio() {
  const a = new EventTarget();
  a.readyState = 0;
  a.currentTime = 0;
  return a;
}
const fire = (a, type) => a.dispatchEvent(new Event(type));

test('disabled by default: no listeners, no global, no marks', () => {
  const f = fakeWin();
  const p = createPerf({ win: f.win });
  assert.equal(p.enabled, false);
  p.mark('x');
  p.begin();
  assert.equal(f.clicks.length, 0);
  assert.equal(f.win.__ap2perf, undefined);
  assert.equal(f.marks.length, 0);
  const a = fakeAudio();
  let added = 0;
  a.addEventListener = () => { added += 1; };
  p.watchAudio(a);
  assert.equal(added, 0);
  const promise = Promise.resolve(1);
  assert.equal(p.track(promise), promise);
});

test('enabled by localStorage, ?perf=1 and #perf=1', () => {
  assert.equal(readEnabled(fakeWin({ ls: '1' }).win), true);
  assert.equal(readEnabled(fakeWin({ ls: '0' }).win), false);
  assert.equal(readEnabled(fakeWin({ search: '?a=1&perf=1' }).win), true);
  assert.equal(readEnabled(fakeWin({ hash: '#/library?perf=1' }).win), true);
  assert.equal(readEnabled(fakeWin({ hash: '#perf=10' }).win), false);
  assert.equal(readEnabled({ get localStorage() { throw new Error('blocked'); } }), false);
});

test('a click starts a session; the first playing prints one table; __ap2perf returns it', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  const a = fakeAudio();
  p.watchAudio(a);
  p.watchAudio(a);
  f.clicks[0]({ target: { tagName: 'BUTTON', id: 'mini-play' } });
  f.advance(5);
  p.mark('load() entry');
  f.advance(10);
  fire(a, 'loadstart');
  f.advance(100);
  fire(a, 'loadedmetadata');
  fire(a, 'seeking');
  f.advance(8000);
  fire(a, 'timeupdate');
  fire(a, 'timeupdate');
  fire(a, 'playing');
  const tables = f.logs.filter((l) => l[0] === 'table');
  assert.equal(tables.length, 3);
  const rows = tables[0][1];
  assert.deepEqual(rows.map((r) => r.mark), ['click', 'load() entry', 'audio:loadstart', 'audio:loadedmetadata', 'audio:seeking', 'audio:timeupdate', 'audio:playing']);
  assert.equal(rows[0].ms, 0);
  assert.equal(rows[0].detail, 'button#mini-play');
  assert.equal(rows[6].ms, 8115);
  assert.equal(rows[5].since_prev, 8000);
  assert.equal(rows[6].since_prev, 0);
  assert.equal(rows[3].since_prev, 100);
  assert.deepEqual(f.win.__ap2perf().map((r) => r.mark), rows.map((r) => r.mark));
  fire(a, 'playing');
  assert.equal(f.logs.filter((l) => l[0] === 'table').length, 3);
});

test('slowest list ranks the biggest gap between marks first', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  p.begin('click');
  f.advance(20);
  p.mark('a');
  f.advance(9000);
  p.mark('b');
  assert.equal(p.slowest()[0].between, 'a -> b');
  assert.equal(p.slowest()[0].ms, 9000);
});

test('long tasks and slow frames are recorded as gaps; fast ones are not', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  p.begin('click');
  f.win.longtask({ getEntries: () => [{ startTime: 1100, duration: 300 }, { startTime: 1500, duration: 20 }] });
  f.advance(16);
  f.frames.shift()();
  f.advance(450);
  f.frames.shift()();
  const gaps = p.table().filter((r) => r.mark.startsWith('gap:'));
  assert.deepEqual(gaps.map((g) => [g.mark, g.dur]), [['gap:frame', 450], ['gap:longtask', 300]]);
});

test('works without PerformanceObserver (Safari)', () => {
  const f = fakeWin({ ls: '1', observer: false });
  const p = createPerf({ win: f.win });
  p.begin('click');
  assert.equal(p.enabled, true);
});

test('a second click inside a session is marked, not restarted', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  f.clicks[0]({ target: { tagName: 'LI' } });
  f.advance(50);
  f.clicks[0]({ target: { tagName: 'LI' } });
  assert.deepEqual(p.table().map((r) => r.mark), ['click', 'click again']);
});

test('track marks resolved and rejected play() and returns the same promise', async () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  p.begin('click');
  const ok = Promise.resolve();
  assert.equal(p.track(ok), ok);
  await ok;
  const bad = Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
  p.track(bad).catch(() => {});
  await bad.catch(() => {});
  const rows = p.table();
  assert.ok(rows.some((r) => r.mark === 'play() resolved'));
  assert.ok(rows.some((r) => r.mark === 'play() rejected' && r.detail === 'NotAllowedError'));
});

test('the ring buffer keeps only the latest marks', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  p.begin('click');
  for (let i = 0; i < 400; i += 1) p.mark(`m${i}`);
  assert.equal(p.table().length, 300);
});

test('resource table counts cover requests since the start and shows the audio request queue time', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  f.resources.push({ name: 'https://x/covers/old.jpg', initiatorType: 'img', startTime: 10, transferSize: 999 });
  f.advance(10);
  p.begin('click');
  const img = (name, size) => ({ name, initiatorType: 'img', startTime: 1100, transferSize: size });
  f.resources.push(img('https://x/covers/a.jpg', 1000), img('https://x/covers/a.jpg', 1000), img('https://x/covers/b.jpg', 500), img('https://x/other.png', 7));
  f.resources.push({ name: 'https://x/files/abc', initiatorType: 'other', startTime: 1010, requestStart: 1900, responseStart: 2000, responseEnd: 2200, transferSize: 6000 });
  const rows = p.resources();
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].distinct_urls, 2);
  assert.equal(rows[0].urls_requested_more_than_once, 1);
  assert.equal(rows[0].bytes, 2500);
  assert.equal(rows[1].queued_ms, 890);
  assert.equal(rows[1].response_start_ms, 990);
  assert.equal(f.win.__ap2perf.resources().length, 2);
});

test('onMark hands every mark to the subscriber until it unsubscribes; disabled it is a no-op', () => {
  const f = fakeWin({ ls: '1' });
  const p = createPerf({ win: f.win });
  const seen = [];
  const off = p.onMark((name, t, detail) => seen.push([name, t, detail]));
  p.mark('a', 'x');
  off();
  p.mark('b');
  assert.deepEqual(seen, [['a', 1000, 'x']]);
  const quiet = createPerf({ win: fakeWin().win });
  assert.equal(typeof quiet.onMark(() => {}), 'function');
});
