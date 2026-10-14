import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { autodl, autoDownloadOn, setAutoDownload, pump } = await import('./autodl.js');

const tick = () => new Promise((r) => setImmediate(r));
async function settle(t, ms) {
  for (let i = 0; i < 6; i += 1) { await tick(); t.mock.timers.tick(ms); }
  await tick();
}

function route(handlers) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`);
    const h = handlers.find(([re]) => re.test(`${opts.method || 'GET'} ${url}`));
    const r = h ? await h[1](url) : { status: 404, body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  };
  return calls;
}

test('auto-download flag persists and tolerates broken storage', () => {
  assert.equal(autoDownloadOn(), false);
  setAutoDownload(true);
  assert.equal(autoDownloadOn(), true);
  setAutoDownload(false);
  assert.equal(autoDownloadOn(), false);
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(autoDownloadOn(), false);
  assert.doesNotThrow(() => setAutoDownload(true));
  globalThis.localStorage = saved;
});

test('a download that is already done finishes, refreshes the library and leaves the queue', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = route([
    [/^POST \/songs\/s1\/audio/, () => ({ body: { status: 'done' } })],
    [/^GET \/library/, () => ({ body: { songs: [] } })],
  ]);
  const seen = [];
  const off = autodl.onChange(() => seen.push(autodl.view('s1').kind));
  assert.equal(autodl.request(['s1', 's1']), 1, 'duplicate ids add one job');
  await settle(t, 700);
  assert.ok(calls.includes('GET /library'));
  assert.equal(autodl.view('s1').kind, 'none');
  assert.ok(seen.includes('downloading'));
  assert.ok(seen.includes('done'));
  off();
});

test('polls status until done; progress is surfaced while waiting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  route([
    [/^POST \/songs\/s2\/audio/, () => ({ body: { status: 'running' } })],
    [/^GET \/songs\/s2\/status/, () => { n += 1; return { body: n < 3 ? { state: 'downloading', progress: 0.4 } : { state: 'done' } }; }],
    [/^GET \/library/, () => ({ body: { songs: [] } })],
  ]);
  autodl.request(['s2']);
  await settle(t, 1000);
  assert.equal(autodl.view('s2').kind === 'downloading' || autodl.view('s2').kind === 'none', true);
  await settle(t, 1000);
  await settle(t, 1000);
  assert.ok(n >= 3);
  assert.equal(autodl.view('s2').kind, 'none');
});

test('a server failure marks the job failed; retry requeues it at the front', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fail = true;
  route([
    [/^POST \/songs\/s3\/audio/, () => (fail ? { status: 500, body: { detail: 'yt-dlp exploded' } } : { body: { status: 'done' } })],
    [/^GET \/library/, () => ({ body: { songs: [] } })],
  ]);
  autodl.request(['s3']);
  await settle(t, 100);
  const v = autodl.view('s3');
  assert.equal(v.kind, 'failed');
  assert.match(v.error, /yt-dlp exploded/);
  assert.equal(autodl.request(['s3']), 0, 'failed ids are not silently re-added');
  fail = false;
  autodl.retry('s3');
  await settle(t, 700);
  assert.equal(autodl.view('s3').kind, 'none');
});

test('hourly limit pauses the queue and shows paused minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  route([
    [/^POST \/songs\/s4\/audio/, () => ({ status: 429, body: { error: 'hourly_limit', retry_after_minutes: 5 } })],
  ]);
  autodl.request(['s4']);
  await settle(t, 10);
  const v = autodl.view('s4');
  assert.equal(v.kind, 'paused');
  assert.ok(v.minutes >= 1 && v.minutes <= 5);
  assert.equal(autodl.request(['s5']), 1);
  assert.equal(autodl.view('s5').kind, 'paused', 'queued jobs also wait during the pause');
  autodl.prune([]);
  assert.equal(autodl.view('s4').kind, 'none', 'prune forgets queued jobs whose song left the list');
  pump();
});

test('prune never drops a running download', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  route([
    [/^POST \/songs\/s6\/audio/, () => ({ body: { status: 'running' } })],
    [/^GET \/songs\/s6\/status/, () => ({ body: { state: 'downloading', progress: 0.1 } })],
  ]);
  autodl.request(['s6']);
  await settle(t, 10);
  autodl.prune([]);
  assert.equal(autodl.view('s6').kind, 'downloading');
});
