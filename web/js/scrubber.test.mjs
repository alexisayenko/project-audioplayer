import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent } from './test-dom.mjs';

installDom();
const { attachScrubber } = await import('./scrubber.js');

function setup({ duration = 200, time = 50 } = {}) {
  const node = document.createElement('div');
  const bubble = document.createElement('span');
  bubble.className = 'scrub-bubble';
  node.append(bubble);
  node.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, bottom: 10, right: 300, height: 10 });
  const st = { duration, time, seeks: [], previews: [] };
  const s = attachScrubber(node, {
    duration: () => st.duration, time: () => st.time,
    onSeek: (t) => st.seeks.push(t), onPreview: (t) => st.previews.push(t),
  });
  return { node, s, st, bubble };
}
const ptr = (type, clientX, extra = {}) => makeEvent(type, { clientX, pointerId: 1, button: 0, ...extra });

test('initial paint sets aria and fraction', () => {
  const { node } = setup();
  assert.equal(node.getAttribute('aria-valuenow'), '50');
  assert.equal(node.getAttribute('aria-valuemax'), '200');
  assert.equal(node.style.getPropertyValue('--p'), '0.2500');
  assert.equal(node.getAttribute('aria-valuetext'), '0:50 of 3:20');
  assert.equal(node.getAttribute('aria-disabled'), 'false');
});

test('unusable duration disables the control and ignores pointer', () => {
  const { node, st } = setup({ duration: NaN });
  assert.equal(node.getAttribute('aria-disabled'), 'true');
  assert.equal(node.tabIndex, -1);
  node.dispatchEvent(ptr('pointerdown', 200));
  node.dispatchEvent(ptr('pointerup', 200));
  assert.deepEqual(st.seeks, []);
});

test('drag previews while moving and commits one seek on pointerup', () => {
  const { node, st, s } = setup();
  node.dispatchEvent(ptr('pointerdown', 200));
  assert.equal(s.dragging, true);
  assert.ok(node.classList.contains('dragging'));
  node.dispatchEvent(ptr('pointermove', 250));
  node.dispatchEvent(ptr('pointerup', 300));
  assert.deepEqual(st.seeks, [200]);
  assert.equal(st.previews.at(-1), null, 'preview cleared at the end');
  assert.equal(s.dragging, false);
  assert.ok(!node.classList.contains('dragging'));
});

test('pointercancel and lostpointercapture end the drag without seeking', () => {
  for (const ev of ['pointercancel', 'lostpointercapture']) {
    const { node, st, s } = setup();
    node.dispatchEvent(ptr('pointerdown', 150));
    node.dispatchEvent(makeEvent(ev));
    assert.equal(s.dragging, false);
    assert.deepEqual(st.seeks, []);
  }
});

test('other pointers and secondary buttons are ignored', () => {
  const { node, st, s } = setup();
  node.dispatchEvent(ptr('pointerdown', 150, { button: 2 }));
  assert.equal(s.dragging, false);
  node.dispatchEvent(ptr('pointerdown', 150));
  node.dispatchEvent(ptr('pointerup', 250, { pointerId: 9 }));
  assert.equal(s.dragging, true);
  assert.deepEqual(st.seeks, []);
});

test('positions clamp to the track', () => {
  const { node, st } = setup();
  node.dispatchEvent(ptr('pointerdown', 0));
  node.dispatchEvent(ptr('pointerup', 9999));
  assert.deepEqual(st.seeks, [200]);
});

test('keyboard: arrows step 5 s, shift 15 s, Home/End jump, modifiers ignored', () => {
  const { node, st } = setup();
  const key = (k, extra = {}) => { const e = makeEvent('keydown', { key: k, ...extra }); node.dispatchEvent(e); return e; };
  key('ArrowRight');
  key('ArrowLeft', { shiftKey: true });
  key('Home');
  key('End');
  assert.deepEqual(st.seeks, [55, 35, 0, 200]);
  assert.equal(key('ArrowRight', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(key('x').defaultPrevented, false);
  assert.equal(st.seeks.length, 4);
});

test('sync repaints from the clock when not dragging', () => {
  const { node, st, s } = setup();
  st.time = 100;
  s.sync();
  assert.equal(node.getAttribute('aria-valuenow'), '100');
});
