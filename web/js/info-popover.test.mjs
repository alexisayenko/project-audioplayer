import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placePopover, INFO_EDGE, INFO_GAP } from './info-popover.js';

const view = { w: 1024, h: 768 };
const size = { w: 300, h: 80 };
const box = (left, top, side = 20) => ({ left, top, right: left + side, bottom: top + side });

test('placePopover: centred below the button when there is room', () => {
  const at = placePopover({ anchor: box(500, 100), size, viewport: view });
  assert.equal(at.placement, 'below');
  assert.equal(at.left, 510 - 150);
  assert.equal(at.top, 120 + INFO_GAP);
  assert.equal(at.arrow, 150);
});

test('placePopover: shifts left near the right edge and the arrow keeps pointing at the button', () => {
  const at = placePopover({ anchor: box(1000, 100), size, viewport: view });
  assert.equal(at.left, 1024 - 300 - INFO_EDGE);
  assert.equal(at.left + at.arrow, 1010);
});

test('placePopover: shifts right near the left edge', () => {
  const at = placePopover({ anchor: box(0, 100), size, viewport: view });
  assert.equal(at.left, INFO_EDGE);
});

test('placePopover: flips above when it does not fit below', () => {
  const at = placePopover({ anchor: box(500, 700), size, viewport: view });
  assert.equal(at.placement, 'above');
  assert.equal(at.top, 700 - INFO_GAP - 80);
});

test('placePopover: stays below when it fits neither side', () => {
  const at = placePopover({ anchor: box(500, 30), size: { w: 300, h: 900 }, viewport: view });
  assert.equal(at.placement, 'below');
});

test('placePopover: a bubble wider than a 375 px viewport minus the gutters starts at the left gutter', () => {
  const at = placePopover({ anchor: box(300, 100), size: { w: 343, h: 80 }, viewport: { w: 375, h: 700 } });
  assert.equal(at.left, INFO_EDGE);
  assert.ok(at.left + 343 <= 375 - INFO_EDGE + 0.001);
});
