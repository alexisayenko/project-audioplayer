import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputLatencyS, nowTime, LATENCY_MAX_S } from './viz-latency.js';

test('output latency estimate adds outputLatency and baseLatency, tolerates a missing API and is bounded', () => {
  assert.equal(outputLatencyS({ outputLatency: 0.12, baseLatency: 0.01 }), 0.13);
  assert.equal(outputLatencyS({ baseLatency: 0.02 }), 0.02);
  assert.equal(outputLatencyS(null), 0);
  assert.equal(outputLatencyS({ outputLatency: NaN, baseLatency: -1 }), 0);
  assert.equal(outputLatencyS({ outputLatency: 9 }), LATENCY_MAX_S);
});

test('now-time = currentTime - output latency - sync trim', () => {
  assert.equal(nowTime(10, 0.12, 0), 9.88);
  assert.ok(Math.abs(nowTime(10, 0.12, 50) - 9.83) < 1e-12);
  assert.ok(Math.abs(nowTime(10, 0.12, -100) - 9.98) < 1e-12);
  assert.equal(nowTime(10, 0, NaN), 10);
});
