import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTimelineBuilder, prefetchWindowOpen } from './viz-timeline.js';
import { createLookahead, BUFFER_AHEAD_S, PLAY_WAIT_MS } from './viz-lookahead.js';

const SR = 8000;
const pcmOf = (s) => Float32Array.from({ length: s * SR }, (_, i) => 0.4 * Math.sin(i * 0.2));
const flush = () => new Promise((r) => setTimeout(r, 15));

function rig({ seconds = 5 } = {}) {
  const l = {};
  const dl = {};
  const clock = { t: 1000 };
  const audio = {
    currentSrc: '/files/a', duration: 100, currentTime: 0, paused: true, ended: false, playbackRate: 1, readyState: 0, seeking: false,
    ahead: 0,
    get buffered() { const a = this.ahead; const t = this.currentTime; return { length: a > 0 ? 1 : 0, start: () => 0, end: () => t + a }; },
    addEventListener: (t, fn) => { l[t] = fn; },
    removeEventListener: (t) => { delete l[t]; },
    fire: (t) => l[t]?.({ type: t }),
  };
  const doc = { hidden: false, addEventListener: (t, fn) => { dl[t] = fn; }, removeEventListener: (t) => { delete dl[t]; } };
  const win = { AbortController, document: doc, addEventListener: (t, fn) => { dl[t] = fn; }, removeEventListener: (t) => { delete dl[t]; } };
  const log = { fetches: [], aborted: [], jobs: [], runners: [] };
  const deps = {
    audio, win, now: () => clock.t,
    fetchFn: (u, init) => {
      log.fetches.push({ u, init });
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => { log.aborted.push(u); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        setTimeout(() => resolve({ ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(8) }), 5);
      });
    },
    makeCtx: () => ({ decodeAudioData: async () => ({ length: seconds * SR, sampleRate: SR, numberOfChannels: 1, getChannelData: () => pcmOf(seconds) }) }),
    getSampleRate: () => SR,
    getBands: () => 24,
    warn: () => {},
    makeRunner: () => ({
      start(job, cb) {
        log.jobs.push(job);
        const b = makeTimelineBuilder({ ...job, fftSize: 512 });
        b.step(1e9);
        cb.onRows(0, b.data);
        cb.onDone();
        const r = { cancel: () => { r.cancelled = true; }, focus() {} };
        log.runners.push(r);
        return r;
      },
    }),
  };
  const play = () => { audio.paused = false; audio.readyState = 4; audio.fire('playing'); };
  return { audio, doc, win, deps, log, clock, play, fireWin: (t) => dl[t]?.({ type: t }), fireDoc: (t) => dl[t]?.({ type: t }) };
}

test('no analysis fetch before the audio is playing and buffered', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  la.get(0);
  await flush();
  assert.equal(r.log.fetches.length, 0);
  assert.equal(la.statusText(), 'timeline: waiting for playback');
  assert.equal(la.get(1), null);
  r.audio.paused = false;
  r.audio.readyState = 4;
  r.audio.ahead = 3;
  r.audio.fire('playing');
  await flush();
  assert.equal(r.log.fetches.length, 0);
  r.audio.ahead = BUFFER_AHEAD_S + 1;
  r.audio.fire('progress');
  await flush();
  assert.equal(r.log.fetches.length, 1);
  assert.equal(r.log.fetches[0].init.priority, 'low');
  assert.equal(r.log.fetches[0].init.credentials, 'same-origin');
  assert.equal(r.log.fetches[0].init.headers, undefined);
  assert.equal(la.status, 'ready');
});

test('5 s after playing starts the fetch even with little buffered', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 2;
  r.play();
  await flush();
  assert.equal(r.log.fetches.length, 0);
  r.clock.t += PLAY_WAIT_MS - 1;
  r.audio.fire('timeupdate');
  await flush();
  assert.equal(r.log.fetches.length, 0);
  r.clock.t += 2;
  r.audio.fire('timeupdate');
  await flush();
  assert.equal(r.log.fetches.length, 1);
});

test('a fully buffered short remainder counts as buffered ahead', async () => {
  const r = rig();
  r.audio.duration = 8;
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 8;
  r.play();
  await flush();
  assert.equal(r.log.fetches.length, 1);
});

test('nothing is fetched when the mode is not a scene mode, or the tab is hidden', async () => {
  const r = rig();
  r.audio.ahead = 30;
  r.play();
  const la = createLookahead(r.deps);
  la.get(0);
  await flush();
  assert.equal(r.log.fetches.length, 0);
  r.doc.hidden = true;
  la.request('a', true);
  la.get(1);
  await flush();
  assert.equal(r.log.fetches.length, 0);
  r.doc.hidden = false;
  r.fireDoc('visibilitychange');
  await flush();
  assert.equal(r.log.fetches.length, 1);
});

test('track change aborts the fetch and leaves no half state', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 30;
  r.play();
  assert.equal(r.log.fetches.length, 1);
  r.audio.currentSrc = '/files/b';
  r.audio.paused = true;
  r.audio.readyState = 0;
  r.audio.fire('loadstart');
  await flush();
  assert.deepEqual(r.log.aborted, ['/files/a']);
  assert.equal(la.timeline, null);
  assert.equal(la.statusText(), 'timeline: waiting for playback');
  assert.equal(r.log.fetches.length, 1);
  r.audio.ahead = 30;
  r.play();
  await flush();
  assert.equal(r.log.fetches.length, 2);
  assert.equal(r.log.fetches[1].u, '/files/b');
  assert.equal(la.status, 'ready');
});

test('a seek of more than 3 s cancels the fetch and waits again; a small one does not', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 30;
  r.play();
  r.audio.currentTime = 2;
  r.audio.fire('seeking');
  assert.equal(r.log.aborted.length, 0);
  r.audio.currentTime = 40;
  r.audio.seeking = true;
  r.audio.ahead = 0;
  r.audio.fire('seeking');
  assert.deepEqual(r.log.aborted, ['/files/a']);
  assert.equal(la.statusText(), 'timeline: waiting for playback');
  await flush();
  assert.equal(r.log.fetches.length, 1);
  r.audio.seeking = false;
  r.audio.ahead = 12;
  r.audio.fire('seeked');
  r.audio.fire('playing');
  await flush();
  assert.equal(r.log.fetches.length, 2);
  assert.equal(la.status, 'ready');
});

test('switching away from the scene mode and page hide cancel the fetch; coming back restarts it', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 30;
  r.play();
  la.request('a', false);
  assert.deepEqual(r.log.aborted, ['/files/a']);
  assert.equal(la.status, 'idle');
  assert.equal(la.timeline, null);
  la.request('a', true);
  assert.equal(r.log.fetches.length, 2);
  r.fireWin('pagehide');
  assert.equal(r.log.aborted.length, 2);
  await flush();
  assert.equal(la.status, 'loading');
  assert.equal(la.statusText(), 'timeline: waiting for playback');
  r.audio.fire('timeupdate');
  await flush();
  assert.equal(r.log.fetches.length, 3);
  assert.equal(la.status, 'ready');
});

test('hiding the tab aborts the in-flight fetch', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 30;
  r.play();
  r.doc.hidden = true;
  r.fireDoc('visibilitychange');
  assert.deepEqual(r.log.aborted, ['/files/a']);
  await flush();
  assert.equal(la.status, 'loading');
  r.doc.hidden = false;
  r.fireDoc('visibilitychange');
  await flush();
  assert.equal(r.log.fetches.length, 2);
});

test('a finished mode switch keeps the building timeline (only the fetch is cancelled)', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  la.request('a', true);
  r.audio.ahead = 30;
  r.play();
  await flush();
  assert.equal(la.status, 'ready');
  la.request('a', false);
  la.request('a', true);
  assert.equal(la.status, 'ready');
  assert.equal(r.log.fetches.length, 1);
});

test('next-song prefetch waits for a ready analysis and the second half of the song', async () => {
  const r = rig();
  let next = '/files/n';
  const la = createLookahead({ ...r.deps, getNextSrc: () => next });
  la.request('a', true);
  r.audio.ahead = 30;
  r.audio.currentTime = 10;
  r.play();
  la.get(10000);
  assert.equal(r.log.fetches.length, 1);
  await flush();
  assert.equal(la.status, 'ready');
  la.get(20000);
  await flush();
  assert.equal(r.log.fetches.length, 1);
  r.audio.currentTime = 50;
  la.get(30000);
  await flush();
  assert.deepEqual(r.log.fetches.map((f) => f.u), ['/files/a', '/files/n']);
  assert.equal(r.log.fetches[1].init.priority, 'low');
});

test('next-song prefetch also opens in the last 60 s, and a skip cancels it', async () => {
  assert.equal(prefetchWindowOpen(10, 100), false);
  assert.equal(prefetchWindowOpen(50, 100), true);
  assert.equal(prefetchWindowOpen(150, 400), false);
  assert.equal(prefetchWindowOpen(345, 400), true);
  assert.equal(prefetchWindowOpen(10, NaN), false);
  const r = rig();
  const la = createLookahead({ ...r.deps, getNextSrc: () => '/files/n' });
  la.request('a', true);
  r.audio.ahead = 30;
  r.audio.duration = 400;
  r.audio.currentTime = 345;
  r.play();
  await flush();
  la.get(10000);
  assert.equal(r.log.fetches.length, 2);
  r.audio.currentSrc = '/files/z';
  r.audio.fire('loadstart');
  assert.deepEqual(r.log.aborted, ['/files/n']);
});

test('a finished song is reused from the cache without a second fetch, bounded by count', async () => {
  const r = rig();
  const la = createLookahead(r.deps);
  const go = async (src) => {
    r.audio.currentSrc = src;
    r.audio.paused = true;
    r.audio.readyState = 0;
    r.audio.fire('loadstart');
    r.audio.ahead = 30;
    r.play();
    await flush();
  };
  la.request('a', true);
  r.audio.ahead = 30;
  r.play();
  await flush();
  for (const s of ['/files/b', '/files/c', '/files/d']) await go(s);
  assert.equal(r.log.fetches.length, 4);
  await go('/files/a');
  assert.equal(la.statusText(), 'timeline: ready (cached)');
  assert.equal(r.log.fetches.length, 4);
  await go('/files/e');
  await go('/files/f');
  await go('/files/b');
  assert.equal(la.statusText(), 'timeline: ready');
  assert.equal(r.log.fetches.length, 7);
});
