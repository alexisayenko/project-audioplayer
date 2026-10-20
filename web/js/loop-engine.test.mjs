import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_LOOP, LOOKAHEAD, MAX_OVERSHOOT, MAX_WAIT_MS, clampTime, validRegion, setMark, moveHandle, nudge, decide, fmtClock, parseClock, createLoop } from './loop-engine.js';

test('PLY-160: clampTime keeps a time inside the song and rounds to milliseconds', () => {
  assert.equal(clampTime(-3, 100), 0);
  assert.equal(clampTime(120, 100), 100);
  assert.equal(clampTime(12.34567, 100), 12.346);
  assert.equal(clampTime(NaN, 100), 0);
  assert.equal(clampTime(500, NaN), 500);
});

test('PLY-160: validRegion needs two numbers, start before end by MIN_LOOP, inside the song', () => {
  assert.equal(validRegion({ start: 1, end: 2 }, 10), true);
  assert.equal(validRegion({ start: 1, end: 1 + MIN_LOOP }, 10), true);
  assert.equal(validRegion({ start: 1, end: 1.05 }, 10), false);
  assert.equal(validRegion({ start: 2, end: 1 }, 10), false);
  assert.equal(validRegion({ start: -1, end: 1 }, 10), false);
  assert.equal(validRegion({ start: 1, end: 11 }, 10), false);
  assert.equal(validRegion({ start: 1, end: 11 }), true);
  assert.equal(validRegion({ start: null, end: 5 }, 10), false);
  assert.equal(validRegion(null, 10), false);
});

test('PLY-160: setMark places A or B; a mark that crosses the other one clears it', () => {
  let r = setMark(null, 'start', 12.3, 100);
  assert.deepEqual(r, { start: 12.3, end: null });
  r = setMark(r, 'end', 27.5, 100);
  assert.deepEqual(r, { start: 12.3, end: 27.5 });
  assert.deepEqual(setMark(r, 'start', 40, 100), { start: 40, end: null });
  assert.deepEqual(setMark(r, 'end', 5, 100), { start: null, end: 5 });
  assert.deepEqual(setMark(r, 'end', 500, 100), { start: 12.3, end: 100 });
  assert.deepEqual(setMark(null, 'start', -4, 100), { start: 0, end: null });
  assert.deepEqual(setMark(null, 'start', 100, 100), { start: 99.9, end: null });
});

test('PLY-160: moveHandle keeps the handles apart and inside the song', () => {
  const r = { start: 10, end: 20 };
  assert.equal(moveHandle(r, 'start', 25, 100).start, 20 - MIN_LOOP);
  assert.equal(moveHandle(r, 'end', 5, 100).end, 10 + MIN_LOOP);
  assert.equal(moveHandle(r, 'end', 500, 100).end, 100);
  assert.equal(moveHandle(r, 'start', -9, 100).start, 0);
  assert.deepEqual(moveHandle({ start: null, end: 5 }, 'start', 2, 100), { start: null, end: 5 });
});

test('PLY-160: nudge moves one mark by a step and clamps', () => {
  const r = { start: 10, end: 20 };
  assert.deepEqual(nudge(r, 'start', 0.1, 100), { start: 10.1, end: 20 });
  assert.deepEqual(nudge(r, 'end', -1, 100), { start: 10, end: 19 });
  assert.equal(nudge(r, 'start', 50, 100).start, 20 - MIN_LOOP);
  assert.equal(nudge({ start: 0.05, end: 5 }, 'start', -1, 100).start, 0);
  assert.equal(nudge({ start: 10, end: 99.95 }, 'end', 1, 100).end, 100);
  assert.deepEqual(nudge({ start: null, end: 5 }, 'start', 1, 100), { start: null, end: 5 });
});

test('PLY-160: decide jumps to A at B, waits before it and idles when the loop cannot apply', () => {
  const region = { start: 12, end: 27 };
  assert.deepEqual(decide({ time: 27 - LOOKAHEAD, region }), { kind: 'seek', to: 12 });
  assert.deepEqual(decide({ time: 27.3, region }), { kind: 'seek', to: 12 });
  assert.deepEqual(decide({ time: 27 + MAX_OVERSHOOT + 1, region }), { kind: 'idle' });
  assert.deepEqual(decide({ time: 20, region, playing: false }), { kind: 'idle' });
  assert.deepEqual(decide({ time: 20, region: { start: 12, end: null } }), { kind: 'idle' });
  assert.deepEqual(decide({ time: NaN, region }), { kind: 'idle' });
  assert.deepEqual(decide({ time: 5, region }), { kind: 'wait', ms: MAX_WAIT_MS });
});

test('PLY-160: the wait shrinks as B nears and scales with the playback rate', () => {
  const region = { start: 0, end: 10 };
  const at = (time, rate = 1) => decide({ time, region, rate }).ms;
  assert.ok(Math.abs(at(9.9) - 75) < 1e-6);
  assert.ok(Math.abs(at(9.9, 2) - 37.5) < 1e-6);
  assert.ok(Math.abs(at(9.9, 0.5) - 150) < 1e-6);
  assert.equal(at(9.9, 0), at(9.9, 1));
});

test('WEB-152: fmtClock and parseClock use m:ss.s and round-trip', () => {
  assert.equal(fmtClock(0), '0:00.0');
  assert.equal(fmtClock(12.34), '0:12.3');
  assert.equal(fmtClock(59.96), '1:00.0');
  assert.equal(fmtClock(754.5), '12:34.5');
  assert.equal(fmtClock(-4), '0:00.0');
  assert.equal(fmtClock(NaN), '0:00.0');
  assert.equal(parseClock('0:12.4'), 12.4);
  assert.equal(parseClock('1:05'), 65);
  assert.equal(parseClock('12.4'), 12.4);
  assert.equal(parseClock('75'), 75);
  assert.equal(parseClock(' 2:03,5 '), 123.5);
  assert.equal(parseClock('1:75'), null);
  assert.equal(parseClock('abc'), null);
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('1:2:3'), null);
  assert.equal(parseClock('-3'), null);
  for (const t of [0, 3.1, 61.7, 600.2]) assert.equal(parseClock(fmtClock(t)), t);
});

function fakeAudio() {
  const handlers = {};
  return {
    currentTime: 0, duration: 100, paused: false, playbackRate: 1, seeking: false, plays: 0,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    emit(type) { (handlers[type] || []).forEach((fn) => fn({ type })); },
    play() { this.plays += 1; this.paused = false; return Promise.resolve(); },
  };
}

function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    set: (fn, ms) => { id += 1; pending.set(id, { fn, ms }); return id; },
    clear: (i) => pending.delete(i),
    get count() { return pending.size; },
    last() { return [...pending.values()].at(-1); },
    run() { const all = [...pending]; pending.clear(); for (const [, t] of all) t.fn(); },
  };
}

test('PLY-160: the loop wraps from B to A through a timer and a timeupdate backstop', () => {
  const audio = fakeAudio();
  const timers = fakeTimers();
  const loop = createLoop(audio, timers);
  loop.setRegion(12, 27, true);
  assert.equal(loop.get().active, true);
  assert.equal(loop.wraps, 0);
  audio.currentTime = 26.9;
  audio.emit('seeked');
  assert.ok(timers.count >= 1, 'a timer is armed near B');
  assert.ok(timers.last().ms < MAX_WAIT_MS);
  audio.currentTime = 26.98;
  timers.run();
  assert.equal(audio.currentTime, 12);
  assert.equal(loop.wraps, 1);
  audio.currentTime = 27.01;
  audio.emit('timeupdate');
  assert.equal(audio.currentTime, 12, 'timeupdate is the backstop when the timer was throttled');
  assert.equal(loop.wraps, 2);
});

test('PLY-160: while the element is seeking, nothing jumps twice', () => {
  const audio = fakeAudio();
  const loop = createLoop(audio, fakeTimers());
  loop.setRegion(1, 2, true);
  audio.currentTime = 2.5;
  audio.seeking = true;
  audio.emit('timeupdate');
  assert.equal(audio.currentTime, 2.5);
  assert.equal(loop.wraps, 0);
});

test('PLY-160: a paused element is never touched, play re-arms, pause disarms', () => {
  const audio = fakeAudio();
  const timers = fakeTimers();
  const loop = createLoop(audio, timers);
  audio.paused = true;
  audio.currentTime = 5;
  loop.setRegion(1, 2, true);
  assert.equal(timers.count, 0);
  assert.equal(audio.currentTime, 5);
  audio.paused = false;
  audio.currentTime = 1.5;
  audio.emit('play');
  assert.equal(timers.count, 1);
  audio.emit('pause');
  assert.equal(timers.count, 0);
});

test('PLY-160: loop off, a bad region and clear stop the loop and notify', () => {
  const audio = fakeAudio();
  const loop = createLoop(audio, fakeTimers());
  const seen = [];
  const stop = loop.onChange((s) => seen.push(s));
  loop.setRegion(10, 20, true);
  loop.setOn(false);
  assert.equal(loop.get().active, false);
  assert.deepEqual([loop.get().start, loop.get().end], [10, 20], 'the region stays when the loop is off');
  loop.toggle();
  assert.equal(loop.get().on, true);
  loop.setRegion(30, 30.01, true);
  assert.deepEqual(loop.get(), { start: null, end: null, on: false, active: false });
  loop.setRegion(10, 20, true);
  loop.clear();
  assert.deepEqual(loop.get(), { start: null, end: null, on: false, active: false });
  const n = seen.length;
  loop.clear();
  assert.equal(seen.length, n, 'clearing an empty loop is silent');
  stop();
  loop.setRegion(1, 3);
  assert.equal(seen.length, n);
});

test('PLY-160: marks and nudges are clamped by the song duration; A alone cannot turn the loop on', () => {
  const audio = fakeAudio();
  audio.duration = 30;
  const loop = createLoop(audio, fakeTimers());
  loop.setMark('start', 5);
  loop.setOn(true);
  assert.equal(loop.get().on, false);
  loop.setMark('end', 99);
  assert.equal(loop.get().end, 30);
  loop.setOn(true);
  assert.equal(loop.get().active, true);
  loop.nudge('start', -9);
  assert.equal(loop.get().start, 0);
  loop.move('end', 0.05);
  assert.equal(loop.get().end, 0 + MIN_LOOP);
});

test('PLY-160: a loop that ends at the end of the file wraps on ended instead of moving on', () => {
  const audio = fakeAudio();
  audio.duration = 30;
  const loop = createLoop(audio, fakeTimers());
  loop.setRegion(10, 30, true);
  audio.currentTime = 30;
  assert.equal(loop.onEnded(), true);
  assert.equal(audio.currentTime, 10);
  assert.equal(audio.plays, 1);
  loop.setRegion(10, 20, true);
  assert.equal(loop.onEnded(), false);
  loop.setOn(false);
  assert.equal(loop.onEnded(), false);
});
