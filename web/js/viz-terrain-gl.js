import {
  QUALITY, HISTORY_BINS, STAR_VISIBLE, buildDepthIndices, buildCrossIndices, buildRibbonVertices, buildRibbonIndices, energyOf, easeEnergy, GRID_DEPTH, WORLD_SPEED, NOW_FALLOFF_S, NOW_GAIN, CROSS_H0, CROSS_H1, AMP_MAX, SHAKE_ENABLED,
  gridHalfWidth, RAMP, qualityFor, createFrame, createSeries, fillHeights, buildGridVertices, rowLayout, nowZOf, fillLiveFrame, fillLookFrame, blendFrames,
  gridCounts, makeStars, lodTiers, makeTierPlan, resampleTier, cameraAt, horizonY, horizonGlow, mat4Perspective, mat4LookAt, mat4Multiply,
  makeRowClock, clamp01, resample, ROWS_PER_SECOND, gridDims, fillLight, LIGHT_GAIN, NODE_GAIN, FOG_NEAR, FOG_FAR, FOG_LOW_MIN, FOG_H0, FOG_H1,
} from './viz-terrain-math.js';
import { getCam } from './viz-cam-debug.js';
import { getStyle, isBeatStyle } from './viz-terrain-style.js';
import { fillBeatHeights, timelineBeats, createLiveBeats } from './viz-beats.js';

const DPR_CAP = 2;
const STAR_COUNT = STAR_VISIBLE[STAR_VISIBLE.length - 1];
const STAR_SEED = 20261014;
const NEAR = 0.3;
const FAR = 160;
const BLOOM_SCALE = 0.5;
const BASS_BINS = 6;
const LOOK_BLEND_S = 1;
const SLOW_S = 1.2;
const LINE_PX = [0, 1.1, 1.5];

const GRID_VS = `
precision mediump float;
attribute vec2 a_p;
attribute float a_h;
attribute float a_s;
attribute float a_l;
uniform mat4 u_vp;
uniform vec4 u_fogA;
uniform vec2 u_fogB;
uniform float u_hw, u_depth, u_dz, u_amp, u_pt, u_dpr, u_mode, u_viewW, u_viewH, u_scroll, u_nowZ, u_nowW, u_base, u_lw, u_axis, u_soft, u_cols;
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
void main() {
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
  vec3 pos = vec3(a_p.x * u_hw, a_h * u_amp, -z);
  vec4 clip = u_vp * vec4(pos, 1.0);
  float dn = (z - u_nowZ) / u_nowW;
  v_now = exp(-dn * dn);
  v_fog = smoothstep(4.0, 0.8 * u_depth, clip.w);
  v_end = 1.0 - smoothstep(0.6 * u_depth, 1.0 * u_depth, clip.w);
  v_near = smoothstep(0.4, 2.2, clip.w);
  if (u_soft > 0.5) {
    float k = mod(a_p.y + u_base, 256.0);
    float col = (a_p.x * 0.5 + 0.5) * u_cols;
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
  v_wh = a_h * u_amp;
  float fFar = smoothstep(u_fogA.x, u_fogA.y, clip.w / u_depth);
  float fLow = 1.0 - smoothstep(u_fogB.x, u_fogB.y, v_wh);
  v_fogH = fFar * (u_fogA.z + (1.0 - u_fogA.z) * fLow);
  gl_Position = clip;
  gl_PointSize = u_pt * u_dpr * clamp(3.5 / max(clip.w, 0.1), 0.35, 2.2) * (1.0 + 2.2 * smoothstep(0.6, 1.0, a_h)) * (1.0 + 0.8 * v_now);
}`;

const GRID_FS = `
precision mediump float;
uniform float u_mode, u_glow, u_energy, u_ab, u_soft, u_nowGain, u_crossLo, u_crossHi, u_light, u_node;
uniform vec3 u_c0, u_c1, u_c2, u_fog;
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
    col += vec3(0.3, 0.55, 0.9) * max(lf, 0.0) * 0.35;
    col = mix(col, u_fog, v_fogH * 0.5);
    a *= 1.0 - 0.4 * v_fogH;
    float nowK = v_now * (0.45 + 0.55 * smoothstep(0.1, 0.8, v_h));
    a *= 1.0 + u_nowGain * nowK;
    col = mix(col, vec3(1.0), 0.8 * nowK);
  }
  a *= v_near * v_end;
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
  return { prog, locs: new Map() };
}

function uni(gl, p, name) {
  if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(p.prog, name));
  return p.locs.get(name);
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

function layoutSig(level, aspect) {
  const d = gridDims(level, aspect);
  return `${d.rows}x${d.cols};${lodTiers(level, aspect, nowZOf(d.rows)).map((t) => `${t.rows}x${t.cols}@${t.spacing.toFixed(4)}`).join()}`;
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
  };
  const mvp = new Float32Array(16);
  const proj = new Float32Array(16);
  const look = new Float32Array(16);

  function buffer(target, data, usage) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  }

  function buildTier(tier) {
    const q = QUALITY[s.level];
    const { rows, cols } = tier;
    const n = rows * cols;
    const depth = buildDepthIndices(rows, cols);
    const cross = buildCrossIndices(rows, cols);
    const g = {
      t: tier,
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
    s.beatB = new Float32Array(rows * cols);
    s.light = new Float32Array(rows * cols);
    s.sig = layoutSig(s.level, aspect);
    s.tiers = lodTiers(s.level, aspect, s.nowZ).map(buildTier);
    s.res.tiers = s.tiers;
  }

  function freeTier(g) {
    for (const k of ['xz', 'h', 'l', 'depth', 'cross']) gl.deleteBuffer(g[k]);
    if (g.ribbon) for (const k of ['xz', 'side', 'h', 'l', 'depth', 'cross']) gl.deleteBuffer(g.ribbon[k]);
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
    s.res.grid_p = linkProgram(gl, GRID_VS, GRID_FS, ['a_p', 'a_h', 'a_s', 'a_l']);
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

  function gridUniforms(p, mode, glow, g = s.tiers[0]) {
    const q = QUALITY[s.level];
    const t = g.t;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(uni(gl, p, 'u_vp'), false, mvp);
    gl.uniform1f(uni(gl, p, 'u_hw'), t.hw);
    gl.uniform1f(uni(gl, p, 'u_dz'), t.dz);
    gl.uniform1f(uni(gl, p, 'u_depth'), GRID_DEPTH);
    gl.uniform1f(uni(gl, p, 'u_scroll'), g.scroll);
    gl.uniform1f(uni(gl, p, 'u_nowZ'), s.nowZ);
    gl.uniform1f(uni(gl, p, 'u_nowW'), NOW_FALLOFF_S * WORLD_SPEED);
    gl.uniform1f(uni(gl, p, 'u_nowGain'), NOW_GAIN * (0.7 + 0.6 * s.pulse));
    gl.uniform1f(uni(gl, p, 'u_crossLo'), CROSS_H0);
    gl.uniform1f(uni(gl, p, 'u_crossHi'), CROSS_H1);
    gl.uniform1f(uni(gl, p, 'u_base'), g.base % 256);
    gl.uniform1f(uni(gl, p, 'u_cols'), t.cols);
    gl.uniform1f(uni(gl, p, 'u_lw'), LINE_PX[q.soft] || 0);
    gl.uniform1f(uni(gl, p, 'u_soft'), q.soft ? 1 : 0);
    gl.uniform1f(uni(gl, p, 'u_axis'), 0);
    gl.uniform1f(uni(gl, p, 'u_amp'), AMP_MAX);
    gl.uniform1f(uni(gl, p, 'u_pt'), 3);
    gl.uniform1f(uni(gl, p, 'u_light'), LIGHT_GAIN);
    gl.uniform1f(uni(gl, p, 'u_node'), NODE_GAIN);
    gl.uniform4f(uni(gl, p, 'u_fogA'), FOG_NEAR, FOG_FAR, FOG_LOW_MIN, 0);
    gl.uniform2f(uni(gl, p, 'u_fogB'), FOG_H0, FOG_H1);
    gl.uniform1f(uni(gl, p, 'u_viewW'), view.w);
    gl.uniform1f(uni(gl, p, 'u_viewH'), view.h);
    gl.uniform1f(uni(gl, p, 'u_energy'), s.energy);
    gl.uniform1f(uni(gl, p, 'u_ab'), q.soft ? 1 : 2);
    gl.uniform1f(uni(gl, p, 'u_dpr'), view.dpr);
    gl.uniform1f(uni(gl, p, 'u_mode'), mode);
    gl.uniform1f(uni(gl, p, 'u_glow'), glow);
    gl.uniform3fv(uni(gl, p, 'u_c0'), RAMP[0].c);
    gl.uniform3fv(uni(gl, p, 'u_c1'), RAMP[1].c);
    gl.uniform3fv(uni(gl, p, 'u_c2'), RAMP[2].c);
    gl.uniform3f(uni(gl, p, 'u_fog'), 0.04, 0.16, 0.31);
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
      setSide(rb.side);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rb.depth);
      gl.drawElements(gl.TRIANGLES, rb.depthCount, rb.indexType, 0);
      gl.uniform1f(uni(gl, p, 'u_mode'), 3);
      gl.uniform1f(uni(gl, p, 'u_axis'), 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rb.cross);
      gl.drawElements(gl.TRIANGLES, rb.crossCount, rb.indexType, 0);
      gl.uniform1f(uni(gl, p, 'u_axis'), 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, g.xz);
    attrib(0, 2, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.h);
    attrib(1, 1, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.l);
    attrib(3, 1, 0, 0);
    setSide(null);
    if (!rb) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.depth);
      gl.drawElements(gl.LINES, g.depthCount, g.indexType, 0);
      gl.uniform1f(uni(gl, p, 'u_mode'), 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.cross);
      gl.drawElements(gl.LINES, g.crossCount, g.indexType, 0);
    }
    gl.uniform1f(uni(gl, p, 'u_mode'), 1);
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
    setSide(null);
    gl.drawArrays(gl.POINTS, 0, STAR_VISIBLE[s.level]);
  }

  function drawBackground(cam) {
    const p = s.res.bg_p;
    gl.useProgram(p.prog);
    s.horizon = horizonY(cam);
    gl.uniform1f(uni(gl, p, 'u_horizon'), s.horizon);
    gl.uniform1f(uni(gl, p, 'u_glow'), horizonGlow(s.bass));
    gl.uniform1f(uni(gl, p, 'u_energy'), s.energy);
    gl.uniform1f(uni(gl, p, 'u_time'), s.time);
    gl.uniform1f(uni(gl, p, 'u_aspect'), view.w / view.h);
    gl.disable(gl.BLEND);
    drawQuadWith(p);
    gl.enable(gl.BLEND);
  }

  function drawMist() {
    const p = s.res.mist_p;
    if (!p) return;
    gl.useProgram(p.prog);
    gl.uniform1f(uni(gl, p, 'u_horizon'), s.horizon);
    gl.uniform1f(uni(gl, p, 'u_energy'), s.energy);
    gl.uniform1f(uni(gl, p, 'u_time'), s.time);
    gl.uniform1f(uni(gl, p, 'u_aspect'), view.w / view.h);
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
    gl.uniform2f(uni(gl, p, 'u_dir'), dx, dy);
    gl.uniform1f(uni(gl, p, 'u_gain'), gain);
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
    if (!ahead?.timeline || !(k > 0)) return;
    fillBeatHeights({ beats: timelineBeats(ahead.timeline), style, tNow: ahead.time, base: Math.floor(ahead.time / dt), rows, cols, out: s.beatB });
    const h = s.heights;
    const b = s.beatB;
    for (let i = 0; i < h.length; i += 1) h[i] += (b[i] - h[i]) * k;
  }

  function updateHeights(sec, ahead) {
    const { rows, cols } = s.dims;
    const style = getStyle();
    let info = fillLiveFrame(s.liveFrame, s.series, sec);
    let k = 0;
    if (ahead?.timeline) {
      if (s.lookAt === null) s.lookAt = sec;
      k = clamp01((sec - s.lookAt) / LOOK_BLEND_S);
      const li = fillLookFrame(s.lookFrame, ahead.timeline, ahead.time);
      blendFrames(s.liveFrame, s.lookFrame, k);
      info = { base: k >= 1 ? li.base : info.base, frac: info.frac + (li.frac - info.frac) * k };
    } else s.lookAt = null;
    if (isBeatStyle(style)) fillBeatStyle(style, sec, ahead, k, rows, cols);
    else fillHeights(s.liveFrame, cols, sec, s.heights, { swellAmp: 0, bakeAmp: true });
    fillLight(s.heights, rows, cols, gridHalfWidth(view.w / view.h), rowLayout(rows).dz, s.light);
    const pos = (info.base + info.frac) * rowLayout(rows).dt;
    for (const g of s.tiers) uploadTier(g, pos, info.frac);
  }

  function uploadTier(g, pos, fracL) {
    const t = g.t;
    const p = pos / (t.dz / WORLD_SPEED);
    const base = Math.floor(p);
    const fracT = p - base;
    g.base = base;
    g.scroll = fracT - t.jz0 - s.nowZ / t.dz;
    resampleTier(g.plan, s.heights, g.heights, fracL, fracT, 0, 1);
    resampleTier(g.plan, s.light, g.light, fracL, fracT, -1, 1);
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

  function draw(spectrum, t = 0, ahead = null) {
    if (s.lost || s.disposed || !s.res) return;
    const sp = spectrum || [];
    const step = s.clock.advance(t);
    const gap = 1000 / ROWS_PER_SECOND;
    for (let i = 0; i < step.pushes; i += 1) {
      const ts = (t - (step.pushes - 1 - i) * gap) / 1000;
      s.series.push(sp, ts);
      s.liveBeats.push(resample(sp, HISTORY_BINS), ts);
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
    updateHeights(t / 1000, ahead);
    const cc = getCam();
    const cam = cameraAt(t / 1000, SHAKE_ENABLED ? s.pulse : 0, { eye: cc.eye, pitchDeg: cc.pitch, fly: 0 });
    mat4Perspective(cam.fov, view.w / view.h, NEAR, FAR, proj);
    mat4LookAt(cam.eye, cam.target, cam.up, look);
    mat4Multiply(proj, look, mvp);
    if (s.res.bloom) renderBloom();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w, view.h);
    drawBackground(cam);
    drawStars();
    drawGrid();
    drawMist();
    if (s.res.bloom) {
      gl.viewport(0, 0, view.w, view.h);
      blurPass(s.res.bloom.a, null, 0, 0, 0.9, true);
    }
  }

  function resize(w, h, dpr = 1) {
    view.dpr = Math.min(DPR_CAP, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
    view.w = Math.max(1, Math.round(w * view.dpr));
    view.h = Math.max(1, Math.round(h * view.dpr));
    canvas.width = view.w;
    canvas.height = view.h;
    if (s.res && !s.lost) {
      buildBloom();
      if (s.dims && layoutSig(s.level, view.w / view.h) !== s.sig) { freeGrid(); buildGrid(); s.clock.reset(); }
    }
  }

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
    get quality() { return s.level; },
    get lost() { return s.lost; },
    get bloomActive() { return !!s.res?.bloom; },
  };
}
