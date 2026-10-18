import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
const { api } = await import('./api.js');

test('the draft calls use the documented routes, methods and bodies, with the CSRF header', async () => {
  const calls = stubFetch((url, o) => ({ status: o.method === 'DELETE' ? 204 : 200, body: { ok: true } }));
  await api.drafts();
  await api.addDrafts(['A - B', 'C']);
  await api.patchDraft('d_1', { text: 'x', url: '' });
  await api.refreshDraft('d_1');
  assert.equal(await api.removeDraft('d_1'), null);
  assert.equal(await api.clearDrafts(), null);
  assert.deepEqual(calls.map((c) => `${c.opts.method} ${c.url}`), [
    'GET /drafts', 'POST /drafts', 'PATCH /drafts/d_1', 'POST /drafts/d_1/refresh', 'DELETE /drafts/d_1', 'DELETE /drafts',
  ]);
  assert.deepEqual(JSON.parse(calls[1].opts.body), { lines: ['A - B', 'C'] });
  assert.deepEqual(JSON.parse(calls[2].opts.body), { text: 'x', url: '' });
  assert.equal(calls[3].opts.body, undefined);
  for (const c of calls) assert.equal(c.opts.headers['X-Requested-With'], 'audioplayer');
});

test('a draft lookup limit becomes a friendly message', async () => {
  stubFetch(() => ({ status: 429, body: { error: 'draft_limit', detail: 'raw', retry_after_minutes: 3 } }));
  await assert.rejects(api.refreshDraft('d_1'), (ex) => ex.status === 429 && ex.message === 'Draft lookup limit reached. Try again in 3 minutes.');
});

test('a guest or signed-out call is refused with the usual sign-in message', async () => {
  stubFetch(() => ({ status: 401, body: { detail: 'bad token' } }));
  await assert.rejects(api.drafts(), (ex) => ex.status === 401 && /Not signed in/.test(ex.message));
});
