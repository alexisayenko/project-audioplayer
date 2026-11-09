import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
globalThis.localStorage = {
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => { data.set(k, String(v)); },
  removeItem: (k) => { data.delete(k); },
};

const { meterOn, setMeter, bootMeter, startMeter, stopMeter, FLAG_KEY } = await import('./latency-flag.js');

function fakeLoad() {
  const calls = { start: 0, stop: 0, onClose: null };
  return {
    calls,
    load: async () => ({
      startLatencyMeter: ({ onClose }) => {
        calls.start += 1;
        calls.onClose = onClose;
        return { stop: () => { calls.stop += 1; } };
      },
    }),
  };
}

beforeEach(() => {
  data.clear();
  stopMeter();
});

test('off by default: boot loads nothing', async () => {
  const f = fakeLoad();
  assert.equal(meterOn(), false);
  bootMeter({ load: f.load });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(f.calls.start, 0);
});

test('the stored flag starts the meter once at boot', async () => {
  data.set(FLAG_KEY, '1');
  const f = fakeLoad();
  assert.equal(meterOn(), true);
  bootMeter({ load: f.load });
  bootMeter({ load: f.load });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(f.calls.start, 1);
});

test('the Settings switch stores the flag and starts or stops the meter at once', async () => {
  const f = fakeLoad();
  setMeter(true, { load: f.load });
  assert.equal(data.get(FLAG_KEY), '1');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(f.calls.start, 1);
  setMeter(false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(data.has(FLAG_KEY), false);
  assert.equal(f.calls.stop, 1);
});

test('closing the panel switches the meter off', async () => {
  const f = fakeLoad();
  await startMeter({ load: f.load });
  data.set(FLAG_KEY, '1');
  f.calls.onClose();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(data.has(FLAG_KEY), false);
  assert.equal(f.calls.stop, 1);
});

test('a failed load leaves the meter startable again', async () => {
  let n = 0;
  const load = async () => { n += 1; throw new Error('offline'); };
  assert.equal(await startMeter({ load }), null);
  assert.equal(await startMeter({ load }), null);
  assert.equal(n, 2);
});
