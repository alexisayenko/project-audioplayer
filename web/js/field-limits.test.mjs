import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldLimits, clampRange } from './field-limits.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('pads each side by 20% of the extent', () => {
  const l = fieldLimits([{ x: 1980, y: 100 }, { x: 2020, y: 180 }]);
  near(l.x.lo, 1972);
  near(l.x.hi, 2028);
  near(l.y.lo, 84);
  near(l.y.hi, 196);
});

test('single point gets the minimum span around it', () => {
  const l = fieldLimits([{ x: 2000, y: 120 }]);
  near(l.x.lo, 1995);
  near(l.x.hi, 2005);
  near(l.y.lo, 100);
  near(l.y.hi, 140);
});

test('zero width or height falls back to the minimum span on that axis only', () => {
  const l = fieldLimits([{ x: 2000, y: 100 }, { x: 2000, y: 160 }]);
  near(l.x.hi - l.x.lo, 10);
  near(l.y.lo, 88);
  near(l.y.hi, 172);
});

test('floorY keeps the lower edge at the floor and preserves the span', () => {
  const l = fieldLimits([{ x: 1, y: 10 }, { x: 2, y: 30 }], { floorY: 0 });
  near(l.y.lo, 0);
  near(l.y.hi - l.y.lo, 40);
});

test('no points returns the fallback', () => {
  assert.equal(fieldLimits([]), null);
  const fb = { x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } };
  assert.equal(fieldLimits([], { fallback: fb }), fb);
});

test('non-finite points are ignored', () => {
  const l = fieldLimits([{ x: NaN, y: 1 }, { x: 10, y: 10 }, { x: 20, y: 20 }]);
  near(l.x.lo, 8);
  near(l.x.hi, 22);
});

test('clampRange shifts a view back inside and caps the span', () => {
  const b = { lo: 0, hi: 100 };
  assert.deepEqual(clampRange(-10, 20, b), { lo: 0, hi: 30 });
  assert.deepEqual(clampRange(90, 120, b), { lo: 70, hi: 100 });
  assert.deepEqual(clampRange(-50, 200, b), { lo: 0, hi: 100 });
  assert.deepEqual(clampRange(10, 20, b), { lo: 10, hi: 20 });
  assert.deepEqual(clampRange(5, 6, null), { lo: 5, hi: 6 });
});
