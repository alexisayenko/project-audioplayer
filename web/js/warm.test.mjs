import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWarmer, watchRowPress, watchNextProbe, saveDataOn, WARM_GAP_MS, NEXT_DELAY_MS } from './warm.js';

function setup(opts = {}) {
  const calls = [];
  const marks = [];
  const clock = { t: 1000 };
  const warmer = createWarmer({
    urlOf: (id) => `/files/${id}`,
    fetchFn: (url, init) => { calls.push({ url, init }); return Promise.resolve({ body: { cancel() {} } }); },
    now: () => clock.t,
    mark: (name, detail) => marks.push([name, detail]),
    ...opts,
  });
  return { calls, marks, clock, warmer };
}

test('PLY-209: prepare sends one 2-byte Range request for the song file and records a prepare mark', () => {
  const { calls, marks, warmer } = setup();
  assert.equal(typeof warmer.prepare('a'), 'function');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/files/a');
  assert.equal(calls[0].init.headers.Range, 'bytes=0-1');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(marks, [['prepare', 'a']]);
});

test('PLY-209: prepare is rate limited to one per song per 5 s', () => {
  const { calls, clock, warmer } = setup();
  warmer.prepare('a');
  clock.t += WARM_GAP_MS - 1;
  assert.equal(warmer.prepare('a'), null);
  warmer.prepare('b');
  assert.equal(calls.length, 2);
  clock.t += 2;
  warmer.prepare('a');
  assert.equal(calls.length, 3);
});

test('PLY-209: prepare is skipped when the song may not be warmed, and a failing fetch never throws', async () => {
  const none = setup({ canPrepare: () => false });
  assert.equal(none.warmer.prepare('a'), null);
  assert.equal(none.calls.length, 0);
  const bad = setup({ fetchFn: () => Promise.reject(new Error('x')) });
  bad.warmer.prepare('a');
  const sync = setup({ fetchFn: () => { throw new Error('x'); } });
  sync.warmer.prepare('a');
  await new Promise((r) => setImmediate(r));
});

test('PLY-214: cancelOthers aborts the warm-ups still in flight for other songs and keeps the one for the song starting', () => {
  const signals = {};
  const resolvers = [];
  const { warmer } = setup({
    fetchFn: (url, init) => { signals[url] = init.signal; return new Promise((r) => resolvers.push(r)); },
  });
  warmer.prepare('a');
  warmer.probeNext('b');
  warmer.prepare('c');
  assert.equal(warmer.cancelOthers('c'), 2);
  assert.equal(signals['/files/a'].aborted, true);
  assert.equal(signals['/files/b'].aborted, true);
  assert.equal(signals['/files/c'].aborted, false);
  assert.equal(warmer.cancelOthers('c'), 0, 'nothing left to cancel');
});

test('PLY-214: a warm-up that has finished is no longer in flight, and cancelOthers never throws', async () => {
  const { warmer } = setup();
  warmer.prepare('a');
  await new Promise((r) => setImmediate(r));
  assert.equal(warmer.cancelOthers('z'), 0);
  const failing = setup({ fetchFn: () => Promise.reject(new Error('x')) });
  failing.warmer.prepare('a');
  await new Promise((r) => setImmediate(r));
  assert.equal(failing.warmer.cancelOthers('z'), 0);
});

function fakeDoc() {
  const h = {};
  return {
    addEventListener: (n, f) => { (h[n] ||= []).push(f); },
    emit: (n, e = {}) => (h[n] || []).forEach((f) => f(e)),
  };
}

function rowButton(id, cls = true) {
  const li = { dataset: { id } };
  const btn = {
    contains: (t) => t === btn,
    closest: (sel) => (sel === 'li[data-id]' ? li : null),
  };
  const target = { closest: (sel) => (sel === '.row-cover.act-play' && cls ? btn : null) };
  return { btn, target };
}

function press() {
  const doc = fakeDoc();
  const started = [];
  const cancelled = [];
  watchRowPress(doc, (id) => { started.push(id); return () => cancelled.push(id); });
  return { doc, started, cancelled };
}

test('PLY-209: a mouse press on a row Play button starts a prepare; a pointerup on it keeps it', () => {
  const { doc, started, cancelled } = press();
  const { btn, target } = rowButton('s1');
  doc.emit('pointerdown', { pointerType: 'mouse', target });
  assert.deepEqual(started, ['s1']);
  doc.emit('pointerup', { target: btn });
  assert.deepEqual(cancelled, []);
});

test('PLY-209: the prepare is cancelled on pointercancel, on leaving the button and on a pointerup elsewhere', () => {
  const a = press();
  const r1 = rowButton('s1');
  a.doc.emit('pointerdown', { pointerType: 'pen', target: r1.target });
  a.doc.emit('pointercancel', {});
  assert.deepEqual(a.cancelled, ['s1']);
  const b = press();
  const r2 = rowButton('s2');
  b.doc.emit('pointerdown', { pointerType: 'mouse', target: r2.target });
  b.doc.emit('pointerleave', { target: r2.btn });
  assert.deepEqual(b.cancelled, ['s2']);
  const c = press();
  const r3 = rowButton('s3');
  c.doc.emit('pointerdown', { pointerType: 'mouse', target: r3.target });
  c.doc.emit('pointerup', { target: {} });
  assert.deepEqual(c.cancelled, ['s3']);
});

test('PLY-209: touch uses touchstart (not pointerdown) and a touchmove cancels it', () => {
  const { doc, started, cancelled } = press();
  const { target } = rowButton('s1');
  doc.emit('pointerdown', { pointerType: 'touch', target });
  assert.deepEqual(started, []);
  doc.emit('touchstart', { target });
  assert.deepEqual(started, ['s1']);
  doc.emit('touchmove', {});
  assert.deepEqual(cancelled, ['s1']);
  doc.emit('touchstart', { target });
  doc.emit('touchend', {});
  doc.emit('touchmove', {});
  assert.deepEqual(cancelled, ['s1']);
});

test('PLY-209: presses outside a Play row button are ignored', () => {
  const { doc, started } = press();
  doc.emit('pointerdown', { pointerType: 'mouse', target: rowButton('s1', false).target });
  doc.emit('pointerdown', { pointerType: 'mouse', target: {} });
  assert.deepEqual(started, []);
});

function nextSetup({ enabled = () => true, peek = 'n1' } = {}) {
  const h = {};
  const audio = { paused: true, addEventListener: (n, f) => { (h[n] ||= []).push(f); }, emit: (n) => (h[n] || []).forEach((f) => f()) };
  const state = { id: 'a', timers: [], probes: [], peek };
  watchNextProbe({
    audio,
    currentId: () => state.id,
    peekNext: () => state.peek,
    probe: (id) => state.probes.push(id),
    enabled,
    setT: (fn, ms) => { state.timers.push({ fn, ms, live: true }); return state.timers.length - 1; },
    clearT: (i) => { state.timers[i].live = false; },
  });
  const fire = () => state.timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); });
  const play = () => { audio.paused = false; audio.emit('playing'); };
  return { audio, state, fire, play };
}

test('PLY-211: the next song is probed once, 2 s after the current one starts playing', () => {
  const { state, fire, play, audio } = nextSetup();
  play();
  assert.equal(state.timers[0].ms, NEXT_DELAY_MS);
  assert.deepEqual(state.probes, []);
  fire();
  assert.deepEqual(state.probes, ['n1']);
  audio.emit('pause');
  play();
  fire();
  assert.deepEqual(state.probes, ['n1'], 'once per song');
  state.id = 'b';
  audio.emit('loadstart');
  play();
  fire();
  assert.deepEqual(state.probes, ['n1', 'n1'], 'a new song is probed again');
});

test('PLY-211: pausing or changing song before 2 s cancels the probe', () => {
  const { state, fire, play, audio } = nextSetup();
  play();
  audio.emit('pause');
  fire();
  assert.deepEqual(state.probes, []);
  play();
  audio.paused = true;
  fire();
  assert.deepEqual(state.probes, []);
  play();
  state.id = 'z';
  fire();
  assert.deepEqual(state.probes, []);
});

test('PLY-211: no probe when the next song is unknown (shuffle, no audio) or warming is disabled', () => {
  const none = nextSetup({ peek: null });
  none.play();
  none.fire();
  assert.deepEqual(none.state.probes, []);
  const off = nextSetup({ enabled: () => false });
  off.play();
  off.fire();
  assert.deepEqual(off.state.probes, []);
});

test('PLY-211: the next-song probe is a low-priority 2-byte Range request marked next-probe, and skipped for guests and saveData', () => {
  const { calls, marks, warmer } = setup();
  warmer.probeNext('n1');
  assert.equal(calls[0].init.priority, 'low');
  assert.equal(calls[0].init.headers.Range, 'bytes=0-1');
  assert.deepEqual(marks, [['next-probe', 'n1']]);
  const blocked = setup({ canProbeNext: () => false });
  assert.equal(blocked.warmer.probeNext('n1'), null);
  assert.equal(blocked.calls.length, 0);
});

test('PLY-211: saveDataOn reads navigator.connection.saveData', () => {
  assert.equal(saveDataOn({ connection: { saveData: true } }), true);
  assert.equal(saveDataOn({ connection: { saveData: false } }), false);
  assert.equal(saveDataOn({}), false);
  assert.equal(saveDataOn(null), false);
});
