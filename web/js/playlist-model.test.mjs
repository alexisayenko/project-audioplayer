import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLabel, canTick, counterText, defaultChecked, markOf, markUnavailable, mergeDetails, playlistNote, postArgs, quotaNote, quotaPlan, runAdd, stops, summaryText,
} from './playlist-model.js';

const row = (id, extra = {}) => ({ id, url: `https://www.youtube.com/watch?v=${id}`, state: 'ok', title: `T ${id}`, mainArtists: ['A'], featuredArtists: [], version: null, tags: [], duration: 200, long: false, duplicate: null, raw: { title: 'x' }, ...extra });
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

test('default selection: listed, short and not already in the library', () => {
  assert.equal(defaultChecked(row('a')), true);
  assert.equal(defaultChecked(row('a', { long: true })), false);
  assert.equal(defaultChecked(row('a', { duplicate: 'id' })), false);
  assert.equal(defaultChecked(row('a', { duplicate: 'match' })), false);
  assert.equal(defaultChecked(row('a', { state: 'unavailable' })), false);
});

test('marks: unavailable, in library, over 5 minutes, added and failed; duplicates stay tickable', () => {
  assert.equal(markOf(row('a')), null);
  assert.deepEqual(markOf(row('a', { state: 'unavailable', reason: 'Private' })), { kind: 'unavailable', text: 'Unavailable', tip: 'Private video' });
  assert.equal(markOf(row('a', { duplicate: 'id' })).text, 'In library');
  assert.equal(markOf(row('a', { long: true })).text, 'Over 5 min');
  assert.equal(markOf(row('a'), { kind: 'added' }).text, 'Added');
  assert.equal(markOf(row('a'), { kind: 'failed', message: 'boom' }).tip, 'boom');
  assert.equal(canTick(row('a', { duplicate: 'id' })), true);
  assert.equal(canTick(row('a', { state: 'unavailable' })), false);
  assert.equal(canTick(row('a'), { kind: 'added' }), false);
  assert.equal(canTick(row('a'), { kind: 'failed' }), true);
});

test('labels', () => {
  assert.equal(counterText(3, 10), '3 of 10 selected');
  assert.equal(addLabel(1), 'Add 1 song');
  assert.equal(addLabel(0), 'Add 0 songs');
  assert.equal(playlistNote({ total: 5, limit: 200, truncated: false }), '5 videos');
  assert.equal(playlistNote({ total: 250, limit: 200, truncated: true }), '250 videos. Showing the first 200 of 250.');
});

test('details replace the parsed fields of listed rows only', () => {
  const rows = [row('a'), row('b', { state: 'unavailable' })];
  const got = mergeDetails(rows, [row('a', { title: 'New', detailed: true }), row('b', { title: 'Nope' })]);
  assert.equal(got.rows[0].title, 'New');
  assert.equal(got.rows[1].title, 'T b');
  assert.deepEqual(got.changed, ['a']);
});

test('ids YouTube refused to serve turn their listed rows into Unavailable rows', () => {
  const rows = [row('a'), row('b', { duplicate: 'id', long: true }), row('c', { state: 'unavailable', reason: 'Private' })];
  const got = markUnavailable(rows, ['b', 'c', 'zzz']);
  assert.deepEqual(got.changed, ['b']);
  assert.equal(got.rows[0], rows[0]);
  assert.deepEqual([got.rows[1].state, got.rows[1].reason, got.rows[1].duplicate, got.rows[1].long], ['unavailable', 'Unavailable', null, false]);
  assert.equal(got.rows[2], rows[2]);
  assert.equal(canTick(got.rows[1]), false);
  assert.equal(defaultChecked(got.rows[1]), false);
  assert.equal(markOf(got.rows[1]).text, 'Unavailable');
  assert.deepEqual(markUnavailable(rows, undefined).changed, []);
});

test('quota: everything fits without a cap, otherwise the room left decides', () => {
  assert.deepEqual(quotaPlan(10, { max_songs: null, songs: 900 }), { allowed: 10, over: 0, max: null, room: null });
  assert.deepEqual(quotaPlan(10, null), { allowed: 10, over: 0, max: null, room: null });
  const plan = quotaPlan(10, { max_songs: 500, songs: 495 });
  assert.deepEqual([plan.allowed, plan.over, plan.room], [5, 5, 5]);
  assert.match(quotaNote(plan), /only 5 of 10 fit/);
  const full = quotaPlan(3, { max_songs: 500, songs: 500 });
  assert.equal(full.allowed, 0);
  assert.match(quotaNote(full), /library is full \(500 songs\)/);
  assert.equal(quotaNote(quotaPlan(1, { max_songs: 500, songs: 1 })), '');
});

test('the request is the single-link add: v2 body, genre tags, no year of the original, raw strings', () => {
  const r = row('a', { title: 'Song', mainArtists: ['Bar'], version: { type: 'remix', name: 'Foo Remix', artists: [], releaseYear: 2021 }, tags: ['genre:house', 'decade:2020s'] });
  const [url, body, tags, keep, raw] = postArgs(r);
  assert.equal(url, r.url);
  assert.equal(body.title, 'Song');
  assert.deepEqual(body.mainArtists, ['Bar']);
  assert.equal(body.releaseYear, null);
  assert.deepEqual(body.version, { type: 'remix', name: 'Foo Remix', artists: [], releaseYear: 2021 });
  assert.deepEqual(tags, ['genre:house']);
  assert.equal(keep, false);
  assert.deepEqual(raw, { title: 'x' });
});

test('runAdd goes in order, reports each result and collects the summary', async () => {
  const seen = [];
  const res = await runAdd([row('a'), row('b'), row('c')], async (url) => {
    seen.push(url.slice(-1));
    return { song: { id: url.slice(-1) } };
  });
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(res.added.length, 3);
  assert.equal(summaryText(res), 'Added 3 songs');
});

test('a failing song is reported and the rest still go in', async () => {
  const outs = [];
  const res = await runAdd([row('a'), row('b'), row('c')], async (url) => {
    if (url.endsWith('b')) throw fail(422, '', 'bad genre');
    return {};
  }, { onDone: (r, o) => outs.push([r.id, o.kind]) });
  assert.deepEqual(res.added.map((x) => x.id), ['a', 'c']);
  assert.deepEqual(res.failed, [{ id: 'b', message: 'bad genre' }]);
  assert.deepEqual(outs, [['a', 'added'], ['b', 'failed'], ['c', 'added']]);
  assert.equal(summaryText(res), 'Added 2 songs (1 failed)');
});

test('"already in library" is not a failure', async () => {
  const res = await runAdd([row('a')], async () => { throw fail(409, '', 'already in library'); });
  assert.deepEqual(res.inLibrary, ['a']);
  assert.equal(res.failed.length, 0);
  assert.equal(summaryText(res), 'Added 0 songs (1 already in the library)');
});

test('a quota or rate-limit refusal stops the run and counts the rest as not added', async () => {
  const res = await runAdd([row('a'), row('b'), row('c')], async (url) => {
    if (url.endsWith('b')) throw fail(403, 'library_full_songs', 'Your library is full.');
    return {};
  });
  assert.deepEqual(res.added.map((x) => x.id), ['a']);
  assert.deepEqual(res.skipped, ['b', 'c']);
  assert.equal(res.stop.code, 'library_full_songs');
  assert.equal(summaryText(res), 'Added 1 song (stopped: Your library is full., 2 not added)');
  assert.equal(summaryText(res, 4), 'Added 1 song (stopped: Your library is full., 4 over your library limit, 2 not added)');
  for (const ex of [fail(0, '', 'Server unreachable'), fail(401, '', 'x'), fail(429, 'hourly_limit', 'x')]) assert.equal(stops(ex), true);
  assert.equal(stops(fail(422, '', 'x')), false);
});

test('an aborted run adds nothing more', async () => {
  const ctl = new AbortController();
  const res = await runAdd([row('a'), row('b')], async () => { ctl.abort(); return {}; }, { signal: ctl.signal });
  assert.equal(res.added.length, 1);
  assert.deepEqual(res.skipped, ['b']);
});
