import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';

test('queue-logic', () => {
  const { nextStep, prevStep, hasNext } = Q;
  const q = ['a', 'b', 'c', 'd'];
  const st = (o) => ({ queue: q, index: 0, shuffle: false, repeat: 'off', played: [], ...o });

  assert.equal(nextStep(st({}), false).index, 1);
  assert.equal(nextStep(st({ index: 3 }), false), null);
  assert.equal(nextStep(st({ index: 3, repeat: 'all' }), false).index, 0);
  assert.equal(nextStep(st({ index: 2, repeat: 'one' }), false).index, 2);
  assert.equal(nextStep(st({ index: 2, repeat: 'one' }), true).index, 3);
  assert.equal(nextStep(st({ index: 3, repeat: 'one' }), true), null);
  assert.equal(hasNext(st({ index: 3 })), false);
  assert.equal(hasNext(st({ index: 3, repeat: 'all' })), true);
  assert.equal(nextStep({ ...st({}), queue: [] }, false), null);

  let s = st({ shuffle: true, index: 2 });
  const seen = [q[2]];
  let k = 0;
  for (;;) {
    const r = nextStep(s, true, () => (k++ % 3) / 3);
    if (!r) break;
    assert.ok(!seen.includes(q[r.index]), 'no repeats within a round');
    seen.push(q[r.index]);
    s = { ...s, index: r.index, played: r.played };
  }
  assert.deepEqual([...seen].sort(), q);
  const all = nextStep({ ...s, repeat: 'all' }, true, () => 0);
  assert.ok(all && all.index !== s.index && all.played.length === 1);
  assert.equal(nextStep(st({ shuffle: true, queue: ['x'], repeat: 'all' }), false).index, 0);
  assert.equal(nextStep(st({ shuffle: true, index: 1, repeat: 'one' }), false).index, 1);
  assert.equal(nextStep(st({ shuffle: true, index: 1, played: ['a'] }), true, () => 0.99).index, 3);
  assert.equal(nextStep(st({ shuffle: true, index: 1, played: ['a'] }), true, () => 0).index, 2);

  assert.equal(prevStep({ queue: q, index: 2, shuffle: false }).index, 1);
  assert.equal(prevStep({ queue: q, index: 0, shuffle: false }), null);
  assert.equal(prevStep({ queue: q, index: 2, shuffle: true, history: [] }), null);
  const p = prevStep({ queue: q, index: 2, shuffle: true, history: ['b', 'd'] });
  assert.equal(p.index, 3);
  assert.deepEqual(p.history, ['b']);

  assert.equal(Q.toggleRepeat('off', 'one'), 'one');
  assert.equal(Q.toggleRepeat('one', 'one'), 'off');
  assert.equal(Q.toggleRepeat('one', 'all'), 'all');

  const songs = [
    { id: 'a', tags: ['genre:rock', 'fast'] },
    { id: 'b', tags: ['genre:pop'] },
    { id: 'c', tags: ['Fast', 'genre:pop'] },
    { id: 'd', tags: [] },
    { id: 'e', tags: ['genre:rock'] },
  ];
  const ids = (x) => Q.queueIds(x);
  let s0 = Q.emptyState();
  const first = Q.addManual(s0, 'd');
  assert.equal(first.result, 'queued');
  s0 = first.state;
  assert.equal(s0.index, 0);
  assert.equal(Q.addManual(s0, 'd').result, 'duplicate');

  // union add, dedupe, case-insensitive, appended at the end
  const a = Q.addTags(s0, ['genre:rock', 'fast'], songs);
  assert.deepEqual(ids(a.state), ['d', 'a', 'c', 'e']);
  assert.equal(a.added, 3);
  assert.deepEqual(a.state.tags, ['genre:rock', 'fast']);
  assert.deepEqual(a.state.items[1].tags, ['genre:rock', 'fast']);
  assert.equal(Q.addTags(a.state, ['fast'], songs).added, 0);
  assert.equal(Q.addTags(Q.emptyState(), ['genre:pop'], songs).state.index, 0);

  // chip removal keeps songs another chip still holds
  assert.deepEqual(ids(Q.removeTags(a.state, ['fast']).state), ['d', 'a', 'e']);
  assert.deepEqual(Q.removeTags(a.state, ['fast']).state.tags, ['genre:rock']);
  assert.deepEqual(ids(Q.removeTags(a.state, ['genre:rock']).state), ['d', 'a', 'c']);
  // current and already-started songs are kept
  assert.deepEqual(ids(Q.removeTags({ ...a.state, index: 2 }, ['fast']).state), ['d', 'a', 'c', 'e']);
  assert.deepEqual(ids(Q.removeTags({ ...a.state, index: 1 }, ['fast']).state), ['d', 'a', 'e']);
  // manual wins
  const man = Q.addManual(a.state, 'e').state;
  assert.equal(man.items[3].manual, true);
  assert.deepEqual(ids(Q.removeTags(man, ['genre:rock', 'fast']).state), ['d', 'e']);
  const man2 = Q.addManual(Q.addTags(Q.emptyState(), ['genre:pop'], songs).state, 'b');
  assert.equal(man2.result, 'added');
  assert.deepEqual(ids(Q.clean(man2.state).state), ['b']);

  // clean: drops every chip and the exclusive upcoming songs
  const cl = Q.clean(a.state);
  assert.deepEqual(ids(cl.state), ['d']);
  assert.deepEqual(cl.state.tags, []);
  assert.equal(cl.removed, 3);
  const cl2 = Q.clean({ ...a.state, index: 1 });
  assert.deepEqual(ids(cl2.state), ['d', 'a']);
  assert.equal(cl2.state.index, 1);

  // playNow / move / remove / sync
  const pn = Q.playNow(a.state, 'e');
  assert.deepEqual(ids(pn), ['d', 'e', 'a', 'c']);
  assert.equal(pn.index, 1);
  assert.equal(pn.items[1].manual, true);
  assert.deepEqual(ids(Q.moveItem(a.state, 2, 1)), ['d', 'a', 'e', 'c']);
  assert.deepEqual(ids(Q.moveItem(a.state, 1, -1)), ['a', 'd', 'c', 'e']);
  assert.deepEqual(ids(Q.removeItem(a.state, 2).state), ['d', 'a', 'e']);
  const sy = Q.syncLibrary({ ...a.state, index: 2 }, (id) => id !== 'a');
  assert.deepEqual(ids(sy.state), ['d', 'c', 'e']);
  assert.equal(sy.state.index, 1);
  assert.equal(sy.curGone, false);

  // persistence round trip and old format
  assert.deepEqual(Q.parseSaved(JSON.parse(JSON.stringify(a.state))), a.state);
  assert.deepEqual(ids(Q.parseSaved({ ids: ['x', 'y', 'x'], index: 1 })), ['x', 'y']);
  assert.deepEqual(Q.parseSaved(null), Q.emptyState());

  // loop / shuffle on a tag-filled queue
  const ql = { queue: ids(a.state), index: 0, shuffle: false, repeat: 'all', played: [] };
  assert.equal(nextStep({ ...ql, index: 3 }, false).index, 0);
  assert.equal(nextStep({ ...ql, repeat: 'one', index: 3 }, false).index, 3);
  const sh = nextStep({ ...ql, shuffle: true, repeat: 'off' }, true, () => 0);
  assert.equal(sh.index, 1);
  console.log('queue-logic: ok');

  {
    const songs = [{ id: 'a', releaseYear: 1990, tags: [] }, { id: 'b', releaseYear: 1999, tags: ['decade:80s'] }, { id: 'c', year: 1995, tags: [] }];
    let r = Q.addListed(Q.emptyState(), songs, 'decade:90s');
    assert.deepEqual([r.added, r.already, r.state.tags, r.state.index], [3, 0, ['decade:90s'], 0]);
    assert.ok(r.state.items.every((it) => !it.manual && it.tags[0] === 'decade:90s'));
    r = Q.addListed(r.state, songs.slice(1), 'decade:90s');
    assert.deepEqual([r.added, r.already, r.state.items.length], [0, 2, 3]);
    assert.equal(Q.clean(r.state).state.items.length, 1, 'chip removal drops tag-added songs after the current one');

    let m = Q.addManual(Q.emptyState(), 'a').state;
    r = Q.addListed(m, songs, '');
    assert.deepEqual([r.added, r.already, r.state.tags, r.state.items.map((it) => it.id)], [2, 1, [], ['a', 'b', 'c']]);
    assert.ok(r.state.items.every((it) => it.manual));
    assert.equal(Q.clean(r.state).state.items.length, 3, 'search-only adds are manual and survive Clean');
    assert.equal(r.state.index, 0);
  }

  {
    const songs = [{ id: 'a', tags: ['x', 'y'] }, { id: 'b', tags: ['x'] }, { id: 'a', tags: ['x', 'y'] }];
    const old = Q.addManual(Q.addManual(Q.emptyState(), 'q').state, 'r').state;
    let r = Q.playListed(old, songs, ['x', 'y']);
    assert.deepEqual([r.count, r.replaced, r.state.index, r.state.tags], [2, true, 0, ['x', 'y']]);
    assert.deepEqual(r.state.items.map((it) => [it.id, it.manual, it.tags]), [['a', false, ['x', 'y']], ['b', false, ['x']]]);
    r = Q.playListed(old, songs, [], true, () => 0.99);
    assert.deepEqual([r.state.index, r.state.items.every((it) => it.manual), r.state.tags], [1, true, []]);
    r = Q.playListed(Q.emptyState(), songs, [], false);
    assert.equal(r.replaced, false);
    assert.equal(Q.playListed(old, [], []).state, old);
  }
});

test("tag picks match legacy country spellings", () => {
  const songs = [{ id: 'a', tags: ['country:usa'] }, { id: 'b', tags: ['country:United States'] }, { id: 'c', tags: ['country:fr'] }];
  const r = Q.addTags(Q.emptyState(), ["country:us"], songs);
  assert.deepEqual(r.state.items.map((i) => i.id).sort(), ['a', 'b']);
});

test('playNext inserts the song right after the current one and never switches to it', () => {
  const base = { items: [{ id: 'a', manual: true, tags: [] }, { id: 'b', manual: true, tags: [] }, { id: 'c', manual: true, tags: [] }], index: 0, tags: [] };
  const ids = (st) => st.items.map((it) => it.id);
  const fresh = Q.playNext(base, 'z');
  assert.equal(fresh.result, 'next');
  assert.deepEqual(ids(fresh.state), ['a', 'z', 'b', 'c']);
  assert.equal(fresh.state.index, 0);
  const moved = Q.playNext(base, 'c');
  assert.deepEqual(ids(moved.state), ['a', 'c', 'b']);
  assert.equal(moved.state.index, 0);
  const behind = Q.playNext({ ...base, index: 2 }, 'a');
  assert.deepEqual(ids(behind.state), ['b', 'c', 'a']);
  assert.equal(behind.state.index, 1, 'the current song keeps its place after an earlier song moves behind it');
  assert.equal(behind.state.items[behind.state.index].id, 'c');
  const same = Q.playNext(base, 'a');
  assert.equal(same.result, 'current');
  assert.equal(same.state, base);
  const empty = Q.playNext(Q.emptyState(), 'x');
  assert.equal(empty.result, 'now');
  assert.deepEqual(ids(empty.state), ['x']);
  assert.equal(empty.state.index, 0);
});
