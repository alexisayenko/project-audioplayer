import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateCheck, versionFromUrl, readVersion, fetchServerVersion, defaultTimers, CHECK_MS, MIN_GAP_MS } from './update-check.js';

function rig({ current = 'aaa', visible = true, versions = [] } = {}) {
  const t = { clock: 0, visible, shown: [], hidden: 0, calls: 0, fns: [], cleared: [] };
  const timers = { set: (fn, ms) => { t.fns.push({ fn, ms }); return t.fns.length; }, clear: (id) => t.cleared.push(id) };
  const ctl = createUpdateCheck({
    current,
    fetchVersion: async () => {
      t.calls += 1;
      const v = versions.shift();
      if (v instanceof Error) throw v;
      return v;
    },
    isVisible: () => t.visible,
    show: (v) => t.shown.push(v),
    hide: () => { t.hidden += 1; },
    timers,
    now: () => t.clock,
  });
  return { t, ctl };
}

test('versionFromUrl reads the hash from a versioned asset URL', () => {
  assert.equal(versionFromUrl('https://electrophone.cc/_v/de077bb1ce/js/update-check.js'), 'de077bb1ce');
  assert.equal(versionFromUrl('_v/af7955defd/js/app.js'), 'af7955defd');
  assert.equal(versionFromUrl('js/app.js'), null);
  assert.equal(versionFromUrl(undefined), null);
});

test('readVersion falls back to the page script URL', () => {
  const doc = { querySelector: () => ({ getAttribute: () => '_v/abc123/js/app.js' }) };
  assert.equal(readVersion(doc, 'http://localhost/js/update-check.js'), 'abc123');
  assert.equal(readVersion({ querySelector: () => null }, 'http://localhost/js/x.js'), null);
});

test('shows one notice when the server version differs', async () => {
  const { t, ctl } = rig({ versions: ['bbb', 'bbb'] });
  await ctl.check();
  t.clock += MIN_GAP_MS;
  await ctl.check();
  assert.deepEqual(t.shown, ['bbb']);
});

test('same version or empty answer shows nothing', async () => {
  const { t, ctl } = rig({ versions: ['aaa', null, ''] });
  for (let i = 0; i < 3; i += 1) { await ctl.check(); t.clock += MIN_GAP_MS; }
  assert.deepEqual(t.shown, []);
});

test('failed checks are silent and later checks still work', async () => {
  const { t, ctl } = rig({ versions: [new Error('offline'), 'bbb'] });
  await ctl.check();
  t.clock += MIN_GAP_MS;
  await ctl.check();
  assert.deepEqual(t.shown, ['bbb']);
});

test('no network while the document is hidden', async () => {
  const { t, ctl } = rig({ visible: false, versions: ['bbb'] });
  await ctl.check();
  await ctl.check({ force: true });
  assert.equal(t.calls, 0);
  t.visible = true;
  await ctl.check();
  assert.equal(t.calls, 1);
});

test('checks closer than the minimum gap are skipped unless forced', async () => {
  const { t, ctl } = rig({ versions: ['aaa', 'aaa', 'aaa'] });
  await ctl.check();
  t.clock += MIN_GAP_MS - 1;
  await ctl.check();
  assert.equal(t.calls, 1);
  await ctl.check({ force: true });
  assert.equal(t.calls, 2);
});

test('dismiss hides until a different version appears', async () => {
  const { t, ctl } = rig({ versions: ['bbb', 'bbb', 'ccc'] });
  await ctl.check();
  ctl.dismiss();
  assert.equal(t.hidden, 1);
  t.clock += MIN_GAP_MS;
  await ctl.check();
  assert.deepEqual(t.shown, ['bbb']);
  t.clock += MIN_GAP_MS;
  await ctl.check();
  assert.deepEqual(t.shown, ['bbb', 'ccc']);
});

test('the timer reschedules itself every 5 minutes and stop cancels it', async () => {
  const { t, ctl } = rig({ versions: ['aaa', 'aaa'] });
  ctl.start();
  ctl.start();
  assert.equal(t.fns.length, 1);
  assert.equal(t.fns[0].ms, CHECK_MS);
  t.fns[0].fn();
  await Promise.resolve();
  assert.equal(t.fns.length, 2);
  assert.equal(t.calls, 1);
  ctl.stop();
  assert.deepEqual(t.cleared, [2]);
  t.fns[1].fn();
  assert.equal(t.fns.length, 2);
});

test('no current version means nothing runs', async () => {
  const { t, ctl } = rig({ current: null, versions: ['bbb'] });
  ctl.start();
  await ctl.check();
  assert.equal(t.fns.length, 0);
  assert.equal(t.calls, 0);
});

test('default timers are plain arrow wrappers, safe to call detached', () => {
  const { set, clear } = defaultTimers;
  const id = set(() => {}, 10);
  clear(id);
});

test('fetchServerVersion reads the version field and treats errors as no answer', async () => {
  const seen = [];
  const ok = async (url, opts) => { seen.push([url, opts]); return { ok: true, json: async () => ({ version: 'bbb' }) }; };
  assert.equal(await fetchServerVersion(ok), 'bbb');
  assert.equal(seen[0][0], '/version');
  assert.equal(seen[0][1].cache, 'no-store');
  assert.equal(await fetchServerVersion(async () => ({ ok: false })), null);
  assert.equal(await fetchServerVersion(async () => ({ ok: true, json: async () => ({}) })), null);
});

test('check() resolves true when the server version differs from the loaded one', async () => {
  const ctl = createUpdateCheck({ current: 'a', fetchVersion: async () => 'b', isVisible: () => false, show() {}, hide() {} });
  assert.equal(await ctl.check({ force: true, always: true }), true);
});
