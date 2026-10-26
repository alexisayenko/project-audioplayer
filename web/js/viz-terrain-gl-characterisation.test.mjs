import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTerrain } from './viz-terrain-gl.js';
import { setStyle, TERRAIN_STYLES, resetStyleForTests } from './viz-terrain-style.js';
import { markRows } from './viz-terrain-math.js';

// A golden digest pins the exact GL call stream, so any renderer change breaks it. Four style/mode
// combinations plus the quality-2 bloom path (together all five modes) are enough to catch an
// unintended change; the repeatability tests below cover every style without a digest.
const GOLDEN = {
  'relief/live': 'd0ac978dc9bf35c644a30fbf2cc68994ddfda1285fab00e526c6fd77fe4a216a',
  'multi/static': '0ca91ee6c793a6e315bd1480a88f273c82ba0529d92d0ee7eb32959d7e9c4b27',
  'lava/partial': '08438a448fc34c0ba214aa190649170807315b0133bed30133d3e8b5529ef2c2',
  'melody/noparts': 'fae8c1d744de0806dc1c032a4778f18d40c6bbf7bd3c750b86446bdb6673857b',
  'q2': '794413bafe5260908008adc541b5de3487f7485740a3c66e1ee17aae90ab73be',
};

function fakeGL() {
  const calls = [];
  const consts = new Map();
  const gl = new Proxy({}, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!consts.has(name)) consts.set(name, consts.size + 1);
        return consts.get(name);
      }
      return (...args) => {
        calls.push([name, ...args]);
        if (name.startsWith('create')) return { kind: name.slice(6) };
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'checkFramebufferStatus') return consts.get('FRAMEBUFFER_COMPLETE') ?? gl.FRAMEBUFFER_COMPLETE;
        if (name === 'getUniformLocation') return { name: args[1] };
        return undefined;
      };
    },
  });
  return gl;
}

const fakeCanvas = () => ({ width: 300, height: 150, addEventListener() {}, removeEventListener() {}, getContext: () => null });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BINS = 64;
const RPS = 16;
const SECONDS = 40;

function makeTimeline(done = RPS * SECONDS, { parts = true, pitch = true } = {}) {
  const r = rng(7);
  const total = RPS * SECONDS;
  const data = new Uint8Array(total * BINS);
  for (let i = 0; i < total; i += 1) {
    const beat = i % 8 === 0 ? 1 : 0.3;
    for (let j = 0; j < BINS; j += 1) data[i * BINS + j] = Math.floor(255 * Math.min(1, r() * 0.5 * beat * (1 - j / (BINS * 1.5)) + (i % 8 === 0 && j < 8 ? 0.5 : 0)));
  }
  const tl = { bins: BINS, rps: RPS, total, done: 0, data };
  if (parts) {
    tl.parts = new Uint8Array(total * BINS * 3).map(() => Math.floor(r() * 255));
    tl.partsDone = done;
  }
  if (pitch) {
    tl.pitch = new Uint8Array(total * 2).map(() => Math.floor(r() * 255));
    tl.pitchDone = done;
  }
  markRows(tl, 0, done);
  return tl;
}

function digest(gl, h) {
  for (const c of gl.calls) {
    for (const a of c) {
      if (ArrayBuffer.isView(a)) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      else if (typeof a === 'object' && a !== null) h.update(JSON.stringify(a));
      else h.update(String(a));
      h.update('|');
    }
    h.update('\n');
  }
  gl.calls.length = 0;
}

function spectrum(r, f) {
  const sp = new Array(BINS);
  const pulse = f % 12 < 3 ? 1 : 0.35;
  for (let i = 0; i < BINS; i += 1) sp[i] = Math.min(1, r() * pulse * (1 - i / (BINS * 1.4)));
  return sp;
}

function run(style, mode, quality = 1) {
  resetStyleForTests();
  setStyle(style);
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality });
  const h = createHash('sha256');
  const r = rng(11);
  let tl = null;
  let aheadFor = () => null;
  if (mode === 'static') {
    tl = makeTimeline();
    aheadFor = (sec) => ({ timeline: tl, time: 8 + sec * 0.0 + 0.5 * Math.floor(sec / 2) });
  } else if (mode === 'ahead') {
    tl = makeTimeline();
    aheadFor = (sec) => ({ timeline: tl, time: 6 + sec });
  } else if (mode === 'partial') {
    tl = makeTimeline(RPS * 12);
    aheadFor = (sec) => {
      if (sec > 2 && sec < 2.2) markRows(tl, tl.done, tl.done + 5);
      return { timeline: tl, time: 6 + sec, partial: sec < 3 };
    };
  } else if (mode === 'noparts') {
    tl = makeTimeline(RPS * SECONDS, { parts: false, pitch: false });
    aheadFor = (sec) => ({ timeline: tl, time: 6 + sec });
  }
  digest(gl, h);
  for (let f = 0; f < 150; f += 1) {
    const ms = 1000 + f * 33;
    t.draw(spectrum(r, f), ms, aheadFor((f * 33) / 1000), mode === 'ahead' ? 0.05 : 0);
    digest(gl, h);
  }
  t.dispose();
  return h.digest('hex');
}

for (const key of Object.keys(GOLDEN).filter((k) => k !== 'q2')) {
  test(`characterisation ${key}`, () => {
    const [id, mode] = key.split('/');
    const d = run(id, mode);
    if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${key} ${d}`);
    else assert.equal(d, GOLDEN[key]);
  });
}

test('characterisation quality 2 with bloom', () => {
  const d = run('relief', 'ahead', 2);
  if (process.env.PRINT_GOLDEN) console.log(`GOLDEN q2 ${d}`);
  else assert.equal(d, GOLDEN['q2']);
});

for (const { id } of TERRAIN_STYLES) {
  test(`characterisation ${id} is repeatable`, () => {
    assert.equal(run(id, 'ahead'), run(id, 'ahead'));
  });
}
