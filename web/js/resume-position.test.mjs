import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResumePosition, RESUME_KEY } from './resume-position.js';

function rig() {
  const m = new Map();
  const clock = { t: 0 };
  const storage = { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
  return { m, clock, rp: createResumePosition({ storage, now: () => clock.t }) };
}

test('tick saves at most every 5 s', () => {
  const { rp, clock } = rig();
  assert.equal(rp.tick('a', 10), true);
  clock.t = 4000;
  assert.equal(rp.tick('a', 14), false);
  clock.t = 5000;
  assert.equal(rp.tick('a', 15), true);
  assert.deepEqual(rp.read(), { id: 'a', t: 15 });
});

test('save is immediate regardless of the throttle', () => {
  const { rp } = rig();
  rp.tick('a', 10);
  rp.save('a', 11);
  assert.equal(rp.read().t, 11);
});

test('position applies only to the stored song', () => {
  const { rp } = rig();
  rp.save('a', 60);
  assert.equal(rp.positionFor('a', 200), 60);
  assert.equal(rp.positionFor('b', 200), 0);
});

test('too early or too close to the end starts from 0', () => {
  const { rp } = rig();
  rp.save('a', 3);
  assert.equal(rp.positionFor('a', 200), 0);
  rp.save('a', 3.1);
  assert.equal(rp.positionFor('a', 200), 3.1);
  rp.save('a', 195);
  assert.equal(rp.positionFor('a', 200), 0);
  rp.save('a', 194);
  assert.equal(rp.positionFor('a', 200), 194);
});

test('invalid duration gives 0', () => {
  const { rp } = rig();
  rp.save('a', 60);
  for (const d of [NaN, Infinity, 0, -1, undefined]) assert.equal(rp.positionFor('a', d), 0);
});

test('clear removes the value and resets the throttle', () => {
  const { rp } = rig();
  rp.save('a', 60);
  rp.clear();
  assert.equal(rp.read(), null);
  assert.equal(rp.tick('b', 5), true);
});

test('corrupt or invalid stored values are ignored', () => {
  const { rp, m } = rig();
  for (const raw of ['{', 'null', '"x"', '{"id":"a","t":"5"}', '{"id":"a","t":-1}', '{"id":"","t":5}', '{"t":5}']) {
    m.set(RESUME_KEY, raw);
    assert.equal(rp.read(), null);
    assert.equal(rp.positionFor('a', 200), 0);
  }
});

test('invalid save arguments are rejected', () => {
  const { rp } = rig();
  assert.equal(rp.save('', 5), false);
  assert.equal(rp.save('a', NaN), false);
  assert.equal(rp.save('a', -2), false);
  assert.equal(rp.read(), null);
});

test('throwing storage never throws', () => {
  const boom = () => { throw new Error('denied'); };
  const rp = createResumePosition({ storage: { get: boom, set: boom, remove: boom } });
  assert.equal(rp.save('a', 5), false);
  assert.equal(rp.read(), null);
  assert.doesNotThrow(() => rp.clear());
});
