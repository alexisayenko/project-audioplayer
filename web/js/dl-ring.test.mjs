import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { ringNode, paintRing, lineNode, paintLine } = await import('./dl-ring.js');
const { ringModel } = await import('./dl-progress.js');

const view = (kind, extra = {}) => ({ kind, progress: 0, error: '', minutes: 0, ...extra });

test('downloading ring is a progressbar with value, text and arc', () => {
  const m = ringModel(view('downloading', { progress: 0.42 }));
  const n = ringNode(m, () => {});
  assert.equal(n.getAttribute('role'), 'progressbar');
  assert.equal(n.getAttribute('aria-valuenow'), '42');
  assert.equal(n.querySelector('text').textContent, '42');
  assert.equal(n.querySelector('.arc').getAttribute('stroke-dashoffset'), String(m.offset));
  assert.equal(n.dataset.state, 'downloading');
});

test('repaint updates in place; idle/indeterminate classes follow the model', () => {
  const n = ringNode(ringModel(view('downloading', { progress: 0.1 })), () => {});
  assert.equal(paintRing(n, ringModel(view('downloading', { progress: 0.9 }))), true);
  assert.equal(n.getAttribute('aria-valuenow'), '90');
  assert.equal(paintRing(n, ringModel(view('queued'))), true);
  assert.ok(n.classList.contains('idle'));
  assert.equal(n.getAttribute('aria-valuenow'), null, 'queued has no value');
  paintRing(n, ringModel(view('converting')));
  assert.ok(!n.classList.contains('idle'));
});

test('failed ring is a retry button; click retries without bubbling', () => {
  let retried = 0;
  let bubbled = 0;
  const m = ringModel(view('failed', { error: 'boom' }));
  assert.equal(m.actionable, true);
  const b = ringNode(m, () => { retried += 1; });
  const parent = document.createElement('li');
  parent.addEventListener('click', () => { bubbled += 1; });
  parent.append(b);
  assert.equal(b.localName, 'button');
  b.click();
  assert.equal(retried, 1);
  assert.equal(bubbled, 0);
  assert.ok(b.getAttribute('aria-label'));
});

test('paintRing refuses when the role no longer fits (failed <-> rest)', () => {
  const ring = ringNode(ringModel(view('downloading', { progress: 0.5 })), () => {});
  assert.equal(paintRing(ring, ringModel(view('failed', { error: 'x' }))), false);
  const failed = ringNode(ringModel(view('failed', { error: 'x' })), () => {});
  assert.equal(paintRing(failed, ringModel(view('downloading', { progress: 0.5 }))), false);
});

test('line indicator follows the percentage', () => {
  const l = lineNode(ringModel(view('downloading', { progress: 0.33 })));
  assert.equal(l.style.getPropertyValue('--w'), '33%');
  paintLine(l, ringModel(view('downloading', { progress: 1 })));
  assert.equal(l.style.getPropertyValue('--w'), '100%');
  assert.equal(l.getAttribute('aria-hidden'), 'true');
});

test('ringModel is null when nothing is being fetched and clamps junk progress', () => {
  assert.equal(ringModel(null), null);
  assert.equal(ringModel(view('none')), null);
  assert.equal(ringModel(view('downloading', { progress: 7 })).now, 100);
  assert.equal(ringModel(view('downloading', { progress: -3 })).now, 0);
  assert.equal(ringModel(view('downloading', { progress: 'x' })).now, 0);
});
