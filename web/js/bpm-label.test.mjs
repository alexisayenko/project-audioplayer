import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpmLabel, liveBpmLabel } from './bpm-label.js';

test('liveBpmLabel shows one decimal up to 200 BPM and an integer above', () => {
  assert.equal(liveBpmLabel(127.44), '127.4');
  assert.equal(liveBpmLabel(90), '90.0');
  assert.equal(liveBpmLabel(200), '200.0');
  assert.equal(liveBpmLabel(200.4), '200');
  assert.equal(liveBpmLabel(1000.6), '1001');
  assert.equal(liveBpmLabel(null), '');
  assert.equal(liveBpmLabel(0), '');
});

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
