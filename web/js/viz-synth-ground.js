import {
  WORLD_SPEED, GRID_DEPTH, NOW_Z, LANDMARK_MAX, FOG_NEAR, FOG_FAR, mulberry32, clamp01,
  makeTierPlan, resampleTier, fillLight, gridHalfWidth,
} from './viz-terrain-math.js';
import { synthCamera, viewProj, SYNTH_FOV_DEG } from './viz-synth-camera.js';
import { synthTiers, buildMesh, diagParity } from './viz-synth-mesh.js';
import { futureLayout } from './viz-synth-field.js';
import { skyColors } from './viz-synth-sky.js';
import { parseHex } from './viz-synth-settings.js';
import { countArea } from './viz-synth-fill.js';

const FILL_MODES = { none: 0, dark: 1, faces: 2 };
const RENDER_MODES = { wire: 0, filled: 1, both: 2 };
const HILLS_COLS = 96;
const HILLS_AMP = 0.07;
const GLOW_RING_PX = [0, 2.8, 4.8];
const GLOW_ALPHA = 0.12;
const RAD = Math.PI / 180;
const speedOf = (v) => (Number.isFinite(v) ? Math.min(2, Math.max(0.2, v)) : 1);

export function scrollOf(tMs, speed, reduced = false) {
  if (reduced || !Number.isFinite(tMs)) return 0;
  return (Math.max(0, tMs) / 1000) * WORLD_SPEED * speedOf(speed);
}

export function groundUniforms(scene, p, sky, signal) {
  const cam = synthCamera(scene.aspect, scene.horizonV, p.eye);
  return {
    mvp: viewProj(cam, scene.aspect),
    cam,
    lineColor: parseHex(p.lineColor),
    fillColor: parseHex(p.fillColor),
    faceColor: parseHex(p.faceColor),
    fogColor: sky.fog.slice(),
    fogNear: FOG_NEAR,
    fogFar: FOG_FAR,
    glow: clamp01(p.glow),
    edgeGlow: clamp01(p.edgeGlow),
    lineWidthPx: p.lineWidth,
    fillMode: FILL_MODES[p.fill] ?? 1,
    renderMode: RENDER_MODES[p.render] ?? 2,
    scroll: scrollOf((scene.time || 0) * 1000, p.speed, scene.reduced),
    speed: speedOf(p.speed),
    futureOpacity: clamp01(p.futureOpacity),
    futureColor: parseHex(p.lineColor),
    time: scene.time || 0,
    flash: signal ? clamp01(signal.flash) : 0,
  };
}

export function hillsPolyline(aspect, horizonV, seed, p) {
  const a = Number.isFinite(aspect) ? Math.min(4, Math.max(0.5, aspect)) : 1.78;
  const hc = 1 - 2 * horizonV;
  const amp = Number.isFinite(p?.hillsAmp) ? p.hillsAmp : HILLS_AMP;
  const rnd = mulberry32(Number.isFinite(seed) ? seed : 7);
  const octaves = [[Math.round(5 * a) + 2, 0.55], [Math.round(11 * a) + 3, 0.3], [Math.round(23 * a) + 5, 0.15]];
  const pts = octaves.map(([n]) => Float32Array.from({ length: n + 1 }, () => rnd()));
  const out = new Float32Array((HILLS_COLS + 1) * 4);
  for (let i = 0; i <= HILLS_COLS; i += 1) {
    const u = i / HILLS_COLS;
    let h = 0;
    octaves.forEach(([n, w], k) => {
      const f = u * n;
      const j = Math.min(n - 1, Math.floor(f));
      h += w * (pts[k][j] + (pts[k][j + 1] - pts[k][j]) * (f - j));
    });
    out[i * 4] = u * 2 - 1;
    out[i * 4 + 1] = hc + amp * h;
    out[i * 4 + 2] = u * 2 - 1;
    out[i * 4 + 3] = hc;
  }
  return out;
}

const GLSL_PREC = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

export const TERRAIN_VS = `
precision highp float;
attribute vec2 a_xz;
attribute float a_h;
attribute float a_l;
uniform mat4 u_mvp;
uniform vec2 u_zb;
uniform vec2 u_off;
uniform vec4 u_fog;
varying float v_h;
varying float v_l;
varying float v_fog;
void main() {
  vec3 p = vec3(a_xz.x, a_h, u_zb.x + a_xz.y * u_zb.y);
  vec4 c = u_mvp * vec4(p, 1.0);
  c.xy += u_off * c.w;
  gl_Position = c;
  v_h = a_h;
  v_l = a_l;
  float far = smoothstep(u_fog.x, u_fog.y, p.z / u_fog.z);
  float low = 1.0 - smoothstep(0.3, 2.2, a_h);
  v_fog = far * (0.35 + 0.65 * low);
}
`;

export const LINE_FS = `${GLSL_PREC}
uniform vec3 u_line;
uniform vec3 u_fogc;
uniform float u_alpha;
uniform float u_glowMode;
uniform float u_edge;
uniform float u_boost;
varying float v_h;
varying float v_l;
varying float v_fog;
void main() {
  float peak = smoothstep(0.3, 3.0, v_h);
  vec3 col = u_line * (1.0 + u_edge * peak * (0.5 + u_boost));
  if (u_glowMode > 0.5) {
    gl_FragColor = vec4(col, u_alpha * (0.35 + 1.4 * u_edge * peak) * (1.0 - v_fog));
  } else {
    gl_FragColor = vec4(mix(col, u_fogc, v_fog), u_alpha);
  }
}
`;

export const FACE_FS = `${GLSL_PREC}
uniform vec3 u_fill;
uniform vec3 u_face;
uniform vec3 u_fogc;
uniform float u_fillMode;
varying float v_h;
varying float v_l;
varying float v_fog;
void main() {
  vec3 col = u_fill;
  if (u_fillMode > 1.5) {
    float shade = 0.5 + 0.5 * clamp(v_l, -1.0, 1.0);
    col = mix(u_fill, u_face, clamp(0.25 + 0.9 * shade, 0.0, 1.0));
  }
  gl_FragColor = vec4(mix(col, u_fogc, v_fog), 1.0);
}
`;

export const FLOOR_FS = `${GLSL_PREC}
uniform vec2 u_res;
uniform vec3 u_fill;
uniform vec3 u_fogc;
uniform vec4 u_geo;
uniform vec4 u_fog;
void main() {
  float ndcY = (gl_FragCoord.y / u_res.y) * 2.0 - 1.0;
  float dep = u_geo.y - atan(ndcY * u_geo.z);
  float z = u_geo.x / max(tan(dep), 0.0005);
  float far = smoothstep(u_fog.x, u_fog.y, z / u_fog.z);
  gl_FragColor = vec4(mix(u_fill, u_fogc, far), 1.0);
}
`;

export const QUAD_VS = `
attribute vec2 a_pos;
uniform float u_hc;
uniform float u_hh;
varying float v_t;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_t = 1.0 - clamp((a_pos.y - u_hc) / max(u_hh, 0.0001), 0.0, 1.0);
}
`;

export const HILLS_FS = `${GLSL_PREC}
uniform vec3 u_col;
uniform vec3 u_fogc;
varying float v_t;
void main() {
  gl_FragColor = vec4(mix(u_col, u_fogc, 0.35 * v_t), 1.0);
}
`;

export const FUTURE_VS = `
precision highp float;
attribute vec2 a_f;
uniform mat4 u_mvp;
uniform float u_z;
void main() {
  gl_Position = u_mvp * vec4(a_f.x, a_f.y, u_z, 1.0);
}
`;

export const FUTURE_FS = `${GLSL_PREC}
uniform vec3 u_col;
uniform float u_alpha;
void main() {
  gl_FragColor = vec4(u_col, u_alpha);
}
`;

const fract01 = (v) => {
  const f = v - Math.floor(v);
  return Math.max(0, f);
};

function cell(p, name) {
  let c = p.vals.get(name);
  if (!c) { c = [Number.NaN, Number.NaN, Number.NaN, Number.NaN]; p.vals.set(name, c); }
  return c;
}

function keyOf(scene, p) {
  const cellMul = scene.q?.cellMul || 1;
  return `${(p.cell * cellMul).toFixed(4)}|${scene.aspect.toFixed(4)}|${cellMul > 1 ? 0 : 2}|${p.grid}`;
}

export function createGroundPass(gl, deps) {
  const link = deps.linkProgram;
  const stats = { tiers: 0, vertices: 0, draws: 0, uploads: 0, builds: 0 };
  let dpr = 1;
  let progs = null;
  let quadBuf = null;
  let hillBuf = null;
  let hillN = 0;
  let hillKey = '';
  let hillTop = HILLS_AMP;
  let floorKey = '';
  let tiers = [];
  let tierKey = '';
  let sil = null;
  let pending = null;
  let stale = false;

  function loc(p, name) {
    if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(p.prog, name));
    return p.locs.get(name);
  }
  function setN(p, name, a, b, c, d, n) {
    const v = cell(p, name);
    if (v[0] === a && v[1] === b && v[2] === c && v[3] === d) return;
    v[0] = a; v[1] = b; v[2] = c; v[3] = d;
    const l = loc(p, name);
    if (n === 1) gl.uniform1f(l, a);
    else if (n === 2) gl.uniform2f(l, a, b);
    else if (n === 3) gl.uniform3f(l, a, b, c);
    else gl.uniform4f(l, a, b, c, d);
  }
  const set1 = (p, name, a) => setN(p, name, a, 0, 0, 0, 1);
  const set2 = (p, name, a, b) => setN(p, name, a, b, 0, 0, 2);
  const set3 = (p, name, v) => setN(p, name, v[0], v[1], v[2], 0, 3);
  const set4 = (p, name, a, b, c, d) => setN(p, name, a, b, c, d, 4);
  function setMat(p, name, m) {
    let same = p.matSig !== undefined;
    if (same) for (let i = 0; i < 16; i += 1) if (p.matSig[i] !== m[i]) { same = false; break; }
    if (same) return;
    p.matSig = Float32Array.from(m);
    gl.uniformMatrix4fv(loc(p, name), false, m);
  }

  function build() {
    progs = {
      line: link(gl, TERRAIN_VS, LINE_FS, ['a_xz', 'a_h', 'a_l']),
      face: link(gl, TERRAIN_VS, FACE_FS, ['a_xz', 'a_h', 'a_l']),
      floor: link(gl, QUAD_VS, FLOOR_FS, ['a_pos']),
      hills: link(gl, QUAD_VS, HILLS_FS, ['a_pos']),
      future: link(gl, FUTURE_VS, FUTURE_FS, ['a_f']),
    };
    quadBuf = gl.createBuffer();
    hillBuf = gl.createBuffer();
    hillKey = '';
    floorKey = '';
    tierKey = '';
    tiers = [];
    sil = { buf: gl.createBuffer(), lineIdx: gl.createBuffer(), cols: 0, n: 0, top: null, z: 0 };
    stats.builds += 1;
  }

  function freeTiers() {
    for (const t of tiers) {
      for (const k of ['xzBuf', 'hBuf', 'lBuf', 'lineBuf', 'triBuf', 'lineBuf1', 'triBuf1']) gl.deleteBuffer(t[k]);
    }
    tiers = [];
  }

  function release() {
    if (!progs) return;
    freeTiers();
    for (const k of Object.keys(progs)) gl.deleteProgram(progs[k].prog);
    for (const b of [quadBuf, hillBuf, sil.buf, sil.lineIdx]) gl.deleteBuffer(b);
    progs = null;
    sil = null;
  }

  function ensureTiers(scene, p) {
    const key = keyOf(scene, p);
    if (key === tierKey) return;
    const cellMul = scene.q?.cellMul || 1;
    const level = cellMul > 1 ? 0 : 2;
    const cell0 = p.cell * cellMul;
    freeTiers();
    tierKey = key;
    const make = (target, data, usage) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, usage);
      return b;
    };
    tiers = synthTiers({ cell: cell0 }, level, scene.aspect, NOW_Z).map((tier) => {
      const mesh = buildMesh(tier, p.grid);
      const alt = p.grid === 'triangle' ? buildMesh(tier, p.grid, 1) : null;
      return {
        tier,
        mesh,
        xzBuf: make(gl.ARRAY_BUFFER, mesh.xz, gl.STATIC_DRAW),
        hBuf: make(gl.ARRAY_BUFFER, mesh.vertices * 4, gl.DYNAMIC_DRAW),
        lBuf: make(gl.ARRAY_BUFFER, mesh.vertices * 4, gl.DYNAMIC_DRAW),
        lineBuf: make(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW),
        triBuf: make(gl.ELEMENT_ARRAY_BUFFER, mesh.tris, gl.STATIC_DRAW),
        lineBuf1: alt ? make(gl.ELEMENT_ARRAY_BUFFER, alt.lines, gl.STATIC_DRAW) : null,
        triBuf1: alt ? make(gl.ELEMENT_ARRAY_BUFFER, alt.tris, gl.STATIC_DRAW) : null,
        parity: 0,
        heights: new Float32Array(mesh.vertices),
        light: new Float32Array(mesh.vertices),
        plan: null,
        zBase: NOW_Z,
        lit: false,
      };
    });
    stats.tiers = tiers.length;
    stats.vertices = tiers.reduce((s, t) => s + t.mesh.vertices, 0);
  }

  function setHeights(st, scrollRows) {
    if (typeof scrollRows === 'number' && st.data) {
      const base = Math.floor(scrollRows);
      pending = {
        heights: st.data, future: st.future, futureRows: st.future ? Math.floor(st.future.length / st.cols) : 0, rows: st.rows, cols: st.cols, dz: st.dz, base, frac: scrollRows - base,
      };
    } else pending = st;
    stale = true;
  }

  function upload(scene, params) {
    const st = pending;
    stale = false;
    const p = params.terrain;
    ensureTiers(scene, p);
    const lat = {
      rows: st.rows, cols: st.cols, dz: st.dz, hw: gridHalfWidth(scene.aspect), data: st.heights,
      future: st.future ? st.future.subarray(0, st.futureRows * st.cols) : null,
    };
    const scrollRows = st.base + st.frac;
    const lit = p.fill === 'faces' && p.render !== 'wire';
    const speed = speedOf(p.speed);
    const fracL = fract01(scrollRows);
    for (const t of tiers) {
      const { tier } = t;
      const lc = t.plan?.lat;
      if (!lc || lc.rows !== lat.rows || lc.cols !== lat.cols || lc.hw !== lat.hw || lc.dz !== lat.dz) t.plan = makeTierPlan(lat, tier, NOW_Z);
      else t.plan.lat = lat;
      const fracT = fract01((scrollRows * lat.dz) / tier.dz);
      resampleTier(t.plan, lat.data, t.heights, fracL, fracT, 0, LANDMARK_MAX);
      t.parity = diagParity(scrollRows, lat.dz, tier.dz);
      t.zBase = NOW_Z - fracT * tier.dz * speed;
      gl.bindBuffer(gl.ARRAY_BUFFER, t.hBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, t.heights);
      stats.uploads += 1;
      t.lit = lit;
      if (lit) {
        fillLight(t.heights, tier.rows, tier.cols, tier.hw, tier.dz, t.light, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, t.lBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, t.light);
        stats.uploads += 1;
      }
    }
    updateSilhouette(lat, p);
  }

  function updateSilhouette(lat, p) {
    sil.n = 0;
    if (!p.future || !lat.future) return;
    const cols = lat.cols;
    const rows = Math.min(futureLayout(lat.rows, p).n, Math.floor(lat.future.length / cols));
    if (!rows) return;
    if (!sil.top || sil.cols !== cols) {
      sil.cols = cols;
      sil.top = new Float32Array(cols * 4);
      const idx = new Uint16Array(cols);
      for (let i = 0; i < cols; i += 1) idx[i] = i * 2;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sil.lineIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    }
    for (let c = 0; c < cols; c += 1) {
      let m = 0;
      for (let r = 0; r < rows; r += 1) m = Math.max(m, lat.future[r * cols + c]);
      const x = (cols <= 1 ? 0 : (c / (cols - 1)) * 2 - 1) * lat.hw;
      sil.top[c * 4] = x;
      sil.top[c * 4 + 1] = m;
      sil.top[c * 4 + 2] = x;
      sil.top[c * 4 + 3] = 0;
    }
    sil.n = cols;
    sil.z = Math.min(GRID_DEPTH, NOW_Z + p.futureDist * GRID_DEPTH);
    gl.bindBuffer(gl.ARRAY_BUFFER, sil.buf);
    gl.bufferData(gl.ARRAY_BUFFER, sil.top, gl.DYNAMIC_DRAW);
    stats.uploads += 1;
  }

  const uniformsOf = (scene, params, signal) => groundUniforms(scene, params.terrain, skyColors(params.sky, params.sun), signal);

  function attribs(n) {
    for (let i = 0; i < 3; i += 1) {
      if (i < n) gl.enableVertexAttribArray(i);
      else gl.disableVertexAttribArray(i);
    }
  }

  function bindTier(t, withLight) {
    gl.bindBuffer(gl.ARRAY_BUFFER, t.xzBuf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, t.hBuf);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    if (withLight && t.lit) {
      gl.bindBuffer(gl.ARRAY_BUFFER, t.lBuf);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(2);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib1f(2, 0);
    }
  }

  function tierUniforms(prog, t, u, farZ) {
    set2(prog, 'u_zb', t.zBase, u.speed);
    set4(prog, 'u_fog', u.fogNear, u.fogFar, farZ, 0);
    setMat(prog, 'u_mvp', u.mvp);
  }

  const farOf = (u) => NOW_Z + (GRID_DEPTH - NOW_Z) * u.speed;

  function drawFloor(scene, params, signal) {
    if (!progs) return;
    const u = uniformsOf(scene, params, signal);
    const p = progs.floor;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    const hc = 1 - 2 * scene.horizonV;
    const key = hc.toFixed(5);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    if (key !== floorKey) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, hc, 1, hc, -1, -1, 1, -1]), gl.DYNAMIC_DRAW);
      floorKey = key;
      stats.uploads += 1;
    }
    attribs(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    set2(p, 'u_res', scene.res[0], scene.res[1]);
    set3(p, 'u_fill', u.fillColor);
    set3(p, 'u_fogc', u.fogColor);
    set4(p, 'u_geo', u.cam.eye[1], -u.cam.pitchDeg * RAD, Math.tan((SYNTH_FOV_DEG * RAD) / 2), 0);
    set4(p, 'u_fog', u.fogNear, u.fogFar, farOf(u), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    countArea(scene, scene.res[0] * scene.res[1] * (1 - scene.horizonV));
    stats.draws += 1;
  }

  function drawHills(scene, params, signal) {
    if (!progs || !params.terrain.hills) return;
    const u = uniformsOf(scene, params, signal);
    const key = `${scene.aspect.toFixed(3)}|${scene.horizonV.toFixed(5)}|${params.sky.starSeed}`;
    const p = progs.hills;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, hillBuf);
    if (key !== hillKey) {
      const poly = hillsPolyline(scene.aspect, scene.horizonV, params.sky.starSeed, params.terrain);
      gl.bufferData(gl.ARRAY_BUFFER, poly, gl.DYNAMIC_DRAW);
      hillN = poly.length / 2;
      hillTop = 0;
      for (let i = 1; i < poly.length; i += 4) hillTop = Math.max(hillTop, poly[i] - poly[i + 2]);
      hillKey = key;
      stats.uploads += 1;
    }
    attribs(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    set1(p, 'u_hc', 1 - 2 * scene.horizonV);
    set1(p, 'u_hh', hillTop);
    set3(p, 'u_col', parseHex(params.terrain.hillsColor));
    set3(p, 'u_fogc', u.fogColor);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, hillN);
    countArea(scene, scene.res[0] * scene.res[1] * hillTop * 0.5);
    stats.draws += 1;
  }

  function drawFaces(scene, u, farZ) {
    countArea(scene, scene.res[0] * scene.res[1] * (1 - scene.horizonV));
    const p = progs.face;
    gl.useProgram(p.prog);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    if (u.renderMode === 0) gl.colorMask(false, false, false, false);
    set3(p, 'u_fill', u.fillColor);
    set3(p, 'u_face', u.faceColor);
    set3(p, 'u_fogc', u.fogColor);
    set1(p, 'u_fillMode', u.fillMode);
    set2(p, 'u_off', 0, 0);
    for (const t of tiers) {
      bindTier(t, true);
      tierUniforms(p, t, u, farZ);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, t.parity && t.triBuf1 ? t.triBuf1 : t.triBuf);
      gl.drawElements(gl.TRIANGLES, t.mesh.triCount * 3, gl.UNSIGNED_SHORT, 0);
      stats.draws += 1;
    }
    gl.colorMask(true, true, true, true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  function drawLines(scene, u, farZ) {
    const p = progs.line;
    const ratio = scene.dpr || dpr;
    gl.useProgram(p.prog);
    gl.depthMask(false);
    set3(p, 'u_line', u.lineColor);
    set3(p, 'u_fogc', u.fogColor);
    set1(p, 'u_edge', u.edgeGlow);
    set1(p, 'u_boost', 0.25 * u.flash);
    const ox = 2 / scene.res[0];
    const oy = 2 / scene.res[1];
    const pass = (dx, dy, alpha, glowMode) => {
      set1(p, 'u_glowMode', glowMode);
      set1(p, 'u_alpha', alpha);
      set2(p, 'u_off', dx * ox, dy * oy);
      for (const t of tiers) {
        bindTier(t, false);
        tierUniforms(p, t, u, farZ);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, t.parity && t.lineBuf1 ? t.lineBuf1 : t.lineBuf);
        gl.drawElements(gl.LINES, t.mesh.lineCount * 2, gl.UNSIGNED_SHORT, 0);
        stats.draws += 1;
      }
    };
    const wpx = Math.min(3, Math.max(0.5, u.lineWidthPx));
    let n = 3;
    if (wpx <= 1.5) n = 1;
    else if (wpx <= 2.4) n = 2;
    const step = n > 1 ? ((wpx - 1) * ratio) / (n - 1) : 0;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (let k = 0; k < n; k += 1) {
      const o = (k - (n - 1) / 2) * step;
      pass(o, o, Math.min(1, wpx), 0);
    }
    const rings = Math.min(2, Math.max(0, scene.q?.glowPasses ?? 2));
    const taps = scene.q?.glowTaps ?? 4;
    if (u.glow > 0 && rings > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      for (let i = 1; i <= rings; i += 1) {
        const r = GLOW_RING_PX[i] * ratio;
        const a = (u.glow * GLOW_ALPHA) / i;
        pass(r, r, a, 1);
        pass(-r, -r, a, 1);
        if (taps > 2) {
          pass(r, -r, a, 1);
          pass(-r, r, a, 1);
        }
      }
    }
    gl.disable(gl.BLEND);
  }

  function drawFuture(pp, u) {
    const p = progs.future;
    gl.useProgram(p.prog);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, sil.buf);
    attribs(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    setMat(p, 'u_mvp', u.mvp);
    set1(p, 'u_z', NOW_Z + (sil.z - NOW_Z) * u.speed);
    set3(p, 'u_col', u.futureColor);
    if (pp.futureStyle === 'fill') {
      set1(p, 'u_alpha', u.futureOpacity * 0.5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, sil.n * 2);
    } else {
      set1(p, 'u_alpha', u.futureOpacity);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sil.lineIdx);
      gl.drawElements(gl.LINE_STRIP, sil.n, gl.UNSIGNED_SHORT, 0);
    }
    stats.draws += 1;
    gl.disable(gl.BLEND);
  }

  function drawTerrain(scene, params, signal) {
    if (!progs || !pending) return;
    if (stale || !tiers.length || keyOf(scene, params.terrain) !== tierKey) upload(scene, params);
    const pp = params.terrain;
    const u = uniformsOf(scene, params, signal);
    const farZ = farOf(u);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    attribs(2);
    if (u.fillMode !== 0) drawFaces(scene, u, farZ);
    if (u.renderMode !== 1 || u.fillMode === 0) drawLines(scene, u, farZ);
    if (pp.future && sil.n && u.futureOpacity > 0) drawFuture(pp, u);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    attribs(0);
  }

  build();

  return {
    draw: drawTerrain,
    drawHills,
    drawFloor,
    drawTerrain,
    setHeights,
    resize(w, h, d) { dpr = d || 1; },
    rebuild() { progs = null; build(); },
    dispose() { release(); },
    stats,
  };
}
