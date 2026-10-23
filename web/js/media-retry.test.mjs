import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaRetry } from './media-retry.js';
import { MEDIA_RETRY_DELAYS_MS } from './constants.js';

const flush = () => new Promise((r) => setImmediate(r));

function rig({ probe = async () => 'retry' } = {}) {
  const audio = new EventTarget();
  Object.assign(audio, { paused: false, currentTime: 0, error: { code: 4 }, plays: 0, loads: [] });
  let src = '/files/a';
  Object.defineProperty(audio, 'src', { get: () => src, set: (v) => { src = v; audio.loads.push(v); } });
  audio.getAttribute = () => src;
  audio.play = () => { audio.plays += 1; return Promise.resolve(); };
  const timers = [];
  const states = [];
  const gone = [];
  const retry = createMediaRetry({
    audio, probe, onChange: (s) => states.push(s), onGone: () => gone.push(1),
    timers: { set: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clear: () => {} },
  });
  const fail = () => audio.dispatchEvent(new Event('error'));
  const fire = () => timers.shift().fn();
  return { audio, retry, timers, states, gone, fail, fire };
}

test('the retry window totals about 31 seconds', () => {
  assert.equal(MEDIA_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0), 31000);
});

test('fails twice, then succeeds: reloads the same source, resumes the position, reports ok', async () => {
  const { audio, retry, timers, states, gone, fail, fire } = rig();
  audio.currentTime = 12;
  fail();
  await flush();
  assert.equal(retry.state, 'reconnecting');
  assert.equal(timers[0].ms, MEDIA_RETRY_DELAYS_MS[0]);
  fire();
  assert.deepEqual(audio.loads, ['/files/a']);
  assert.equal(audio.plays, 1);
  fail();
  assert.equal(timers[0].ms, MEDIA_RETRY_DELAYS_MS[1]);
  fire();
  assert.equal(audio.loads.length, 2);
  audio.currentTime = 0;
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(audio.currentTime, 12);
  audio.dispatchEvent(new Event('playing'));
  assert.equal(retry.state, 'ok');
  assert.deepEqual(states, ['reconnecting', 'ok']);
  assert.equal(gone.length, 0);
});

test('gives up after the last delay and shows failed; retryNow starts again', async () => {
  const { retry, timers, states, fail, fire, audio } = rig();
  fail();
  await flush();
  for (let i = 0; i < MEDIA_RETRY_DELAYS_MS.length; i += 1) { fire(); fail(); }
  assert.equal(retry.state, 'failed');
  assert.equal(retry.stalled(), true);
  assert.equal(timers.length, 0);
  retry.retryNow();
  assert.equal(retry.state, 'reconnecting');
  assert.equal(audio.loads.length, MEDIA_RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(states, ['reconnecting', 'failed', 'reconnecting']);
});

test('a missing file (4xx) is not retried and goes to onGone', async () => {
  const { retry, timers, gone, fail } = rig({ probe: async () => 'gone' });
  fail();
  await flush();
  assert.equal(retry.state, 'ok');
  assert.equal(timers.length, 0);
  assert.equal(gone.length, 1);
});

test('pausing or changing the song cancels the retry', async () => {
  const a = rig();
  a.fail();
  await flush();
  a.audio.error = null;
  a.audio.dispatchEvent(new Event('pause'));
  assert.equal(a.retry.state, 'ok');
  const b = rig();
  b.fail();
  await flush();
  b.retry.reset();
  b.fire();
  assert.equal(b.audio.loads.length, 0, 'a stale timer does not reload');
});

test('the default timers work when called as plain functions (no illegal invocation)', async () => {
  const audio = new EventTarget();
  Object.assign(audio, { paused: false, currentTime: 0, error: { code: 2 } });
  let src = '/files/a';
  let loads = 0;
  Object.defineProperty(audio, 'src', { get: () => src, set: (v) => { src = v; loads += 1; } });
  audio.getAttribute = () => src;
  audio.play = () => Promise.resolve();
  createMediaRetry({ audio, probe: async () => 'retry', delays: [5] });
  audio.dispatchEvent(new Event('error'));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(loads, 1);
});

test('a 503 from a starting server is probed like a 502: retry, a 404 is gone', async () => {
  for (const [status, expected] of [[503, 'reconnecting'], [502, 'reconnecting'], [404, 'ok']]) {
    globalThis.fetch = async () => ({ status });
    const audio = new EventTarget();
    Object.assign(audio, { paused: false, currentTime: 0, error: { code: 4 }, src: '/files/a' });
    audio.getAttribute = () => '/files/a';
    const gone = [];
    const retry = createMediaRetry({ audio, onGone: () => gone.push(1), timers: { set: () => 1, clear: () => {} } });
    audio.dispatchEvent(new Event('error'));
    await flush();
    assert.equal(retry.state, expected, `status ${status}`);
    assert.equal(gone.length, status === 404 ? 1 : 0);
  }
});
