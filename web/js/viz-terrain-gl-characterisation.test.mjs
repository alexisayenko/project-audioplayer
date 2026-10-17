import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTerrain } from './viz-terrain-gl.js';
import { setStyle, TERRAIN_STYLES, resetStyleForTests } from './viz-terrain-style.js';
import { markRows } from './viz-terrain-math.js';

const GOLDEN = {
  'relief/live': 'd0ac978dc9bf35c644a30fbf2cc68994ddfda1285fab00e526c6fd77fe4a216a',
  'relief/static': '50990e11b2f66c196d7b1e4a0d39a2a8af2e1c32ed6edb08b7ebaea2ef49ee93',
  'relief/ahead': 'f0a6a8f8eb27325c246214b162faa8dd88195193e0d932be71799fc62e072cf5',
  'relief/partial': '7eec6787e4ad3a97ad8e6b6fbe1d64d884c59b7ffe4d1c01299b1a9e2606e3fc',
  'relief/noparts': '7c62af520245fa0fd6e18006658d5f9cd3268b9bbbdf89e91d9250cfaa9406c5',
  'single/live': 'e74aeea12604475c69e98142212cdbddfe64385cab2d098ba7559755be3daed0',
  'single/static': '163ff7b5cc8522307218b4b806742336210772a6b2b4228788e52c64fae63223',
  'single/ahead': '194ba6c9cefe68cbdb12710b72a10c23ba9003bad6155655be52cf30656e9321',
  'single/partial': '14c8d427674cffe3235f48e74e3b9f0b532bd42d24ed3d6c70a751adcc24702d',
  'single/noparts': '2b5260ff67b0d74933f5ff56abbb3182a6f7618f84c18fa0751f042566e68650',
  'hill/live': '85a263cfd14b440c1118ab59852ce632ddc892dd63d8d6b13eb8c3adf6113efc',
  'hill/static': '2e8188fbb48557bc24977e5c3c37056099baf5ee0a9c0f06502bf9293959ff7e',
  'hill/ahead': 'bc9294d4b3c89dc7c63ab28b6776dbc068206188a114accd0cf3ad998bf9a1cf',
  'hill/partial': 'd317bc41ec904eb2fa264d0e71c308b31151e27b65d969d5e273a6b0859ab0b3',
  'hill/noparts': '368b34e0da45e2837b829dbbafb9cb12bfd4979be1f615ff956e7e8a69756a9d',
  'multi/live': '9a6624273d548c6eb887ebb828665ca38a9ea8029a95c547e2e2e767fbf912cc',
  'multi/static': '0ca91ee6c793a6e315bd1480a88f273c82ba0529d92d0ee7eb32959d7e9c4b27',
  'multi/ahead': '3b544df1a595101c04a4fbb1715c5c0521bee7e8fdd94db8263588cd6737da1d',
  'multi/partial': 'f6c7fbde98af9d66f1bb5bb5951b4257d470735caf5619f2c47df8cee88be478',
  'multi/noparts': '6dfee0ba489ab88e4906a910280bb1570505dd3a269067138408143270e0e9d4',
  'full/live': 'd64c6a76c52f6b6fb9e2de71386d52eebb83c9612e3966bda17eedc867b738df',
  'full/static': 'ecfe9d47116f086198980704d670bab6ff15c0a5de9bf948ed8a75ada462146d',
  'full/ahead': 'b1bc7e8e8bcc4ff8205f0184cb989e712f87b1b3be71ea4bf4eb9faf67ca07a3',
  'full/partial': '4b31c7e38abe83ca16c73bfec9d3b7522e1e92747a23340ba94b2698f572fe30',
  'full/noparts': '19833d09f1692d9313479f1282aa170044d7c4a7a429364f7cd33e7962b709f8',
  'lava/live': 'e05caed64ee96727cc36474b12305adb2c00c06bc56936f178f0e415152ab704',
  'lava/static': '8e8467df57b56b96665845132a98c84a394149301d106ab483dd3e16ac3108bc',
  'lava/ahead': 'b66d982d755bc800e0bc523d551c06d5e0091e2fb2e04db4c41432911a79b3fb',
  'lava/partial': '08438a448fc34c0ba214aa190649170807315b0133bed30133d3e8b5529ef2c2',
  'lava/noparts': '01d9038def0d38345b1be3f5222bfbccc8be80268c7f642f6a1f12d1a121e2b9',
  'melody/live': 'beb51a5cc31459c39a95e2d1befe5f4713d864d9e462573895f5ddc4b41506f5',
  'melody/static': 'bb4fa738d2a472dc82826f8ee2d2427c455537bb5e4bbffbc888cf8391601107',
  'melody/ahead': 'f809205d3372004d1e551f54d7564d0a288c41083afff65897d8d2dbf58864b2',
  'melody/partial': 'dc03f63d1a067cc1a969d8bc9743d243342638acf292d6ab5626f5823ae6fda3',
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

const MODES = ['live', 'static', 'ahead', 'partial', 'noparts'];
const got = {};
for (const { id } of TERRAIN_STYLES) {
  for (const mode of MODES) {
    test(`characterisation ${id}/${mode}`, () => {
      const d = run(id, mode);
      got[`${id}/${mode}`] = d;
      if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${id}/${mode} ${d}`);
      else assert.equal(d, GOLDEN[`${id}/${mode}`]);
    });
  }
}

test('characterisation quality 2 with bloom', () => {
  const d = run('relief', 'ahead', 2);
  if (process.env.PRINT_GOLDEN) console.log(`GOLDEN q2 ${d}`);
  else assert.equal(d, GOLDEN['q2']);
});

test('characterisation run is repeatable', () => {
  assert.equal(run('melody', 'ahead'), run('melody', 'ahead'));
});
