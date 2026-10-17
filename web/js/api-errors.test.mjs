import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch } from './test-dom.mjs';

const dom = installDom();
const { api, auth, session, isSignedIn, ApiError } = await import('./api.js');

test('every call sends the CSRF header, JSON bodies get a content type', async () => {
  const calls = stubFetch(() => ({ body: { ok: 1 } }));
  await api.me();
  await api.preview('https://y/1');
  assert.equal(calls[0].opts.headers['X-Requested-With'], 'audioplayer');
  assert.equal(calls[0].opts.headers['Content-Type'], undefined);
  assert.equal(calls[1].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].opts.body), { url: 'https://y/1' });
});

test('ids are percent-encoded into paths (no traversal out of /songs)', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  await api.patch('../x/y', { title: 't' });
  await api.remove('a?b#c');
  assert.equal(calls[0].url, '/songs/..%2Fx%2Fy');
  assert.equal(calls[1].url, '/songs/a%3Fb%23c');
  assert.equal(calls[1].opts.method, 'DELETE');
  assert.equal(api.fileUrl('a/b'), '/files/a%2Fb');
  assert.equal(api.coverUrl('a/b'), '/covers/a%2Fb');
});

test('addSong sends keep_title only when asked', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  await api.addSong('u', {}, ['t']);
  await api.addSong('u', {}, ['t'], true);
  assert.equal('keep_title' in JSON.parse(calls[0].opts.body), false);
  assert.equal(JSON.parse(calls[1].opts.body).keep_title, true);
});

test('204 yields null; network failure yields ApiError(0)', async () => {
  stubFetch(() => ({ status: 204 }));
  assert.equal(await api.remove('a'), null);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(() => api.me(), (e) => e instanceof ApiError && e.status === 0 && /unreachable/i.test(e.message));
});

test('error mapping: validation arrays, friendly codes, retry minutes, fallback', async () => {
  stubFetch(() => ({ status: 422, body: { detail: [{ msg: 'bad a' }, { msg: 'bad b' }] } }));
  await assert.rejects(() => api.me(), (e) => e.status === 422 && e.message === 'bad a; bad b');

  stubFetch(() => ({ status: 429, body: { error: 'hourly_limit', retry_after_minutes: 7 } }));
  await assert.rejects(() => api.me(), (e) => e.code === 'hourly_limit' && e.retryMinutes === 7 && /7 minutes/.test(e.message));

  stubFetch(() => ({ status: 507, body: { error: 'library_full_bytes' } }));
  await assert.rejects(() => api.me(), (e) => /storage is full/i.test(e.message));

  stubFetch(() => ({ status: 500, body: null }));
  await assert.rejects(() => api.me(), (e) => e.message === 'Request failed (500)');

  stubFetch(() => ({ status: 404, body: { detail: 'Song not found' } }));
  await assert.rejects(() => api.me(), (e) => e.message === 'Song not found');
});

test('401 signs the web out and fires auth-changed once', async () => {
  let fired = 0;
  dom.window.addEventListener('auth-changed', () => { fired += 1; });
  stubFetch(() => ({ body: { email: 'a@b.c', provider: 'google' } }));
  await session.start('tok');
  assert.equal(isSignedIn(), true);
  stubFetch(() => ({ status: 401, body: { detail: 'nope' } }));
  await assert.rejects(() => api.library(), (e) => e.status === 401 && /Not signed in/.test(e.message));
  assert.equal(isSignedIn(), false);
  assert.equal(auth.provider, '');
  assert.equal(fired, 1);
  await assert.rejects(() => api.library());
  assert.equal(fired, 1, 'no event when already signed out');
});

test('session.restore adopts only cookie sessions and swallows errors', async () => {
  session.retryMs = [];
  stubFetch(() => ({ body: { method: 'token', email: 'x' } }));
  await session.restore();
  assert.equal(isSignedIn(), false);
  stubFetch(() => ({ body: { method: 'session', email: 'me@x.y', provider: 'apple' } }));
  await session.restore();
  assert.equal(auth.email, 'me@x.y');
  stubFetch(() => ({ status: 500, body: {} }));
  await session.restore();
  assert.equal(auth.email, 'me@x.y', 'failed restore leaves state alone');
});

test('session.restore retries a restarting server and does not retry a real 401 (WEB-100)', async () => {
  session.retryMs = [0, 0, 0];
  auth.email = '';
  let n = 0;
  stubFetch(() => (++n < 3 ? { status: 502, body: {} } : { body: { method: 'session', email: 'me@x.y', provider: 'google' } }));
  await session.restore();
  assert.equal(n, 3);
  assert.equal(auth.email, 'me@x.y');
  auth.email = '';
  n = 0;
  stubFetch(() => { n++; return { status: 401, body: {} }; });
  await session.restore();
  assert.equal(n, 1);
  assert.equal(isSignedIn(), false);
  n = 0;
  stubFetch(() => { n++; return { status: 503, body: {} }; });
  await session.restore();
  assert.equal(n, 4, 'gives up after the retries');
});

test('session.end clears state after logout; config and failures surface', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  await session.end();
  assert.equal(isSignedIn(), false);
  assert.equal(calls[0].url, '/auth/logout');
  stubFetch(() => ({ status: 403, body: { error: 'signup_closed' } }));
  await assert.rejects(() => session.start('t'), (e) => e.code === 'signup_closed' && /closed/.test(e.message));
  globalThis.fetch = async () => { throw new Error('x'); };
  await assert.rejects(() => session.config(), (e) => e.status === 0);
});
