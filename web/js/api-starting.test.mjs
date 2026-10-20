import { test } from 'node:test';
import assert from 'node:assert/strict';

const { api, session, startup, fetchWhenReady } = await import('./api.js');

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  clone() { return this; },
  json: async () => body,
});

function rig(responses) {
  const calls = [];
  const sleeps = [];
  let clock = 0;
  globalThis.fetch = async (path, init) => { calls.push({ path, init }); return responses.shift(); };
  startup.sleep = async (ms) => { sleeps.push(ms); clock += ms; };
  startup.now = () => clock;
  startup.maxMs = 20000;
  return { calls, sleeps };
}

test('WEB-115: a 503 "starting" is retried after Retry-After and then succeeds', async () => {
  const { calls, sleeps } = rig([res(503, { detail: 'starting', step: 'migrate tags' }, { 'retry-after': '3' }), res(503, { detail: 'starting' }, { 'retry-after': '3' }), res(200, { songs: [{ id: 'a', tags: [] }] })]);
  const seen = [];
  const on = () => seen.push(startup.waiting);
  globalThis.window = new EventTarget();
  window.addEventListener('server-starting', on);
  const songs = await api.library();
  assert.equal(songs.length, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [3000, 3000]);
  assert.deepEqual(seen, [true, false], 'the note is raised once and cleared when the answer comes');
  assert.equal(startup.waiting, false);
  delete globalThis.window;
});

test('a POST is repeated too: the server processed nothing while starting', async () => {
  const { calls } = rig([res(503, { detail: 'starting' }), res(200, { id: 'x' })]);
  await api.patch('x', { title: 'T' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'PATCH');
});

test('another 503 (storage unavailable) and other errors are not retried', async () => {
  let r = rig([res(503, { detail: 'music root unavailable' })]);
  await assert.rejects(api.library(), (e) => e.status === 503 && /unavailable/.test(e.message));
  assert.equal(r.calls.length, 1);
  r = rig([res(500, { detail: 'boom' })]);
  await assert.rejects(api.library(), (e) => e.status === 500);
  assert.equal(r.calls.length, 1);
});

test('after about 20 seconds the 503 is handed back as a readable error', async () => {
  const many = Array.from({ length: 20 }, () => res(503, { detail: 'starting' }, { 'retry-after': '3' }));
  const { calls, sleeps } = rig(many);
  await assert.rejects(api.library(), (e) => e.status === 503 && /starting/i.test(e.message) && !/^starting$/.test(e.message));
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 20000);
  assert.equal(calls.length, sleeps.length + 1);
  assert.equal(startup.waiting, false);
});

test('a missing Retry-After falls back to 3 seconds and a network error ends the wait', async () => {
  const { sleeps } = rig([res(503, { detail: 'starting' }), res(200, { songs: [] })]);
  await api.library();
  assert.deepEqual(sleeps, [3000]);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(fetchWhenReady('/x', {}), TypeError);
  await assert.rejects(api.library(), (e) => e.status === 0);
  assert.equal(startup.waiting, false);
});

test('the sign-in restore waits out the start as well', async () => {
  const { calls } = rig([res(503, { detail: 'starting' }), res(200, { method: 'none' })]);
  await session.restore();
  assert.equal(calls.length, 2);
});
