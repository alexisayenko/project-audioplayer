import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const { createPlayRecorder } = await import('./play-recorder.js');
const cases = JSON.parse(fs.readFileSync(new URL('../../server/tests/fixtures/play_recorder_cases.json', import.meta.url), 'utf8'));

function fakeAudio() {
  const h = {};
  return {
    paused: true,
    currentTime: 0,
    addEventListener: (n, f) => { (h[n] ||= []).push(f); },
    removeEventListener: () => {},
    emit: (n) => (h[n] || []).forEach((f) => f()),
  };
}

function run(ops) {
  const audio = fakeAudio();
  const state = { id: 'a' };
  const rec = createPlayRecorder({
    audio,
    getSongId: () => state.id,
    post: async () => { throw Object.assign(new Error('offline'), { status: 500 }); },
    now: () => new Date('2026-10-21T10:00:00Z'),
    intervalMs: 1e9,
  });
  const tickTo = (t) => { audio.currentTime = t; audio.emit('timeupdate'); };
  for (const op of ops) {
    if (op.op === 'start') {
      state.id = op.id;
      audio.currentTime = 0;
      audio.paused = false;
      audio.emit('play');
    } else if (op.op === 'resume') {
      audio.paused = false;
      audio.emit('play');
    } else if (op.op === 'advance') {
      for (let t = audio.currentTime + op.step; t <= op.to + 1e-9; t += op.step) tickTo(t);
    } else if (op.op === 'tick') {
      tickTo(op.to);
    } else if (op.op === 'seek') {
      audio.currentTime = op.to;
      audio.emit('seeking');
      audio.emit('seeked');
      audio.emit('timeupdate');
    } else if (op.op === 'pause') {
      audio.paused = true;
      audio.emit('pause');
    } else if (op.op === 'song') {
      state.id = op.id;
      tickTo(0);
    } else if (op.op === 'end') {
      audio.emit('ended');
      audio.paused = true;
    }
  }
  const plays = rec.recentPlays().plays.map((p) => ({ song_id: p.song_id, listened_s: p.listened_s }));
  rec.destroy();
  return plays;
}

for (const c of cases) {
  test(`play recorder shared case: ${c.name}`, () => {
    mem.clear();
    assert.deepEqual(run(c.ops), c.plays);
  });
}
