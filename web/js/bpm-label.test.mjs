import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpmLabel } from './bpm-label.js';

test('bpmLabel', () => {
  assert.equal(bpmLabel(132), '132');
  assert.equal(bpmLabel(127.6), '128');
  assert.equal(bpmLabel('90'), '90');
  assert.equal(bpmLabel(null), '');
  assert.equal(bpmLabel(undefined), '');
  assert.equal(bpmLabel(0), '');
  assert.equal(bpmLabel(NaN), '');
  assert.equal(bpmLabel(-5), '');
});
