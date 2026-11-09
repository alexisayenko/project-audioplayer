import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueueView, SYNC_ROWS } from './queue-view.js';

function fixture({ count = 5, tracked = false, chunk = {} } = {}) {
  const list = {
    children: [],
    ownerDocument: { activeElement: null },
    replaceChildren(...rows) { this.children = rows; for (const r of rows) r.parentNode = this; },
  };
  const row = (id, i, s) => ({
    id, i, current: i === s.index, playing: s.playing, painted: 0, parentNode: null,
    replaceWith(next) { list.children[list.children.indexOf(this)] = next; next.parentNode = list; },
    contains: () => false,
    querySelector: () => null,
  });
  const st = { items: Array.from({ length: count }, (_, i) => ({ id: `s${i}` })), index: 0, playing: false };
  const built = [];
  const painted = [];
  const events = [];
  let observer = null;
  const section = { hidden: false };
  const win = tracked ? { MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} } } : {};
  const view = createQueueView({
    list,
    section: tracked ? section : null,
    state: () => ({ items: st.items, index: st.index, playing: st.playing }),
    buildRow: (item, i, s) => { built.push(item.id); return row(item.id, i, s); },
    paintPlaying: (r, i, s) => { painted.push(i); r.playing = s.playing; },
    onRebuild: () => events.push('rebuild'),
    onBuilt: () => events.push('built'),
    win,
    chunk,
  });
  return { view, list, st, built, painted, events, section, show: () => { section.hidden = false; observer(); }, ids: () => list.children.map((r) => r.id) };
}

test('the first update builds every row; an update with nothing changed builds none', () => {
  const f = fixture();
  f.view.update();
  assert.deepEqual(f.ids(), ['s0', 's1', 's2', 's3', 's4']);
  assert.deepEqual(f.events, ['rebuild', 'built']);
  f.built.length = 0;
  f.view.update();
  assert.deepEqual(f.built, []);
});

test('moving to another song builds only the row left and the row reached; the rest keep their nodes', () => {
  const f = fixture({ count: 8 });
  f.view.update();
  const nodes = [...f.list.children];
  f.built.length = 0;
  f.st.index = 5;
  f.view.update();
  assert.deepEqual(f.built.sort(), ['s0', 's5']);
  f.list.children.forEach((r, i) => { if (i !== 0 && i !== 5) assert.equal(r, nodes[i]); });
  assert.equal(f.list.children[5].current, true);
  assert.equal(f.list.children[0].current, false);
});

test('play and pause repaint the current row in place and build nothing', () => {
  const f = fixture();
  f.view.update();
  f.built.length = 0;
  f.st.playing = true;
  f.view.update();
  assert.deepEqual(f.built, []);
  assert.deepEqual(f.painted, [0]);
  assert.equal(f.list.children[0].playing, true);
});

test('a new queue array, or an invalidate (library or auto-download changed), builds all rows again', () => {
  const f = fixture({ count: 4 });
  f.view.update();
  f.built.length = 0;
  f.st.items = [...f.st.items.slice(1), { id: 'x' }];
  f.view.update();
  assert.deepEqual(f.ids(), ['s1', 's2', 's3', 'x']);
  f.built.length = 0;
  f.view.invalidate();
  f.view.update();
  assert.equal(f.built.length, 4);
});

test('while the Now playing page is hidden no row is built; showing it builds them', () => {
  const f = fixture({ tracked: true });
  f.section.hidden = true;
  f.view.update();
  assert.deepEqual(f.built, []);
  f.st.index = 2;
  f.view.update();
  assert.deepEqual(f.built, []);
  f.show();
  assert.deepEqual(f.ids(), ['s0', 's1', 's2', 's3', 's4']);
  assert.equal(f.list.children[2].current, true);
});

test('a big queue is built in slices and a newer state restarts the build', () => {
  let t = 0;
  const later = [];
  const f = fixture({ count: SYNC_ROWS * 4, chunk: { now: () => t, later: (fn) => later.push(fn), budgetMs: 8 } });
  const origBuild = f.built.push.bind(f.built);
  f.built.push = (id) => { t += 1; return origBuild(id); };
  f.view.update();
  assert.equal(f.view.building, true);
  assert.equal(f.built.length, 8, 'the first slice stops at the budget');
  assert.equal(f.list.children.length, 0, 'nothing is shown until the build is done');
  f.view.update();
  assert.equal(later.length, 1, 'the same state does not start another build');
  f.st.index = 3;
  f.view.update();
  assert.equal(f.view.building, true, 'a changed state starts over');
  later.shift()();
  assert.equal(f.list.children.length, 0, 'the cancelled slice did nothing');
  let guard = 0;
  while (later.length && guard++ < 100) later.shift()();
  assert.equal(f.view.building, false);
  assert.equal(f.list.children.length, SYNC_ROWS * 4);
  assert.equal(f.list.children[3].current, true);
  assert.equal(f.events.filter((e) => e === 'built').length, 1);
});
