import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const { createPlayRecorder, QUEUE_KEY, BATCH_KEY, OPEN_KEY } = await import('./play-recorder.js');

function fakeAudio() {
  const h = {};
  return {
    paused: true,
    currentTime: 0,
    addEventListener: (n, f) => { (h[n] ||= []).push(f); },
    removeEventListener: () => {},
    emit: (n) => (h[n] || []).forEach((f) => f()),
  };
}

function fakeTarget() {
  const h = {};
  return {
    visibilityState: 'visible',
    addEventListener: (n, f) => { (h[n] ||= []).push(f); },
    removeEventListener: () => {},
    emit: (n) => (h[n] || []).forEach((f) => f()),
  };
}

function setup({ guest = false, fail = false, status = 0, doc = null, win = null } = {}) {
  const audio = fakeAudio();
  const state = { id: 'a', guest, fail, posts: [] };
  const rec = createPlayRecorder({
    audio,
    getSongId: () => state.id,
    canRecord: () => !state.guest,
    post: async (batch, opts) => {
      state.posts.push({ batch, opts });
      if (state.fail) throw Object.assign(new Error('x'), { status });
    },
    now: () => new Date('2026-10-21T10:00:00Z'),
    keyFn: () => `k${state.posts.length}`,
    doc,
    win,
    intervalMs: 1e9,
  });
  const play = () => { audio.paused = false; audio.emit('play'); };
  const advance = (to, step = 0.25) => {
    for (let t = audio.currentTime + step; t <= to + 1e-9; t += step) { audio.currentTime = t; audio.emit('timeupdate'); }
  };
  return { audio, state, rec, play, advance };
}

const queue = () => JSON.parse(mem.get(QUEUE_KEY) || '[]');
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => mem.clear());

test('PLY-170: a play accumulates played seconds and is recorded on ended', async () => {
  const s = setup();
  s.play();
  s.advance(20);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  assert.equal(s.state.posts.length, 1);
  const p = s.state.posts[0].batch.plays[0];
  assert.equal(p.song_id, 'a');
  assert.equal(p.timestamp, '2026-10-21T10:00:00.000Z');
  assert.ok(Math.abs(p.listened_s - 20) < 0.5);
});

test('PLY-171: seeks add nothing', () => {
  const s = setup();
  s.play();
  s.advance(10);
  s.audio.currentTime = 200;
  s.audio.emit('seeking');
  s.audio.emit('seeked');
  s.audio.emit('timeupdate');
  s.advance(202);
  assert.ok(s.rec.open.listened_s < 14 && s.rec.open.listened_s > 10);
});

test('PLY-171: a jump without a seeking event is dropped by the delta rule', () => {
  const s = setup();
  s.play();
  s.advance(10);
  s.audio.currentTime = 100;
  s.audio.emit('timeupdate');
  assert.ok(s.rec.open.listened_s < 10.1);
});

test('PLY-172: pause then resume of the same song is one play; time while paused is not counted', () => {
  const s = setup();
  s.play();
  s.advance(10);
  s.audio.paused = true;
  s.audio.emit('pause');
  s.audio.currentTime = 10.2;
  s.audio.emit('timeupdate');
  s.play();
  s.advance(20);
  assert.ok(s.rec.open.listened_s > 18 && s.rec.open.listened_s < 20.5);
  assert.equal(queue().length, 0);
  assert.ok(mem.has(OPEN_KEY));
});

test('PLY-173: plays under 5 seconds are dropped', async () => {
  const s = setup();
  s.play();
  s.advance(4);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  assert.equal(s.state.posts.length, 0);
  assert.equal(queue().length, 0);
});

test('PLY-174: a song change closes the play and flushes', async () => {
  const s = setup();
  s.play();
  s.advance(12);
  s.state.id = 'b';
  s.rec.sync();
  await tick();
  assert.equal(s.state.posts.length, 1);
  assert.equal(s.state.posts[0].batch.plays[0].song_id, 'a');
  assert.equal(s.rec.open.song_id, 'b');
});

test('PLY-175: a repeat of the same song after ended is a separate play', async () => {
  const s = setup();
  s.play();
  s.advance(10);
  s.audio.paused = true;
  s.audio.emit('ended');
  s.audio.currentTime = 0;
  s.play();
  s.advance(10);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  const n = s.state.posts.reduce((a, p) => a + p.batch.plays.length, 0) + queue().length;
  assert.equal(n, 2);
});

test('PLY-176: a failed POST keeps the batch and retries it with the same key', async () => {
  const s = setup({ fail: true });
  s.play();
  s.advance(10);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  assert.ok(mem.has(BATCH_KEY));
  s.state.fail = false;
  await s.rec.flush();
  assert.equal(s.state.posts.length, 2);
  assert.equal(s.state.posts[0].batch.batch_key, s.state.posts[1].batch.batch_key);
  assert.deepEqual(s.state.posts[0].batch.plays, s.state.posts[1].batch.plays);
  assert.equal(mem.has(BATCH_KEY), false);
});

test('PLY-176: a rejected batch (422) is dropped, not retried forever', async () => {
  const s = setup({ fail: true, status: 422 });
  s.play();
  s.advance(10);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  assert.equal(mem.has(BATCH_KEY), false);
});

test('PLY-177: guests record nothing and make no network calls', async () => {
  const s = setup({ guest: true });
  s.play();
  s.advance(30);
  s.audio.paused = true;
  s.audio.emit('ended');
  await s.rec.flush();
  assert.equal(s.rec.open, null);
  assert.equal(s.state.posts.length, 0);
  assert.equal(queue().length, 0);
});

test('PLY-170: a play left open by a closed page is recovered into the queue', () => {
  mem.set(OPEN_KEY, JSON.stringify({ timestamp: '2026-10-21T09:00:00.000Z', song_id: 'z', listened_s: 42 }));
  const s = setup({ guest: true });
  assert.equal(queue()[0].song_id, 'z');
  assert.equal(mem.has(OPEN_KEY), false);
  s.rec.destroy();
});

test('PLY-178: pause, resume, flush, re-render, tab hide and show are one play of 160 s', async () => {
  const doc = fakeTarget();
  const s = setup({ doc, win: fakeTarget() });
  s.play();
  s.advance(80);
  s.audio.paused = true;
  s.audio.emit('pause');
  await tick();
  s.play();
  s.rec.flush();
  s.rec.sync();
  s.rec.sync();
  doc.visibilityState = 'hidden';
  doc.emit('visibilitychange');
  await tick();
  doc.visibilityState = 'visible';
  doc.emit('visibilitychange');
  s.rec.sync();
  s.advance(160);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  const plays = s.state.posts.flatMap((p) => p.batch.plays);
  assert.equal(plays.length, 1);
  assert.ok(Math.abs(plays[0].listened_s - 160) < 1);
  assert.equal(plays[0].cont, undefined);
});

test('PLY-179: page hide closes the accumulated seconds and the continuation is flagged cont', async () => {
  const win = fakeTarget();
  const s = setup({ win });
  s.play();
  s.advance(80);
  win.emit('pagehide');
  await tick();
  const first = s.state.posts.flatMap((p) => p.batch.plays);
  assert.equal(first.length, 1);
  assert.ok(Math.abs(first[0].listened_s - 80) < 1);
  s.advance(160);
  s.audio.paused = true;
  s.audio.emit('ended');
  await tick();
  const all = s.state.posts.flatMap((p) => p.batch.plays);
  assert.equal(all.length, 2);
  assert.equal(all[1].cont, true);
  assert.ok(Math.abs(all[1].listened_s - 80) < 1);
});

test('PLY-179: a new page load of the same song within 10 minutes starts a cont play', () => {
  mem.set('ap2.plays.last', JSON.stringify({ song_id: 'a', at: new Date('2026-10-21T09:55:00Z').getTime() }));
  const s = setup();
  s.play();
  assert.equal(s.rec.open.cont, true);
  s.rec.destroy();
});

test('PLY-172: a momentarily missing song id (library refresh) does not close the open play', () => {
  const s = setup();
  s.play();
  s.advance(20);
  s.state.id = null;
  s.rec.sync();
  s.audio.emit('timeupdate');
  s.state.id = 'a';
  s.advance(40);
  assert.ok(s.rec.open.listened_s > 39);
});
