import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { drawBars } from './viz-bars.js';
import { FALLBACK_COLORS } from './viz-color.js';

function trace(opts) {
  const log = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'createLinearGradient' ? (...a) => { log.push(['grad', a]); return { addColorStop: (...s) => log.push(['stop', s]) }; } : (...a) => { log.push([k, a]); }),
    set: (_, k, v) => { log.push(['set', k, typeof v === 'object' ? 'obj' : v]); return true; },
  });
  const vals = Float32Array.from({ length: 120 }, (_, i) => ((i * 37) % 100) / 100);
  drawBars(ctx, 600, 300, vals, { colors: FALLBACK_COLORS, dpr: 1.5, ...opts });
  return log;
}

const hash = (log) => createHash('sha256').update(JSON.stringify(log)).digest('hex').slice(0, 16);

test('default and preset-like settings draw exactly the ops of the pre-LED renderer', () => {
  assert.equal(hash(trace({})), '77fd6c41b48c1f07');
  assert.equal(hash(trace({ widthFraction: 0.9, reflection: 0.8, glow: false, span: 1.1 })), '453ede7fe3898830');
  assert.equal(hash(trace({ alpha: 0.85, horizon: 0.5 })), 'bce9c34d3851e751');
});

const rects = (log) => log.filter(([k]) => k === 'rect');

test('LED sections cut each bar into stacked segments that follow the level', async () => {
  const { segmentPlan, litRows } = await import('./viz-bars.js');
  const plan = segmentPlan(100, 1, 10, 0.3);
  assert.equal(plan.rows, 10);
  assert.equal(plan.gapPx, 3);
  assert.equal(litRows(0, 1, plan), 0);
  assert.equal(litRows(35, 1, plan), 4);
  assert.equal(litRows(500, 1, plan), 10);
  assert.equal(segmentPlan(100, 1, 0, 0.3), null);
  const solid = rects(trace({}));
  const led = rects(trace({ segments: 12 }));
  assert.ok(led.length > solid.length);
  assert.ok(led.every(([, a]) => a[3] >= 1));
});

test('ice palette, vertical gradient, tips, band and backdrop each add ops, others stay off', () => {
  const base = trace({}).length;
  const vertical = trace({ direction: 'vertical' });
  assert.ok(vertical.some(([k, a]) => k === 'grad' && a[0] === 0 && a[2] === 0 && a[1] !== a[3]));
  assert.ok(trace({ band: 0.8 }).length > base);
  assert.ok(trace({ tips: true }).length > base);
  assert.equal(trace({ backdrop: 'ice', colors: { ...FALLBACK_COLORS, ice: undefined } }).length, base);
  assert.ok(trace({ backdrop: 'ice' }).length > base);
});

test('tips hold the peak and fall at the fading speed', async () => {
  const { stepTips, resetTips, barHeights } = await import('./viz-bars.js');
  resetTips();
  barHeights(new Float32Array([1, 1]), 100);
  assert.equal(stepTips(2, 0.5, 100, 0.1)[0], barHeights(new Float32Array([1]), 100)[0]);
  barHeights(new Float32Array([0, 0]), 100);
  const before = stepTips(2, 0.5, 100, 0.1)[0];
  const after = stepTips(2, 0.5, 100, 0.1)[0];
  assert.ok(after < before);
  assert.ok(Math.abs(before - after - 5) < 1e-3);
});
