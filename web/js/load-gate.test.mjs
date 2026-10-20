import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const { beginClickLoad, whenGateOpen } = await import('./load-gate.js');
const { PREFETCH_RESUME_MS } = await import('./constants.js');

const settled = async (p) => { let ok = false; p.then(() => { ok = true; }); await Promise.resolve(); await Promise.resolve(); return ok; };

test('WEB-121: the gate is open when no click is loading', async () => {
  assert.equal(await settled(whenGateOpen()), true);
});

test('WEB-121: a click load closes the gate until it settles plus the resume delay', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const end = beginClickLoad();
    const waiting = whenGateOpen();
    assert.equal(await settled(waiting), false);
    end();
    mock.timers.tick(PREFETCH_RESUME_MS - 1);
    assert.equal(await settled(waiting), false);
    mock.timers.tick(1);
    assert.equal(await settled(waiting), true);
  } finally { mock.timers.reset(); }
});

test('WEB-121: overlapping click loads and a new click during the delay keep the gate closed', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const a = beginClickLoad();
    const b = beginClickLoad();
    const waiting = whenGateOpen();
    a();
    mock.timers.tick(PREFETCH_RESUME_MS * 2);
    assert.equal(await settled(waiting), false);
    b();
    b();
    mock.timers.tick(PREFETCH_RESUME_MS - 1);
    const c = beginClickLoad();
    mock.timers.tick(PREFETCH_RESUME_MS * 2);
    assert.equal(await settled(waiting), false);
    c();
    mock.timers.tick(PREFETCH_RESUME_MS);
    assert.equal(await settled(waiting), true);
  } finally { mock.timers.reset(); }
});
