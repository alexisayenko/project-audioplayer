import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeterCore, levelOfBytes, describeLayout, STRIP_LEN, GIVE_UP_MS, TAIL_MS } from './latency-core.js';

const feed = (core, t0, levels) => levels.map((lv, i) => core.sample(t0 + (i + 1) * 100, lv));

test('levelOfBytes: silence is 0, a full swing is 100, the peak counts', () => {
  assert.equal(levelOfBytes(new Uint8Array([128, 128, 128])), 0);
  assert.equal(levelOfBytes(new Uint8Array([128, 0, 128])), 100);
  assert.equal(levelOfBytes(new Uint8Array([128, 192, 100])), 50);
  assert.equal(levelOfBytes(new Uint8Array(0)), 0);
});

test('a press resets the run: counter, strip, marks, facts and the found sound', () => {
  const core = createMeterCore();
  core.press(1000, 'first');
  core.fact('ua', 'x');
  feed(core, 1000, [0, 5, 6, 7]);
  assert.equal(core.snapshot(1500).soundMs, 100 * 2);
  core.press(5000, 'second');
  const s = core.snapshot(5000);
  assert.equal(s.ms, 0);
  assert.equal(s.soundMs, null);
  assert.deepEqual(s.strip, []);
  assert.deepEqual(s.facts, []);
  assert.deepEqual(s.marks.map((m) => m.name), ['press']);
  assert.equal(s.method, 'none');
  assert.equal(s.active, true);
});

test('the counter runs from the press while the run is active', () => {
  const core = createMeterCore();
  core.press(2000);
  assert.equal(core.snapshot(2000).ms, 0);
  assert.equal(core.snapshot(2347.26).ms, 347.3);
});

test('first sound: level above the threshold for 2 consecutive samples, reported at the first of the two', () => {
  const core = createMeterCore();
  core.press(0);
  feed(core, 0, [0, 0, 3, 0, 4, 9, 30]);
  const s = core.snapshot(800);
  assert.equal(s.method, 'level');
  assert.equal(s.soundMs, 500);
  assert.equal(s.levelSoundMs, 500);
  assert.ok(s.marks.some((m) => m.name === 'first sound (level)' && m.ms === 500));
});

test('a level exactly at the threshold is not sound', () => {
  const core = createMeterCore();
  core.press(0);
  feed(core, 0, [2, 2, 2, 2]);
  assert.equal(core.snapshot(400).soundMs, null);
});

test('the strip keeps the last 30 samples', () => {
  const core = createMeterCore();
  core.press(0);
  feed(core, 0, Array.from({ length: 45 }, (_, i) => i % 2));
  const s = core.snapshot(4500);
  assert.equal(s.strip.length, STRIP_LEN);
  assert.equal(s.strip[STRIP_LEN - 1], 44 % 2);
});

test('without an analyser the method is timeupdate and the first timeupdate with a position is the sound', () => {
  const core = createMeterCore();
  core.press(0);
  core.sample(100, null);
  core.timeupdate(150, 0);
  assert.equal(core.snapshot(200).soundMs, null);
  core.timeupdate(900, 0.25);
  core.timeupdate(1200, 0.5);
  const s = core.snapshot(1300);
  assert.equal(s.method, 'timeupdate');
  assert.equal(s.soundMs, 900);
  assert.equal(s.progressMs, 900);
});

test('with an analyser from the start the level decides, the timeupdate is only reported', () => {
  const core = createMeterCore();
  core.press(0);
  feed(core, 0, [0, 0, 0]);
  core.timeupdate(250, 0.2);
  feed(core, 300, [0, 8, 9]);
  const s = core.snapshot(700);
  assert.equal(s.method, 'level');
  assert.equal(s.soundMs, 500);
  assert.equal(s.progressMs, 250);
});

test('an analyser that appears after the run began does not move the sound time', () => {
  const core = createMeterCore();
  core.press(0);
  core.sample(100, null);
  core.timeupdate(300, 0.1);
  feed(core, 100, [null, 50, 50]);
  const s = core.snapshot(500);
  assert.equal(s.method, 'timeupdate');
  assert.equal(s.soundMs, 300);
});

test('a press while another song plays ignores the old audio until the new source is armed', () => {
  const core = createMeterCore();
  core.press(0, 'row', { armed: false });
  feed(core, 0, [40, 40, 40]);
  assert.equal(core.snapshot(300).soundMs, null);
  core.arm(300);
  core.arm(900);
  core.sample(350, 40);
  core.sample(480, 40);
  assert.equal(core.snapshot(480).soundMs, null, 'inside the guard after arming');
  core.sample(500, 40);
  core.sample(600, 40);
  assert.equal(core.snapshot(600).soundMs, 500);
});

test('timeupdate before the run is armed is ignored', () => {
  const core = createMeterCore();
  core.press(0, 'row', { armed: false });
  core.sample(100, null);
  core.timeupdate(200, 10);
  assert.equal(core.snapshot(300).progressMs, null);
});

test('the run ends after the tail following the first sound, and sample then returns false', () => {
  const core = createMeterCore();
  core.press(0);
  const levels = Array.from({ length: 60 }, () => 30);
  const results = feed(core, 0, levels);
  const lastTrue = results.lastIndexOf(true);
  assert.ok(lastTrue >= TAIL_MS / 100 - 2 && lastTrue < 40);
  const s = core.snapshot(99999);
  assert.equal(s.active, false);
  assert.equal(s.ms, 100, 'the counter stops at the first sound');
  assert.equal(core.sample(99999, 30), false);
});

test('the counter keeps running until the sound is found, then shows the sound time', () => {
  const core = createMeterCore();
  core.press(0);
  core.sample(100, 0);
  assert.equal(core.snapshot(150).ms, 150);
  core.sample(200, 9);
  core.sample(300, 9);
  assert.equal(core.snapshot(900).ms, 200);
});

test('a run with no sound gives up', () => {
  const core = createMeterCore();
  core.press(0);
  const results = feed(core, 0, Array.from({ length: GIVE_UP_MS / 100 + 5 }, () => 0));
  assert.equal(results.at(-1), false);
  assert.equal(core.snapshot(1e6).ms, GIVE_UP_MS);
});

test('stop freezes the counter', () => {
  const core = createMeterCore();
  core.press(0);
  core.stop(450);
  assert.equal(core.snapshot(9000).ms, 450);
  assert.equal(core.running, false);
});

test('marks and facts before any press are ignored; a repeated fact replaces its value', () => {
  const core = createMeterCore();
  core.mark('x', 5);
  core.fact('a', 1);
  assert.equal(core.toText(), 'Latency meter: no run yet');
  core.press(10);
  core.fact('a', 1);
  core.fact('a', 2);
  assert.deepEqual(core.snapshot(10).facts, [{ key: 'a', value: 2 }]);
});

test('toText lists the facts, the sound, the marks with offsets, the requests and the levels', () => {
  const core = createMeterCore();
  core.press(1000, 'pointerdown BUTTON');
  core.fact('ua', 'Safari/17');
  core.fact('audio context at press', 'suspended');
  core.mark('loadstart', 1120.44);
  feed(core, 1000, [0, 7, 8]);
  core.setResources([
    { name: '/files/old', who: 'prev', start: -80, connect: 0, requestStart: -70, responseStart: -60, responseEnd: 40, bytes: 786432 },
    { name: '/files/abc', who: 'cur', start: 130.2, connect: 55.5, requestStart: 140, responseStart: 300.5, responseEnd: 650, bytes: 4152631 },
  ]);
  const text = core.toText();
  assert.match(text, /^Latency meter run\nua: Safari\/17\naudio context at press: suspended\n/);
  assert.match(text, /first sound: 200 ms \(method: level, level>2 for 2 samples\)/);
  assert.match(text, /0\s+press pointerdown BUTTON/);
  assert.match(text, /120\.4\s+loadstart/);
  assert.match(text, /\[cur\] \/files\/abc start 130\.2 connect 55\.5 requestStart 140 responseStart 300\.5 responseEnd 650 bytes 4152631/);
  assert.match(text, /\[prev\] \/files\/old start -80 \(before the press\) connect 0 requestStart -70/);
  assert.match(text, /requests in the first 5 s/);
  assert.match(text, /0 7 8$/);
});

test('toText says so when no request is listed', () => {
  const core = createMeterCore();
  core.press(1000, 'pointerdown BUTTON');
  assert.match(core.toText(), /requests: none listed/);
});

test('describeLayout: faststart, tail moov and unknown', () => {
  const box = (kind, size) => {
    const b = new Uint8Array(size);
    new DataView(b.buffer).setUint32(0, size);
    for (let i = 0; i < 4; i++) b[4 + i] = kind.charCodeAt(i);
    return b;
  };
  const join = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const fast = describeLayout(join(box('ftyp', 24), box('moov', 100), box('free', 8), box('mdat', 500)));
  assert.deepEqual(fast.boxes, ['ftyp', 'moov', 'free', 'mdat']);
  assert.equal(fast.faststart, true);
  const bigMdat = box('mdat', 16);
  new DataView(bigMdat.buffer).setUint32(0, 4000000);
  const slow = describeLayout(join(box('ftyp', 24), box('free', 8), bigMdat));
  assert.deepEqual(slow.boxes, ['ftyp', 'free', 'mdat']);
  assert.equal(slow.faststart, false);
  assert.match(slow.verdict, /AFTER/);
  const unknown = describeLayout(join(box('ftyp', 24)));
  assert.equal(unknown.faststart, null);
  assert.equal(describeLayout(new Uint8Array(3)).faststart, null);
});
