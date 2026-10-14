import {
  QUALITY, HISTORY_BINS, STAR_VISIBLE, buildDepthIndices, buildCrossIndices, buildRibbonVertices, buildRibbonIndices, energyOf, easeEnergy, GRID_DEPTH, WORLD_SPEED, NOW_FALLOFF_S, NOW_GAIN, CROSS_H0, CROSS_H1, AMP_MAX, SHAKE_ENABLED,
  gridHalfWidth, FAR_FLAT_START, RAMP, qualityFor, createFrame, createSeries, fillHeights, buildGridVertices, rowLayout, nowZOf, fillLiveFrame, fillLookFrame, blendFrames,
  gridCounts, makeStars, lodTiers, makeTierPlan, resampleTier, cameraAt, horizonY, horizonGlow, mat4Perspective, mat4LookAt, mat4Multiply,
  makeRowClock, clamp01, applyNowLine, addBaseRelief, NOW_LINE_GAIN_B, resample, yawStepOf, smoothHeights, HEIGHT_RESAMPLE_CAP, ROWS_PER_SECOND, gridDims, fillLight, LIGHT_GAIN, NODE_GAIN, FOG_NEAR, FOG_FAR, FOG_LOW_MIN, FOG_H0, FOG_H1,
} from './viz-terrain-math.js';
import { getCam } from './viz-cam-debug.js';
import { getStyle, isBeatStyle, isMelodyStyle } from './viz-terrain-style.js';
import {
  createPartsFrames, createLiveParts, fillLiveParts, fillTimelineParts, blendParts, melodyHeights, fillMelodyAttrs, fillLeadRidge, ACCENT_LUT,
} from './viz-melody.js';
import { fillBeatHeights, timelineBeats, createLiveBeats } from './viz-beats.js';

const DPR_CAP = 2;
const BEAT_SMOOTH_PASSES = 1;
export const TERRAIN_MAX_DPR = 1.5;
const ACC_NAMES = ['u_acc0', 'u_acc1', 'u_acc2', 'u_acc3'];
const STAR_COUNT = STAR_VISIBLE[STAR_VISIBLE.length - 1];
const STAR_SEED = 20261014;
const NEAR = 0.3;
const FAR = 160;
const BLOOM_SCALE = 0.5;
const BASS_BINS = 6;
const LOOK_BLEND_S = 1;
const SLOW_S = 1.2;
export const UPLOAD_MIN_S = 0.06;
export const strideOf = (tier) => Math.max(1, Math.ceil(UPLOAD_MIN_S / (tier.dz / WORLD_SPEED) - 1e-9));
export const padTier = (tier) => { const n = strideOf(tier); return n > 1 ? { ...tier, rows: tier.rows + n - 1 } : tier; };
const LINE_PX = [0, 1.1, 1.5];

const GRID_VS = `
precision mediump float;
attribute vec2 a_p;
attribute float a_h;
attribute float a_s;
attribute float a_l;
attribute vec3 a_m;
uniform mat4 u_vp;
uniform vec4 u_fogA;
uniform vec2 u_fogB;
uniform float u_hw, u_depth, u_dz, u_amp, u_pt, u_dpr, u_mode, u_viewW, u_viewH, u_scroll, u_nowZ, u_nowW, u_base, u_lw, u_axis, u_soft, u_cols, u_unit, u_cell, u_focal;
uniform vec4 u_tf;
uniform vec2 u_flat;
varying float v_h;
varying float v_fog;
varying float v_near;
varying float v_end;
varying float v_now;
varying float v_side;
varying float v_bead;
varying float v_dof;
varying float v_wh;
varying float v_l;
varying float v_fogH;
varying float v_tier;
varying vec3 v_m;
void main() {
  v_tier = 1.0;
  v_m = a_m;
  v_h = a_h;
  v_l = a_l;
  v_fogH = 0.0;
  v_wh = 0.0;
  v_end = 1.0;
  v_now = 0.0;
  v_side = 0.0;
  v_bead = 1.0;
  v_dof = 0.0;
  if (u_mode > 3.5) {
    gl_Position = vec4(a_p, 0.999, 1.0);
    gl_PointSize = (1.0 + a_h * 1.6) * u_dpr;
    v_fog = 0.0;
    v_near = 1.0;
    return;
  }
  float z = (a_p.y - u_scroll) * u_dz;
  float farK = 1.0 - smoothstep(u_flat.x, u_flat.y, z);
  vec3 pos = vec3(a_p.x * u_hw, a_h * u_amp * farK, -z);
  vec4 clip = u_vp * vec4(pos, 1.0);
  v_tier = smoothstep(u_tf.x, u_tf.y, z) * (1.0 - smoothstep(u_tf.z, u_tf.w, z)) * smoothstep(1.0, 3.0, u_cell * u_focal / max(clip.w, 0.1));
  float dn = (z - u_nowZ) / u_nowW;
  v_now = exp(-dn * dn);
  v_fog = smoothstep(4.0, 0.8 * u_depth, clip.w);
  v_end = 1.0 - smoothstep(0.6 * u_depth, 1.0 * u_depth, clip.w);
  v_near = smoothstep(0.4, 2.2, clip.w);
  if (u_soft > 0.5) {
    float k = mod(a_p.y + u_base, 256.0);
    float col = a_p.x * u_hw / u_unit;
    float hv = fract(sin(col * 12.9898 + k * 78.233) * 43758.5453);
    float hl = fract(sin(col * 3.7 + 1.3) * 9371.17);
    float hr = fract(sin(k * 5.3 + 2.1) * 6143.7);
    float line = u_axis < 0.5 ? hl : hr;
    v_bead = (0.5 + 0.5 * hv) * (0.7 + 0.3 * line);
    v_dof = max(smoothstep(5.0, 1.2, clip.w), smoothstep(0.35 * u_depth, 0.9 * u_depth, clip.w));
    float px = u_lw * u_dpr * (0.8 + 1.4 * v_dof) * (1.0 + 0.7 * v_now) * clamp(6.0 / max(clip.w, 0.5), 0.8, 1.9);
    v_side = a_s;
    if (u_axis < 0.5) clip.x += a_s * px * 2.0 / u_viewW * clip.w;
    else clip.y += a_s * px * 2.0 / u_viewH * clip.w;
  }
  v_wh = a_h * u_amp * farK;
  float fFar = smoothstep(u_fogA.x, u_fogA.y, clip.w / u_depth);
  float fLow = 1.0 - smoothstep(u_fogB.x, u_fogB.y, v_wh);
  v_fogH = fFar * (u_fogA.z + (1.0 - u_fogA.z) * fLow);
  gl_Position = clip;
  gl_PointSize = u_pt * u_dpr * clamp(3.5 / max(clip.w, 0.1), 0.35, 2.2) * (1.0 + 2.2 * smoothstep(0.6, 1.0, a_h)) * (1.0 + 0.8 * v_now);
}`;

const GRID_FS = `
precision mediump float;
uniform float u_mode, u_glow, u_energy, u_ab, u_soft, u_nowGain, u_crossLo, u_crossHi, u_light, u_node, u_mel;
uniform vec3 u_c0, u_c1, u_c2, u_fog, u_acc0, u_acc1, u_acc2, u_acc3;
varying float v_h;
varying float v_fog;
varying float v_near;
varying float v_end;
varying float v_now;
varying float v_side;
varying float v_bead;
varying float v_dof;
varying float v_wh;
varying float v_l;
varying float v_fogH;
varying float v_tier;
varying vec3 v_m;
vec3 ramp(float h) {
  return h < 0.45 ? mix(u_c0, u_c1, smoothstep(0.0, 0.45, h)) : mix(u_c1, u_c2, smoothstep(0.45, 1.0, h));
}
void main() {
  float a;
  vec3 col;
  if (u_mode > 3.5) {
    vec2 d = gl_PointCoord - 0.5;
    a = v_h * (1.0 - smoothstep(0.2, 0.5, length(d)));
    col = vec3(0.7, 0.85, 1.0);
  } else {
    float lum = 0.5 + 0.6 * u_energy;
    float far = 1.0 - 0.8 * v_fog;
    col = mix(vec3(0.45, 0.72, 0.95), ramp(1.0), smoothstep(0.25, 1.0, v_h));
    float low = 1.0 - smoothstep(0.04, 0.45, v_h);
    if (u_mel > 0.5) col = mix(col, vec3(0.1, 0.24, 0.55), 0.85 * low);
    if (u_mode < 0.5) {
      a = (0.3 + 0.6 * smoothstep(0.0, 0.9, v_h)) * far * lum * 1.0 * u_ab;
    } else if (u_mode < 1.5) {
      float soft = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
      a = soft * soft * (0.5 * (1.0 - 0.4 * u_energy) + 1.2 * smoothstep(0.55, 1.0, v_h)) * far * lum * u_node;
    } else {
      a = (0.3 + 0.55 * smoothstep(0.12, 0.6, v_h)) * smoothstep(u_crossLo, u_crossHi, v_wh) * far * lum * 0.7;
    }
    if (u_soft > 0.5 && u_mode != 1.0) {
      float prof = exp(-v_side * v_side * mix(3.4, 1.5, v_dof));
      a *= 1.3 * prof * v_bead * (1.0 - 0.45 * v_dof);
    }
    col = mix(col, u_fog, v_fog * 0.6) * (0.85 + 0.6 * u_glow * v_h) + vec3(0.5, 0.7, 1.0) * smoothstep(0.7, 1.0, v_h) * 0.3;
    float lf = v_l > 0.0 ? pow(v_l, 1.5) * u_light : 0.4 * v_l;
    a *= max(0.0, 1.0 + lf);
    if (u_mel > 0.5) {
      float cv = v_m.x * low;
      a *= (1.0 - 0.45 * low) + 2.2 * cv;
      col = mix(col, vec3(0.16, 0.34, 0.8), 0.5 * cv);
      a *= 1.0 + 3.0 * v_m.y;
      col = mix(col, vec3(0.92, 0.98, 1.0), 0.7 * v_m.y);
      float t3 = v_m.z * 3.0;
      vec3 ac = t3 < 1.0 ? mix(u_acc0, u_acc1, t3) : (t3 < 2.0 ? mix(u_acc1, u_acc2, t3 - 1.0) : mix(u_acc2, u_acc3, t3 - 2.0));
      float ak = smoothstep(0.02, 0.5, v_m.z) * smoothstep(0.08, 0.4, v_h);
      col = mix(col, ac, ak);
      a *= 1.0 + 0.8 * ak;
    }
    col += vec3(0.3, 0.55, 0.9) * max(lf, 0.0) * 0.35;
    col = mix(col, u_fog, v_fogH * 0.5);
    a *= 1.0 - 0.4 * v_fogH;
    float nowK = v_now * (0.45 + 0.55 * smoothstep(0.1, 0.8, v_h));
    a *= 1.0 + u_nowGain * nowK;
    col = mix(col, vec3(1.0), 0.8 * nowK);
  }
  a *= v_near * v_end * v_tier;
  gl_FragColor = vec4(col * a, a);
}`;

const QUAD_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const BG_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_horizon, u_glow, u_energy, u_time, u_aspect;
varying vec2 v_uv;
#if SMOKE_OCT > 0
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < SMOKE_OCT; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
#endif
void main() {
  vec2 uv = v_uv;
  float e = u_energy;
  float dy = uv.y - u_horizon;
  vec3 top = mix(vec3(0.003, 0.008, 0.032), vec3(0.03, 0.15, 0.3), e);
  vec3 hor = mix(vec3(0.016, 0.055, 0.14), vec3(0.28, 0.5, 0.7), e * 0.9);
  vec3 col = mix(hor, top, smoothstep(0.0, 0.75, dy));
  if (dy < 0.0) {
    vec3 gnd = mix(vec3(0.004, 0.014, 0.05), vec3(0.03, 0.18, 0.34), e);
    vec3 gndFar = mix(vec3(0.01, 0.034, 0.1), vec3(0.2, 0.42, 0.62), e);
    col = mix(gndFar, gnd, smoothstep(0.0, 0.55, -dy));
  }
  float halo = exp(-dy * dy * 40.0) * u_glow * (0.3 + 0.7 * e) * 0.55;
  col += vec3(0.2, 0.55, 0.85) * halo;
#if SMOKE_OCT > 0
  vec2 p = vec2(uv.x * u_aspect, uv.y) * vec2(1.6, 3.0);
  float m = smoothstep(0.3, 0.8, fbm(p + vec2(u_time * 0.02, 0.0)));
#if SMOKE_OCT > 2
  m = 0.6 * m + 0.6 * smoothstep(0.35, 0.85, fbm(p * 1.7 + vec2(3.1 - u_time * 0.012, 3.1)));
#endif
  float smoke = exp(-max(dy, 0.0) * 3.2) * m * (0.15 + 0.85 * e) * smoothstep(-0.08, 0.02, dy);
  col += vec3(0.5, 0.7, 0.95) * smoke * 0.65;
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

const MIST_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_horizon, u_energy, u_time, u_aspect;
varying vec2 v_uv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float dy = v_uv.y - u_horizon;
  float band = smoothstep(-0.55, 0.0, dy) * (1.0 - smoothstep(0.0, 0.32, dy));
  vec2 p = vec2(v_uv.x * u_aspect * 1.4, v_uv.y * 3.2);
  float m = vnoise(p + vec2(u_time * 0.018, -u_time * 0.012));
#if MIST_OCT > 1
  m = 0.65 * m + 0.35 * vnoise(p * 2.3 + vec2(7.3 - u_time * 0.011, u_time * 0.016 + 2.1));
#endif
  float d = band * smoothstep(0.25, 0.8, m) * (0.55 + 0.45 * u_energy);
  gl_FragColor = vec4(vec3(0.05, 0.13, 0.27) * d * 0.5, 1.0);
}`;

const POST_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform float u_gain;
varying vec2 v_uv;
void main() {
  vec4 s = texture2D(u_tex, v_uv) * 0.227;
  s += texture2D(u_tex, v_uv + u_dir * 1.38) * 0.316 + texture2D(u_tex, v_uv - u_dir * 1.38) * 0.316;
  s += texture2D(u_tex, v_uv + u_dir * 3.23) * 0.070 + texture2D(u_tex, v_uv - u_dir * 3.23) * 0.070;
  gl_FragColor = s * u_gain;
}`;

export function isWebGLAvailable(doc = globalThis.document) {
  try {
    const c = doc?.createElement?.('canvas');
    return !!(c && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

export function linkProgram(gl, vsSrc, fsSrc, attribs) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  attribs.forEach((name, i) => gl.bindAttribLocation(prog, i, name));
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link failed: ${log}`);
  }
  return { prog, locs: new Map(), vals: new Map(), mvpV: -1 };
}

function uni(gl, p, name) {
  if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(p.prog, name));
  return p.locs.get(name);
}

function setU(gl, p, name, a, b, c, d, n) {
  let cur = p.vals.get(name);
  if (!cur) { cur = [NaN, NaN, NaN, NaN]; p.vals.set(name, cur); }
  if (cur[0] === a && cur[1] === b && cur[2] === c && cur[3] === d) return;
  cur[0] = a; cur[1] = b; cur[2] = c; cur[3] = d;
  const loc = uni(gl, p, name);
  if (n === 1) gl.uniform1f(loc, a);
  else if (n === 2) gl.uniform2f(loc, a, b);
  else if (n === 3) gl.uniform3f(loc, a, b, c);
  else gl.uniform4f(loc, a, b, c, d);
}

function getContext(canvas) {
  const attrs = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power' };
  return canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
}

function makeTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, ok, w, h };
}

function freeTarget(gl, t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

function layoutSig(level, aspect, yaw = 0) {
  const d = gridDims(level, aspect);
  return `${d.rows}x${d.cols}y${yaw};${lodTiers(level, aspect, nowZOf(d.rows), yaw).map((t) => `${t.rows}x${t.cols}@${t.spacing.toFixed(4)}`).join()}`;
}

export function createTerrain(canvas, opts = {}) {
  const gl = opts.gl || getContext(canvas);
  if (!gl) return null;
  const onError = opts.onError || (() => {});
  const view = { w: canvas.width || 1, h: canvas.height || 1, dpr: 1 };
  const s = {
    level: QUALITY.indexOf(qualityFor(opts.quality ?? 1)),
    lost: false,
    disposed: false,
    res: null,
    series: createSeries(),
    liveBeats: createLiveBeats(),
    liveParts: createLiveParts(),
    melody: null,
    melodyOn: false,
    dims: null,
    tiers: [],
    beatB: null,
    liveFrame: null,
    lookFrame: null,
    lookAt: null,
    base: 0,
    heights: null,
    clock: makeRowClock(),
    scroll: 0,
    bass: 0,
    energy: 0,
    pulse: 0,
    lastT: null,
    time: 0,
    bloomOk: true,
    frameId: 0,
    ah: { timeline: null, time: 0 },
    lite: false,
    hiDpr: false,
    css: null,
    hVer: 0,
    hs: { style: null, done: -1, pd: -1, kd: -1, dims: null },
    rk: { dims: null, base: NaN, done: -1, ver: -1 },
    liveVer: 0,
    xs: null,
    static: false,
  };
  const mvp = new Float32Array(16);
  const proj = new Float32Array(16);
  const look = new Float32Array(16);

  const u1 = (p, n, a) => setU(gl, p, n, a, 0, 0, 0, 1);
  const u2 = (p, n, a, b) => setU(gl, p, n, a, b, 0, 0, 2);
  const u3 = (p, n, a, b, c) => setU(gl, p, n, a, b, c, 0, 3);
  const u4 = (p, n, a, b, c, d) => setU(gl, p, n, a, b, c, d, 4);

  function buffer(target, data, usage) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  }

  function buildTier(tier0) {
    const q = QUALITY[s.level];
    const stride = strideOf(tier0);
    const tier = padTier(tier0);
    const { rows, cols } = tier;
    const n = rows * cols;
    const depth = buildDepthIndices(rows, cols);
    const cross = buildCrossIndices(rows, cols);
    const g = {
      t: tier,
      stride,
      plan: makeTierPlan({ rows: s.dims.rows, cols: s.dims.cols, dz: s.dims.dz, hw: gridHalfWidth(view.w / view.h) }, tier, s.nowZ),
      heights: new Float32Array(n),
      light: new Float32Array(n),
      heights2: q.soft ? new Float32Array(n * 2) : null,
      light2: q.soft ? new Float32Array(n * 2) : null,
      scroll: 0,
      base: 0,
      depthCount: depth.length,
      crossCount: cross.length,
      indexType: depth instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      vertices: n,
      ribbon: null,
    };
    g.xz = buffer(gl.ARRAY_BUFFER, buildGridVertices(rows, cols), gl.STATIC_DRAW);
    g.h = buffer(gl.ARRAY_BUFFER, g.heights, gl.DYNAMIC_DRAW);
    g.l = buffer(gl.ARRAY_BUFFER, g.light, gl.DYNAMIC_DRAW);
    g.depth = buffer(gl.ELEMENT_ARRAY_BUFFER, depth, gl.STATIC_DRAW);
    g.cross = buffer(gl.ELEMENT_ARRAY_BUFFER, cross, gl.STATIC_DRAW);
    if (q.soft) {
      const rv = buildRibbonVertices(rows, cols);
      const rd = buildRibbonIndices(rows, cols, true);
      const rc = buildRibbonIndices(rows, cols, false);
      g.ribbon = {
        xz: buffer(gl.ARRAY_BUFFER, rv.xz, gl.STATIC_DRAW),
        side: buffer(gl.ARRAY_BUFFER, rv.side, gl.STATIC_DRAW),
        h: buffer(gl.ARRAY_BUFFER, g.heights2, gl.DYNAMIC_DRAW),
        l: buffer(gl.ARRAY_BUFFER, g.light2, gl.DYNAMIC_DRAW),
        depth: buffer(gl.ELEMENT_ARRAY_BUFFER, rd, gl.STATIC_DRAW),
        cross: buffer(gl.ELEMENT_ARRAY_BUFFER, rc, gl.STATIC_DRAW),
        indexType: rd instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        depthCount: rd.length,
        crossCount: rc.length,
      };
    }
    return g;
  }

  function buildGrid() {
    const q = QUALITY[s.level];
    const aspect = view.w / view.h;
    s.dims = gridDims(s.level, aspect);
    const { rows, cols } = s.dims;
    s.nowZ = nowZOf(rows);
    s.liveFrame = createFrame(rows, HISTORY_BINS);
    s.lookFrame = createFrame(rows, HISTORY_BINS);
    s.heights = new Float32Array(rows * cols);
    s.relief = new Float32Array(rows * cols);
    s.beatB = new Float32Array(rows * cols);
    s.light = new Float32Array(rows * cols);
    s.xs = new Float32Array(cols);
    s.hs.dims = null;
    s.melody = {
      live: createPartsFrames(rows, HISTORY_BINS),
      look: createPartsFrames(rows, HISTORY_BINS),
      attrs: { canvas: new Float32Array(rows * cols), spark: new Float32Array(rows * cols), accent: new Float32Array(rows * cols) },
    };
    s.yaw = yawStepOf(getCam().yaw);
    s.sig = layoutSig(s.level, aspect, s.yaw);
    s.tiers = lodTiers(s.level, aspect, s.nowZ, s.yaw).map(buildTier);
    s.res.tiers = s.tiers;
  }

  function freeTier(g) {
    for (const k of ['xz', 'h', 'l', 'depth', 'cross', 'mBuf']) if (g[k]) gl.deleteBuffer(g[k]);
    if (g.ribbon) for (const k of ['xz', 'side', 'h', 'l', 'depth', 'cross', 'm']) if (g.ribbon[k]) gl.deleteBuffer(g.ribbon[k]);
  }

  function freeGrid() {
    if (!s.res?.tiers) return;
    s.res.tiers.forEach(freeTier);
    s.res.tiers = null;
    s.tiers = [];
  }

  function buildBloom() {
    freeBloom();
    if (!QUALITY[s.level].bloom || !s.bloomOk) return;
    const w = Math.max(2, Math.round(view.w * BLOOM_SCALE));
    const h = Math.max(2, Math.round(view.h * BLOOM_SCALE));
    const a = makeTarget(gl, w, h);
    const b = makeTarget(gl, w, h);
    if (!a.ok || !b.ok) {
      freeTarget(gl, a);
      freeTarget(gl, b);
      s.bloomOk = false;
      return;
    }
    s.res.bloom = { a, b };
  }

  function freeBloom() {
    const b = s.res?.bloom;
    if (!b) return;
    freeTarget(gl, b.a);
    freeTarget(gl, b.b);
    s.res.bloom = null;
  }

  function buildBg() {
    if (s.res.bg_p) gl.deleteProgram(s.res.bg_p.prog);
    s.res.bg_p = linkProgram(gl, QUAD_VS, `#define SMOKE_OCT ${QUALITY[s.level].smoke}\n${BG_FS}`, ['a_pos']);
    if (s.res.mist_p) gl.deleteProgram(s.res.mist_p.prog);
    const oct = QUALITY[s.level].mist;
    s.res.mist_p = oct ? linkProgram(gl, QUAD_VS, `#define MIST_OCT ${oct}\n${MIST_FS}`, ['a_pos']) : null;
  }

  function init() {
    s.res = { tiers: null, bloom: null };
    s.res.grid_p = linkProgram(gl, GRID_VS, GRID_FS, ['a_p', 'a_h', 'a_s', 'a_l', 'a_m']);
    buildBg();
    s.res.post_p = linkProgram(gl, QUAD_VS, POST_FS, ['a_pos']);
    s.res.quad = buffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const stars = makeStars(STAR_SEED, STAR_COUNT);
    s.res.stars = buffer(gl.ARRAY_BUFFER, stars, gl.STATIC_DRAW);
    buildGrid();
    buildBloom();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  function freeAll() {
    if (!s.res) return;
    freeGrid();
    freeBloom();
    if (s.res.quad) gl.deleteBuffer(s.res.quad);
    if (s.res.stars) gl.deleteBuffer(s.res.stars);
    for (const k of ['grid_p', 'bg_p', 'mist_p', 'post_p']) if (s.res[k]) gl.deleteProgram(s.res[k].prog);
    s.res = null;
  }

  function attrib(i, size, stride, offset) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, stride, offset);
  }

  function drawQuadWith(p) {
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.res.quad);
    attrib(0, 2, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function setSide(buf) {
    if (buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      attrib(2, 1, 0, 0);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib1f(2, 0);
    }
  }

  function setMel(buf) {
    if (buf && s.melodyOn) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      attrib(4, 3, 0, 0);
    } else {
      gl.disableVertexAttribArray(4);
      gl.vertexAttrib3f(4, 0, 0, 0);
    }
  }

  function gridUniforms(p, mode, glow, g = s.tiers[0]) {
    const q = QUALITY[s.level];
    const t = g.t;
    gl.useProgram(p.prog);
    if (p.mvpV !== s.frameId) { gl.uniformMatrix4fv(uni(gl, p, 'u_vp'), false, mvp); p.mvpV = s.frameId; }
    u1(p, 'u_hw', t.hw);
    u1(p, 'u_dz', t.dz);
    u1(p, 'u_depth', GRID_DEPTH);
    u1(p, 'u_scroll', g.scroll);
    u1(p, 'u_nowZ', s.nowZ);
    u1(p, 'u_nowW', NOW_FALLOFF_S * WORLD_SPEED);
    u1(p, 'u_nowGain', NOW_GAIN * (0.7 + 0.6 * s.pulse) * (s.beatNow ? NOW_LINE_GAIN_B : 1));
    u1(p, 'u_crossLo', CROSS_H0);
    u1(p, 'u_crossHi', CROSS_H1);
    u1(p, 'u_base', g.base % 256);
    u1(p, 'u_cols', t.cols);
    u1(p, 'u_unit', s.tiers[0].t.spacing);
    u1(p, 'u_cell', t.spacing);
    u1(p, 'u_focal', s.focalPx || 1);
    u2(p, 'u_flat', FAR_FLAT_START * GRID_DEPTH, GRID_DEPTH);
    u4(p, 'u_tf', t.fade[0], t.fade[1], t.fade[2], t.fade[3]);
    u1(p, 'u_lw', LINE_PX[q.soft] || 0);
    u1(p, 'u_soft', q.soft ? 1 : 0);
    u1(p, 'u_axis', 0);
    u1(p, 'u_amp', AMP_MAX);
    u1(p, 'u_pt', 3);
    u1(p, 'u_light', LIGHT_GAIN);
    u1(p, 'u_node', NODE_GAIN);
    u4(p, 'u_fogA', FOG_NEAR, FOG_FAR, FOG_LOW_MIN, 0);
    u2(p, 'u_fogB', FOG_H0, FOG_H1);
    u1(p, 'u_viewW', view.w);
    u1(p, 'u_viewH', view.h);
    u1(p, 'u_energy', s.energy);
    u1(p, 'u_ab', q.soft ? 1 : 2);
    u1(p, 'u_dpr', view.dpr);
    u1(p, 'u_mode', mode);
    u1(p, 'u_glow', glow);
    u3(p, 'u_c0', ...RAMP[0].c);
    u3(p, 'u_c1', ...RAMP[1].c);
    u3(p, 'u_c2', ...RAMP[2].c);
    u3(p, 'u_fog', 0.04, 0.16, 0.31);
    u1(p, 'u_mel', s.melodyOn ? 1 : 0);
    ACCENT_LUT.forEach((c, i) => u3(p, ACC_NAMES[i], c[0], c[1], c[2]));
  }

  function drawGrid() {
    for (const g of s.tiers) drawTier(g);
  }

  function drawTier(g) {
    const p = s.res.grid_p;
    const rb = g.ribbon;
    gridUniforms(p, 0, s.bass, g);
    if (rb) {
      gl.bindBuffer(gl.ARRAY_BUFFER, rb.xz);
      attrib(0, 2, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, rb.h);
      attrib(1, 1, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, rb.l);
      attrib(3, 1, 0, 0);
      setMel(rb.m);
      setSide(rb.side);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rb.depth);
      gl.drawElements(gl.TRIANGLES, rb.depthCount, rb.indexType, 0);
      u1(p, 'u_mode', 3);
      u1(p, 'u_axis', 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rb.cross);
      gl.drawElements(gl.TRIANGLES, rb.crossCount, rb.indexType, 0);
      u1(p, 'u_axis', 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, g.xz);
    attrib(0, 2, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.h);
    attrib(1, 1, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.l);
    attrib(3, 1, 0, 0);
    setMel(g.mBuf);
    setSide(null);
    if (!rb) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.depth);
      gl.drawElements(gl.LINES, g.depthCount, g.indexType, 0);
      u1(p, 'u_mode', 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.cross);
      gl.drawElements(gl.LINES, g.crossCount, g.indexType, 0);
    }
    u1(p, 'u_mode', 1);
    gl.drawArrays(gl.POINTS, 0, g.vertices);
  }

  function drawStars() {
    const p = s.res.grid_p;
    gridUniforms(p, 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.res.stars);
    attrib(0, 2, 12, 0);
    attrib(1, 1, 12, 8);
    gl.disableVertexAttribArray(3);
    gl.vertexAttrib1f(3, 0);
    setMel(null);
    setSide(null);
    gl.drawArrays(gl.POINTS, 0, STAR_VISIBLE[s.level]);
  }

  function drawBackground(cam) {
    const p = s.res.bg_p;
    gl.useProgram(p.prog);
    s.horizon = horizonY(cam);
    u1(p, 'u_horizon', s.horizon);
    u1(p, 'u_glow', horizonGlow(s.bass));
    u1(p, 'u_energy', s.energy);
    u1(p, 'u_time', s.time);
    u1(p, 'u_aspect', view.w / view.h);
    gl.disable(gl.BLEND);
    drawQuadWith(p);
    gl.enable(gl.BLEND);
  }

  function drawMist() {
    const p = s.res.mist_p;
    if (!p) return;
    gl.useProgram(p.prog);
    u1(p, 'u_horizon', s.horizon);
    u1(p, 'u_energy', s.energy);
    u1(p, 'u_time', s.time);
    u1(p, 'u_aspect', view.w / view.h);
    drawQuadWith(p);
  }

  function blurPass(src, dst, dx, dy, gain, toScreen) {
    const p = s.res.post_p;
    gl.bindFramebuffer(gl.FRAMEBUFFER, toScreen ? null : dst.fbo);
    gl.viewport(0, 0, toScreen ? view.w : dst.w, toScreen ? view.h : dst.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.useProgram(p.prog);
    gl.uniform1i(uni(gl, p, 'u_tex'), 0);
    u2(p, 'u_dir', dx, dy);
    u1(p, 'u_gain', gain);
    if (!toScreen) gl.clear(gl.COLOR_BUFFER_BIT);
    drawQuadWith(p);
  }

  function renderBloom() {
    const { a, b } = s.res.bloom;
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.viewport(0, 0, a.w, a.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawGrid();
    blurPass(a, b, 1 / a.w, 0, 1, false);
    blurPass(b, a, 0, 1 / a.h, 1, false);
  }

  function fillBeatStyle(style, sec, ahead, k, rows, cols) {
    const dt = rowLayout(rows).dt;
    fillBeatHeights({ beats: s.liveBeats.beats, style, tNow: sec, base: Math.floor(sec / dt), rows, cols, out: s.heights });
    if (ahead?.timeline && k > 0) {
      fillBeatHeights({ beats: timelineBeats(ahead.timeline), style, tNow: ahead.time, base: Math.floor(ahead.time / dt), rows, cols, out: s.beatB });
      const h = s.heights;
      const b = s.beatB;
      for (let i = 0; i < h.length; i += 1) h[i] += (b[i] - h[i]) * k;
    }
    smoothHeights(s.heights, rows, cols, BEAT_SMOOTH_PASSES);
  }

  function fillMelodyStyle(sec, ahead, k, base, cols) {
    const m = s.melody;
    fillLiveParts(m.live, s.liveParts, sec);
    let look = null;
    if (ahead?.timeline?.parts && k > 0) {
      look = fillTimelineParts(m.look, ahead.timeline, ahead.time);
      blendParts(m.live, m.look, k);
    }
    melodyHeights(m.live.mel, m.live.can, cols, s.heights, base);
    fillMelodyAttrs(m.attrs, m.live.mel, m.live.can, m.live.oth, cols);
    if (look && ahead.timeline.pitch) fillLeadRidge(ahead.timeline, look.base, s.dims.rows, cols, s.heights, m.attrs.accent, k);
  }

  function uploadMelodyTier(g) {
    const t = g.t;
    const n = t.rows * t.cols;
    if (!g.m) {
      g.m = new Float32Array(n * 3);
      g.mt = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
      g.mBuf = buffer(gl.ARRAY_BUFFER, g.m, gl.DYNAMIC_DRAW);
      if (g.ribbon) {
        g.m2 = new Float32Array(n * 6);
        g.ribbon.m = buffer(gl.ARRAY_BUFFER, g.m2, gl.DYNAMIC_DRAW);
      }
    }
    const a = s.melody.attrs;
    const src = [a.canvas, a.spark, a.accent];
    for (let c = 0; c < 3; c += 1) resampleTier(g.plan, src[c], g.mt[c], g.fracL, g.fracT, 0, 1);
    const [c0, c1, c2] = g.mt;
    for (let i = 0; i < n; i += 1) {
      g.m[3 * i] = c0[i]; g.m[3 * i + 1] = c1[i]; g.m[3 * i + 2] = c2[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, g.mBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.m);
    if (g.ribbon) {
      const m2 = g.m2;
      for (let i = 0; i < n; i += 1) {
        for (let c = 0; c < 3; c += 1) { m2[6 * i + c] = g.m[3 * i + c]; m2[6 * i + 3 + c] = g.m[3 * i + c]; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, g.ribbon.m);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, m2);
    }
  }

  function updateHeights(sec, ahead) {
    const { rows, cols } = s.dims;
    const style = getStyle();
    const tl = ahead?.timeline;
    let k = 0;
    if (tl) {
      if (s.lookAt === null) s.lookAt = sec;
      k = clamp01((sec - s.lookAt) / LOOK_BLEND_S);
    } else s.lookAt = null;
    const lay = rowLayout(rows);
    const eligible = !!tl && k >= 1 && !isBeatStyle(style) && (style !== 'melody' || !!tl.parts);
    s.static = eligible;
    if (s.static) {
      const at = ahead.time;
      const hs = s.hs;
      const done = tl.done;
      const same = hs.style === style && hs.done === done && hs.pd === (tl.partsDone ?? 0) && hs.kd === (tl.pitchDone ?? 0) && hs.dims === s.dims;
      if (same) {
        let due = false;
        for (const g of s.tiers) if (g.upVer !== s.hVer || g.upBase !== tierBase(g, at)) due = true;
        if (!due) {
          for (const g of s.tiers) uploadTier(g, at, 0);
          return;
        }
      } else {
        hs.style = style; hs.done = done; hs.pd = tl.partsDone ?? 0; hs.kd = tl.pitchDone ?? 0; hs.dims = s.dims;
        s.hVer += 1;
      }
    }
    let info = fillLiveFrame(s.liveFrame, s.series, sec);
    if (tl) {
      const li = fillLookFrame(s.lookFrame, tl, ahead.time);
      blendFrames(s.liveFrame, s.lookFrame, k);
      info = { base: k >= 1 ? li.base : info.base, frac: info.frac + (li.frac - info.frac) * k };
    }
    s.melodyOn = isMelodyStyle(style);
    s.beatNow = isBeatStyle(style);
    if (s.melodyOn) fillMelodyStyle(sec, ahead, k, info.base, cols);
    else if (isBeatStyle(style)) {
      fillBeatStyle(style, sec, ahead, k, rows, cols);
      const rk = s.rk;
      const settled = !tl || k >= 1;
      const done = tl ? tl.done : -1;
      if (!settled || rk.dims !== s.dims || rk.base !== info.base || rk.done !== done || rk.ver !== s.liveVer) {
        fillHeights(s.liveFrame, cols, sec, s.relief, { swellAmp: 0, bakeAmp: true, landmarks: false });
        rk.dims = s.dims; rk.base = info.base; rk.done = done; rk.ver = s.liveVer;
      }
      addBaseRelief(s.heights, s.relief);
      applyNowLine(s.heights, rows, cols, info.frac);
    }
    else fillHeights(s.liveFrame, cols, sec, s.heights, { swellAmp: 0, bakeAmp: true });
    fillLight(s.heights, rows, cols, gridHalfWidth(view.w / view.h), lay.dz, s.light, undefined, s.xs);
    const pos = (info.base + info.frac) * lay.dt;
    for (const g of s.tiers) uploadTier(g, pos, info.frac);
  }

  function tierBase(g, pos) {
    const p = pos / (g.t.dz / WORLD_SPEED);
    return s.static && g.stride > 1 ? Math.floor(p / g.stride) * g.stride : Math.floor(p);
  }

  function uploadTier(g, pos, fracL) {
    const t = g.t;
    const p = pos / (t.dz / WORLD_SPEED);
    const base = tierBase(g, pos);
    const fracT = p - base;
    g.base = base;
    g.scroll = fracT - t.jz0 - s.nowZ / t.dz;
    if (s.static && g.upVer === s.hVer && g.upBase === base) return;
    g.upVer = s.hVer;
    g.upBase = base;
    resampleTier(g.plan, s.heights, g.heights, fracL, fracT, 0, HEIGHT_RESAMPLE_CAP);
    resampleTier(g.plan, s.light, g.light, fracL, fracT, -1, 1);
    g.fracL = fracL;
    g.fracT = fracT;
    if (s.melodyOn) uploadMelodyTier(g);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.h);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.heights);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.l);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.light);
    const rb = g.ribbon;
    if (!rb) return;
    const h = g.heights;
    const h2 = g.heights2;
    const l = g.light;
    const l2 = g.light2;
    for (let i = 0; i < h.length; i += 1) { h2[2 * i] = h[i]; h2[2 * i + 1] = h[i]; l2[2 * i] = l[i]; l2[2 * i + 1] = l[i]; }
    gl.bindBuffer(gl.ARRAY_BUFFER, rb.h);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, h2);
    gl.bindBuffer(gl.ARRAY_BUFFER, rb.l);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, l2);
  }

  function draw(spectrum, t = 0, aheadIn = null, latS = 0) {
    if (s.lost || s.disposed || !s.res) return;
    const lat = Number.isFinite(latS) ? latS : 0;
    let ahead = aheadIn;
    if (aheadIn?.timeline) {
      s.ah.timeline = aheadIn.timeline;
      s.ah.time = aheadIn.time - lat;
      ahead = s.ah;
    }
    const sp = spectrum || [];
    const step = s.clock.advance(t);
    s.liveVer += step.pushes;
    const gap = 1000 / ROWS_PER_SECOND;
    for (let i = 0; i < step.pushes; i += 1) {
      const ts = (t - (step.pushes - 1 - i) * gap) / 1000;
      s.series.push(sp, ts);
      s.liveBeats.push(resample(sp, HISTORY_BINS), ts);
      if (isMelodyStyle(getStyle())) s.liveParts.push(resample(sp, HISTORY_BINS), ts);
    }
    let bass = 0;
    const n = Math.min(BASS_BINS, sp.length);
    for (let i = 0; i < n; i += 1) bass += clamp01(sp[i]);
    const dtS = s.lastT === null ? 1 : Math.max(0, Math.min(0.5, (t - s.lastT) / 1000));
    const slow = 1 - Math.exp(-dtS / SLOW_S);
    const rawEnergy = energyOf(sp);
    s.bass += ((n ? bass / n : 0) - s.bass) * slow;
    s.energy += (rawEnergy - s.energy) * slow;
    s.pulse = easeEnergy(s.pulse, rawEnergy, dtS);
    s.lastT = t;
    s.time = (t / 1000) % 600;
    const cc = getCam();
    if (yawStepOf(cc.yaw) !== s.yaw) { freeGrid(); buildGrid(); s.clock.reset(); }
    s.frameId += 1;
    updateHeights(t / 1000 - lat, ahead);
    const cam = cameraAt(t / 1000, SHAKE_ENABLED ? s.pulse : 0, { eye: cc.eye, pitchDeg: cc.pitch, yawDeg: cc.yaw, fly: 0 });
    s.focalPx = view.h / (2 * Math.tan(cam.fov / 2));
    mat4Perspective(cam.fov, view.w / view.h, NEAR, FAR, proj);
    mat4LookAt(cam.eye, cam.target, cam.up, look);
    mat4Multiply(proj, look, mvp);
    if (s.res.bloom && !s.lite) renderBloom();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w, view.h);
    drawBackground(cam);
    drawStars();
    drawGrid();
    if (!s.lite) drawMist();
    if (s.res.bloom && !s.lite) {
      gl.viewport(0, 0, view.w, view.h);
      blurPass(s.res.bloom.a, null, 0, 0, 0.9, true);
    }
  }

  function resize(w, h, dpr = 1) {
    s.css = { w, h, dpr };
    view.dpr = Math.min(s.hiDpr ? DPR_CAP : TERRAIN_MAX_DPR, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
    view.w = Math.max(1, Math.round(w * view.dpr));
    view.h = Math.max(1, Math.round(h * view.dpr));
    canvas.width = view.w;
    canvas.height = view.h;
    if (s.res && !s.lost) {
      buildBloom();
      if (s.dims && layoutSig(s.level, view.w / view.h, s.yaw) !== s.sig) { freeGrid(); buildGrid(); s.clock.reset(); }
    }
  }

  function setDprCap(hi) {
    const on = !!hi;
    if (on === s.hiDpr) return;
    s.hiDpr = on;
    if (s.css) resize(s.css.w, s.css.h, s.css.dpr);
  }

  function setLite(on) { s.lite = !!on; }

  function setQuality(level) {
    const next = Math.min(QUALITY.length - 1, Math.max(0, Math.round(Number.isFinite(level) ? level : 1)));
    if (next === s.level) return;
    s.level = next;
    if (!s.res || s.lost) return;
    freeGrid();
    buildGrid();
    buildBloom();
    buildBg();
    s.clock.reset();
  }

  function dispose() {
    if (s.disposed) return;
    s.disposed = true;
    canvas.removeEventListener?.('webglcontextlost', onLost);
    canvas.removeEventListener?.('webglcontextrestored', onRestored);
    if (!s.lost) freeAll();
    s.res = null;
  }

  function onLost(e) {
    e?.preventDefault?.();
    s.lost = true;
    s.res = null;
  }

  function onRestored() {
    if (s.disposed) return;
    try {
      init();
      s.lost = false;
      s.clock.reset();
    } catch (err) {
      onError(err);
    }
  }

  try {
    init();
  } catch (err) {
    freeAll();
    onError(err);
    return null;
  }
  canvas.addEventListener?.('webglcontextlost', onLost);
  canvas.addEventListener?.('webglcontextrestored', onRestored);
  resize(view.w, view.h, 1);

  return {
    resize,
    draw,
    setQuality,
    dispose,
    setDprCap,
    setLite,
    get quality() { return s.level; },
    get stats() {
      let vertices = 0;
      for (const g of s.tiers) vertices += g.vertices;
      return { level: s.level, tiers: s.tiers.length, vertices, dpr: view.dpr, lite: s.lite, w: view.w, h: view.h };
    },
    get lost() { return s.lost; },
    get bloomActive() { return !!s.res?.bloom; },
  };
}
