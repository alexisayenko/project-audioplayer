import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, flush, makeEvent } from './test-dom.mjs';

installDom();
const ctxCalls = [];
const ctx = new Proxy({}, { get: (_, k) => (...a) => ctxCalls.push([k, ...a]), set: () => true });
document.createElement('x').constructor.prototype.getContext = () => ctx;
globalThis.location = { hash: '', href: 'http://localhost/' };
const { store } = await import('./store.js');
const { setGuest, clearGuest } = await import('./guest.js');
const { createLoop } = await import('./loop-engine.js');
const S = await import('./studio.js');
const { renderStudio, TAGLINE, EMPTY_TEXT, PREPARING, UNAVAILABLE, SIGN_IN_NOTE, TIME_HINT, NEED_MARKS } = S;

const SONG = { id: 'aaaaaaaaaaa', title: 'Free Bird', mainArtists: ['Lynyrd Skynyrd'], audio_state: 'server', duration: 540 };
const PEAKS = { v: 1, buckets: 4, duration: 540, min: [-10, -20, -30, -40], max: [10, 20, 30, 40] };

function fakeAudio() {
  const handlers = {};
  return {
    currentTime: 0, duration: 540, paused: true, playbackRate: 1, seeking: false,
    addEventListener(t, fn) { (handlers[t] ||= []).push(fn); },
    play() { this.paused = false; return Promise.resolve(); },
  };
}

function makePlayer(song = SONG) {
  const audio = fakeAudio();
  const listeners = new Set();
  const p = {
    audio, loop: createLoop(audio, { set: () => 1, clear: () => {} }), current: song && structuredClone(song), seeks: [], plays: 0,
    get position() { return audio.currentTime; },
    get duration() { return audio.duration; },
    seek(t) { audio.currentTime = t; p.seeks.push(t); },
    play() { p.plays += 1; audio.paused = false; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    change(next) { p.current = next; listeners.forEach((fn) => fn()); },
    listeners,
  };
  return p;
}

const noRaf = () => 1;
async function mount({ player = makePlayer(), load = async () => ({ peaks: PEAKS, source: 'server' }), patch, guest = false } = {}) {
  if (guest) setGuest({ audio: true }); else clearGuest();
  store.songs = player.current ? [player.current] : [];
  const api = { patch: patch ?? (async (id, body) => ({ id, loops: body.loops })) };
  const root = document.createElement('div');
  const dispose = renderStudio(root, { player, api, load, raf: noRaf, caf: () => {} });
  await flush();
  return { root, player, api, dispose };
}

const all = (root, sel) => root.querySelectorAll(sel);
const one = (root, sel) => root.querySelector(sel);
const byLabel = (root, label) => all(root, 'button').find((b) => b.getAttribute('aria-label') === label);
const byText = (root, text) => all(root, 'button').find((b) => b.textContent.includes(text) || b.getAttribute('aria-label') === text);
const typeTime = (input, value) => { input.value = value; fire(input, 'change'); };
const inputs = (root) => all(root, '.stu-time');
const handleA = (root) => one(root, '.stu-a');
const handleB = (root) => one(root, '.stu-b');

test('WEB-150: no song playing shows the empty state with the standard page head and a Library button', async () => {
  const { root } = await mount({ player: makePlayer(null) });
  assert.equal(one(root, 'h1').textContent, 'Studio');
  assert.equal(one(root, '.page-head .muted').textContent, TAGLINE);
  assert.equal(TAGLINE, 'Work on a track: loop a section, mark it, keep it.');
  assert.match(root.textContent, new RegExp(EMPTY_TEXT.replace('.', '\\.')));
  assert.equal(one(root, '.stu-empty a').getAttribute('href'), '#/library');
  assert.equal(one(root, '.stu-wave'), null);
});

test('WEB-150: a song without audio on the server is the empty state too', async () => {
  const { root } = await mount({ player: makePlayer({ ...SONG, audio_state: 'none' }) });
  assert.ok(one(root, '.stu-empty'));
});

test('WEB-150: the page shows the song, a waveform canvas and both handles hidden until marked', async () => {
  const { root } = await mount();
  assert.match(one(root, '.stu-song').textContent, /Free Bird/);
  assert.ok(one(root, 'canvas.stu-canvas'));
  assert.equal(handleA(root).hidden, true);
  assert.equal(handleB(root).hidden, true);
  assert.equal(one(root, '.stu-hint').textContent, NEED_MARKS);
  assert.equal(one(root, '.stu-toggle').disabled, true);
  assert.ok(ctxCalls.some((c) => c[0] === 'clearRect'), 'the canvas was drawn');
  assert.equal(one(root, '.stu-clock').textContent, '0:00.0 / 9:00.0');
});

test('WEB-151: Preparing waveform... shows while the peaks load and goes away when they arrive', async () => {
  let release;
  const load = () => new Promise((res) => { release = res; });
  const { root } = await mount({ load });
  assert.equal(one(root, '.stu-status').textContent, PREPARING);
  assert.equal(one(root, '.stu-status').hidden, false);
  release({ peaks: PEAKS, source: 'server' });
  await flush();
  assert.equal(one(root, '.stu-status').hidden, true);
});

test('WEB-151: with no waveform the note says so and A-B still works on the plain timeline', async () => {
  const { root, player } = await mount({ load: async () => { throw new Error('nope'); } });
  assert.equal(one(root, '.stu-status').textContent, UNAVAILABLE);
  player.audio.currentTime = 30;
  fire(byText(root, 'Set A here'), 'click');
  player.audio.currentTime = 45;
  fire(byText(root, 'Set B here'), 'click');
  assert.deepEqual([player.loop.get().start, player.loop.get().end], [30, 45]);
});

test('WEB-152: Set A here and Set B here take the play position and fill the fields and handles', async () => {
  const { root, player } = await mount();
  player.audio.currentTime = 12.34;
  fire(byText(root, 'Set A here'), 'click');
  assert.equal(inputs(root)[0].value, '0:12.3');
  assert.equal(handleA(root).hidden, false);
  assert.equal(handleA(root).getAttribute('aria-label'), 'Loop start 0:12.3');
  player.audio.currentTime = 27.5;
  fire(byText(root, 'Set B here'), 'click');
  assert.equal(inputs(root)[1].value, '0:27.5');
  assert.equal(handleB(root).getAttribute('aria-label'), 'Loop end 0:27.5');
  assert.equal(handleB(root).getAttribute('role'), 'slider');
  assert.equal(one(root, '.stu-toggle').disabled, false);
  assert.equal(one(root, '.stu-hint').textContent, '');
});

test('WEB-152: the numeric fields take m:ss.s and refuse anything else inline', async () => {
  const { root, player } = await mount();
  typeTime(inputs(root)[0], '2:03.5');
  assert.equal(player.loop.get().start, 123.5);
  typeTime(inputs(root)[1], '3:00');
  assert.equal(player.loop.get().end, 180);
  typeTime(inputs(root)[1], 'soon');
  assert.equal(inputs(root)[1].getAttribute('aria-invalid'), 'true');
  assert.equal(one(root, '.stu-note').textContent, TIME_HINT);
  assert.equal(player.loop.get().end, 180, 'the mark is unchanged');
});

test('WEB-152: the nudge buttons move a mark by 0.1 s and 1 s and are off until the mark exists', async () => {
  const { root, player } = await mount();
  assert.equal(byLabel(root, 'Loop start later by 0.1 s').disabled, true);
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:30');
  fire(byLabel(root, 'Loop start later by 0.1 s'), 'click');
  assert.equal(player.loop.get().start, 60.1);
  fire(byLabel(root, 'Loop start earlier by 1 s'), 'click');
  assert.equal(player.loop.get().start, 59.1);
  fire(byLabel(root, 'Loop end later by 1 s'), 'click');
  assert.equal(player.loop.get().end, 91);
  fire(byLabel(root, 'Loop end earlier by 0.1 s'), 'click');
  assert.equal(player.loop.get().end, 90.9);
  assert.deepEqual(all(root, '.stu-nudges').map((n) => n.querySelectorAll('button').map((b) => b.textContent)), [['-1 s', '-0.1 s', '+0.1 s', '+1 s'], ['-1 s', '-0.1 s', '+0.1 s', '+1 s']]);
});

test('WEB-152: a focused handle moves by 0.1 s with the arrows and 1 s with Shift, and keeps the key from seeking', async () => {
  const { root, player } = await mount();
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:30');
  const press = (h, key, init = {}) => { const ev = makeEvent('keydown', { key, bubbles: true, ...init }); h.dispatchEvent(ev); return ev; };
  const ev = press(handleB(root), 'ArrowRight');
  assert.equal(player.loop.get().end, 90.1);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev._stop, true, 'the global seek shortcut does not see it');
  press(handleB(root), 'ArrowLeft', { shiftKey: true });
  assert.equal(player.loop.get().end, 89.1);
  press(handleA(root), 'ArrowLeft');
  assert.equal(player.loop.get().start, 59.9);
  assert.equal(press(handleA(root), 'Tab').defaultPrevented, false);
});

test('WEB-152: dragging a handle moves its mark to the pointer, clamped against the other one', async () => {
  const { root, player } = await mount();
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:30');
  const h = handleB(root);
  fire(h, 'pointerdown', { pointerId: 1, clientX: 60 });
  fire(h, 'pointermove', { pointerId: 1, clientX: 60 });
  assert.equal(player.loop.get().end, 270, 'half way of the 120 px wave is half of 540 s');
  fire(h, 'pointermove', { pointerId: 2, clientX: 90 });
  assert.equal(player.loop.get().end, 270, 'another pointer is ignored');
  fire(h, 'pointermove', { pointerId: 1, clientX: 0 });
  assert.equal(player.loop.get().end, 60.1);
  fire(h, 'pointerup', { pointerId: 1 });
  fire(h, 'pointermove', { pointerId: 1, clientX: 100 });
  assert.equal(player.loop.get().end, 60.1, 'released');
});

test('WEB-150: a click or drag on the waveform seeks on release', async () => {
  const { root, player } = await mount();
  const c = one(root, 'canvas');
  fire(c, 'pointerdown', { pointerId: 1, clientX: 30 });
  assert.deepEqual(player.seeks, []);
  fire(c, 'pointermove', { pointerId: 1, clientX: 60 });
  fire(c, 'pointerup', { pointerId: 1 });
  assert.deepEqual(player.seeks, [270]);
});

test('PLY-160: the loop button turns the loop on, jumps to A when the playhead is outside and turns it off again', async () => {
  const { root, player } = await mount();
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:15');
  player.audio.currentTime = 10;
  const toggle = one(root, '.stu-toggle');
  fire(toggle, 'click');
  assert.equal(player.loop.get().on, true);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.match(toggle.textContent, /Loop on/);
  assert.deepEqual(player.seeks, [60]);
  player.audio.currentTime = 65;
  fire(toggle, 'click');
  assert.equal(player.loop.get().on, false);
  assert.match(toggle.textContent, /Loop off/);
  fire(toggle, 'click');
  assert.deepEqual(player.seeks, [60], 'inside the region: no jump');
});

test('WEB-153: Save loop stores the region on the song with the default names and shows it as a chip', async () => {
  const calls = [];
  const { root, player } = await mount({ patch: async (id, body) => { calls.push([id, body]); return { id, loops: body.loops }; } });
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:15');
  fire(byText(root, 'Save loop'), 'click');
  await flush();
  assert.deepEqual(calls[0], ['aaaaaaaaaaa', { loops: [{ name: 'Loop 1', start: 60, end: 75 }] }]);
  assert.deepEqual(all(root, '.stu-pick').map((c) => c.textContent), ['Loop 1 1:00.0 - 1:15.0']);
  assert.equal(one(root, '.stu-note').textContent, 'Saved as Loop 1.');
  assert.equal(one(root, '.stu-note').className.includes('ok'), true);
  assert.deepEqual(store.get('aaaaaaaaaaa').loops, [{ name: 'Loop 1', start: 60, end: 75 }]);
  typeTime(inputs(root)[1], '1:20');
  fire(byText(root, 'Save loop'), 'click');
  await flush();
  assert.deepEqual(all(root, '.stu-pick').map((c) => c.getAttribute('title')), ['Loop Loop 1', 'Loop Loop 2']);
  fire(byText(root, 'Save loop'), 'click');
  await flush();
  assert.equal(calls.length, 2, 'the same region is not saved twice');
  assert.match(one(root, '.stu-note').textContent, /Already saved as Loop 2/);
  assert.ok(player.loop.get());
});

test('WEB-153: Save loop is off until A and B are marked and when the song has 20 loops', async () => {
  const full = Array.from({ length: 20 }, (_, i) => ({ name: `L${i}`, start: i, end: i + 1 }));
  const { root } = await mount({ player: makePlayer({ ...SONG, loops: full }) });
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:15');
  assert.equal(byText(root, 'Save loop').disabled, true);
  const empty = await mount();
  assert.equal(byText(empty.root, 'Save loop').disabled, true);
});

test('WEB-153: clicking a saved loop selects its region, starts the loop at A and plays', async () => {
  const song = { ...SONG, loops: [{ name: 'Solo', start: 300, end: 315 }] };
  const { root, player } = await mount({ player: makePlayer(song) });
  fire(one(root, '.stu-pick'), 'click');
  assert.deepEqual([player.loop.get().start, player.loop.get().end, player.loop.get().on], [300, 315, true]);
  assert.deepEqual(player.seeks, [300]);
  assert.equal(player.plays, 1);
  assert.equal(one(root, '.stu-pick').getAttribute('aria-pressed'), 'true');
  assert.equal(inputs(root)[0].value, '5:00.0');
});

test('WEB-153: a saved loop is renamed in place with Enter, cancelled with Escape', async () => {
  const calls = [];
  const song = { ...SONG, loops: [{ name: 'Loop 1', start: 300, end: 315 }] };
  const { root } = await mount({ player: makePlayer(song), patch: async (id, body) => { calls.push(body); return { id, loops: body.loops }; } });
  fire(byLabel(root, 'Rename Loop 1'), 'click');
  const input = one(root, '.stu-rename');
  assert.equal(input.value, 'Loop 1');
  assert.equal(input.getAttribute('maxlength'), '40');
  input.dispatchEvent(makeEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(one(root, '.stu-rename'), null);
  assert.equal(calls.length, 0);
  fire(byLabel(root, 'Rename Loop 1'), 'click');
  const again = one(root, '.stu-rename');
  again.value = '  Solo  ';
  again.dispatchEvent(makeEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.deepEqual(calls, [{ loops: [{ name: 'Solo', start: 300, end: 315 }] }]);
  assert.equal(one(root, '.stu-pick').textContent.startsWith('Solo'), true);
  assert.equal(one(root, '.stu-note').textContent, 'Renamed.');
});

test('WEB-153: an empty name is refused inline and the loop keeps its name', async () => {
  const calls = [];
  const song = { ...SONG, loops: [{ name: 'Loop 1', start: 300, end: 315 }] };
  const { root } = await mount({ player: makePlayer(song), patch: async (id, body) => { calls.push(body); return { id, loops: body.loops }; } });
  fire(byLabel(root, 'Rename Loop 1'), 'click');
  const input = one(root, '.stu-rename');
  input.value = '   ';
  input.dispatchEvent(makeEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(one(root, '.stu-note').textContent, 'A loop needs a name.');
  assert.ok(byLabel(root, 'Rename Loop 1'));
});

test('WEB-153: Delete removes one loop and the last one removes the list', async () => {
  const calls = [];
  const song = { ...SONG, loops: [{ name: 'A', start: 1, end: 2 }, { name: 'B', start: 3, end: 4 }] };
  const { root } = await mount({ player: makePlayer(song), patch: async (id, body) => { calls.push(body); return { id, loops: body.loops }; } });
  fire(byLabel(root, 'Delete A'), 'click');
  await flush();
  assert.deepEqual(calls[0], { loops: [{ name: 'B', start: 3, end: 4 }] });
  assert.equal(one(root, '.stu-note').textContent, 'Deleted A.');
  fire(byLabel(root, 'Delete B'), 'click');
  await flush();
  assert.deepEqual(calls[1], { loops: [] });
  assert.equal(one(root, '.stu-loops').hidden, true);
  assert.equal('loops' in store.get('aaaaaaaaaaa'), false);
});

test('WEB-153: a failed save says so inline and keeps the list as it was', async () => {
  const { root } = await mount({ patch: async () => { throw new Error('Server unreachable'); } });
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:15');
  fire(byText(root, 'Save loop'), 'click');
  await flush();
  assert.equal(one(root, '.stu-note').textContent, 'Server unreachable');
  assert.equal(one(root, '.stu-note').className.includes('error'), true);
  assert.equal(all(root, '.stu-pick').length, 0);
  assert.equal(byText(root, 'Save loop').disabled, false, 'it can be tried again');
});

test('WEB-155: a guest can use the waveform and the loop but gets no save buttons, only the sign-in note', async () => {
  const { root, player } = await mount({ guest: true });
  clearGuest();
  assert.equal(byText(root, 'Save loop'), undefined);
  assert.equal(one(root, '.stu-loops'), null);
  assert.equal(one(root, '.stu-signin').textContent, SIGN_IN_NOTE);
  assert.equal(SIGN_IN_NOTE, 'Sign in to save loops');
  typeTime(inputs(root)[0], '1:00');
  typeTime(inputs(root)[1], '1:15');
  fire(one(root, '.stu-toggle'), 'click');
  assert.equal(player.loop.get().active, true);
});

test('WEB-150: a new song in the player rebuilds the page; losing the song shows the empty state; dispose lets go', async () => {
  const { root, player, dispose } = await mount();
  assert.match(one(root, '.stu-song').textContent, /Free Bird/);
  store.songs = [SONG, { ...SONG, id: 'bbbbbbbbbbb', title: 'Other' }];
  player.change({ ...SONG, id: 'bbbbbbbbbbb', title: 'Other' });
  await flush();
  assert.match(one(root, '.stu-song').textContent, /Other/);
  player.change(null);
  assert.ok(one(root, '.stu-empty'));
  player.change(SONG);
  assert.ok(one(root, '.stu-wave'));
  dispose();
  assert.equal(player.listeners.size, 0);
});
