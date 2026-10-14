import {
  QUALITY, HISTORY_BINS, STAR_VISIBLE, buildDepthIndices, buildCrossIndices, energyOf, easeEnergy, GRID_DEPTH, GRID_HALF_WIDTH, RAMP, qualityFor, createHistory, fillHeights, buildGridVertices,
  gridCounts, makeStars, cameraAt, horizonY, horizonGlow, mat4Perspective, mat4LookAt, mat4Multiply,
  makeRowClock, clamp01,
} from './viz-terrain-math.js';

const DPR_CAP = 2;
const STAR_COUNT = STAR_VISIBLE[STAR_VISIBLE.length - 1];
const STAR_SEED = 20261014;
const NEAR = 0.05;
const FAR = 40;
const BLOOM_SCALE = 0.5;
const BASS_BINS = 6;

const GRID_VS = `
precision mediump float;
attribute vec2 a_p;
attribute float a_h;
uniform mat4 u_vp;
uniform float u_halfW, u_dz, u_scroll, u_amp, u_pt, u_dpr, u_mode, u_time, u_off, u_viewW, u_energy;
varying float v_h;
varying float v_fog;
void main() {
  v_h = a_h;
  if (u_mode > 3.5) {
    gl_Position = vec4(a_p, 0.999, 1.0);
    gl_PointSize = (1.0 + a_h * 1.6) * u_dpr;
    v_fog = 0.0;
    return;
  }
  float row = a_p.y - u_scroll;
  float sway = sin(row * 0.45 + a_p.x * 2.3 + u_time * 0.5) * 0.1 * smoothstep(0.0, 10.0, row);
  vec3 pos = vec3(a_p.x * u_halfW + sway, a_h * u_amp, -row * u_dz);
  vec4 clip = u_vp * vec4(pos, 1.0);
  float near = clamp(3.0 / max(clip.w, 0.1), 0.0, 1.0);
  v_fog = smoothstep(3.0, 15.0, clip.w);
  clip.x += u_off * near * (0.7 + 0.5 * u_energy) * 2.0 * u_dpr / u_viewW * clip.w;
  gl_Position = clip;
  gl_PointSize = u_pt * u_dpr * clamp(3.5 / max(clip.w, 0.1), 0.35, 2.2) * (1.0 + 2.2 * smoothstep(0.6, 1.0, a_h));
}`;

const GRID_FS = `
precision mediump float;
uniform float u_mode, u_glow, u_energy, u_ab;
uniform vec3 u_c0, u_c1, u_c2, u_fog;
varying float v_h;
varying float v_fog;
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
      a = (0.2 + 0.6 * smoothstep(0.0, 0.9, v_h)) * far * lum * 0.95 * u_ab;
    } else if (u_mode < 1.5) {
      float soft = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
      a = soft * soft * (0.25 * (1.0 - 0.5 * u_energy) + 1.2 * smoothstep(0.55, 1.0, v_h)) * far * lum;
    } else {
      a = (0.07 + 0.1 * (1.0 - u_energy) + 0.85 * smoothstep(0.12, 0.6, v_h)) * far * lum * 0.8;
    }
    col = mix(col, u_fog, v_fog * 0.6) * (0.85 + 0.6 * u_glow * v_h) + vec3(0.5, 0.7, 1.0) * smoothstep(0.7, 1.0, v_h) * 0.3;
  }
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
  vec3 top = mix(vec3(0.006, 0.014, 0.05), vec3(0.03, 0.15, 0.3), e);
  vec3 hor = mix(vec3(0.02, 0.07, 0.17), vec3(0.28, 0.5, 0.7), e * 0.9);
  vec3 col = mix(hor, top, smoothstep(0.0, 0.75, dy));
  if (dy < 0.0) {
    vec3 gnd = mix(vec3(0.01, 0.03, 0.09), vec3(0.04, 0.22, 0.4), e);
    vec3 gndFar = mix(vec3(0.015, 0.05, 0.13), vec3(0.2, 0.42, 0.62), e);
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
    history: null,
    heights: null,
    clock: makeRowClock(),
    scroll: 0,
    bass: 0,
    energy: 0,
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

  function buildGrid() {
    const q = QUALITY[s.level];
    const depth = buildDepthIndices(q.rows, q.cols);
    const cross = buildCrossIndices(q.rows, q.cols);
    const counts = gridCounts(q.rows, q.cols);
    s.history = createHistory(q.rows, HISTORY_BINS);
    s.heights = new Float32Array(q.rows * q.cols);
    s.res.grid = {
      xz: buffer(gl.ARRAY_BUFFER, buildGridVertices(q.rows, q.cols), gl.STATIC_DRAW),
      h: buffer(gl.ARRAY_BUFFER, s.heights, gl.DYNAMIC_DRAW),
      depth: buffer(gl.ELEMENT_ARRAY_BUFFER, depth, gl.STATIC_DRAW),
      cross: buffer(gl.ELEMENT_ARRAY_BUFFER, cross, gl.STATIC_DRAW),
      indexType: depth instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      depthCount: depth.length,
      crossCount: cross.length,
      vertices: counts.vertices,
      dz: GRID_DEPTH / (q.rows - 1),
    };
  }

  function freeGrid() {
    const g = s.res?.grid;
    if (!g) return;
    gl.deleteBuffer(g.xz);
    gl.deleteBuffer(g.h);
    gl.deleteBuffer(g.depth);
    gl.deleteBuffer(g.cross);
    s.res.grid = null;
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
  }

  function init() {
    s.res = { grid: null, bloom: null };
    s.res.grid_p = linkProgram(gl, GRID_VS, GRID_FS, ['a_p', 'a_h']);
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
    for (const k of ['grid_p', 'bg_p', 'post_p']) if (s.res[k]) gl.deleteProgram(s.res[k].prog);
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

  function gridUniforms(p, mode, glow) {
    const g = s.res.grid;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(uni(gl, p, 'u_vp'), false, mvp);
    gl.uniform1f(uni(gl, p, 'u_halfW'), GRID_HALF_WIDTH);
    gl.uniform1f(uni(gl, p, 'u_dz'), g.dz);
    gl.uniform1f(uni(gl, p, 'u_scroll'), s.scroll);
    gl.uniform1f(uni(gl, p, 'u_amp'), 0.8 + 1.4 * s.energy);
    gl.uniform1f(uni(gl, p, 'u_pt'), 2.5);
    gl.uniform1f(uni(gl, p, 'u_time'), s.time);
    gl.uniform1f(uni(gl, p, 'u_off'), 0);
    gl.uniform1f(uni(gl, p, 'u_viewW'), view.w);
    gl.uniform1f(uni(gl, p, 'u_energy'), s.energy);
    gl.uniform1f(uni(gl, p, 'u_ab'), QUALITY[s.level].passes > 1 ? 1 : 2);
    gl.uniform1f(uni(gl, p, 'u_dpr'), view.dpr);
    gl.uniform1f(uni(gl, p, 'u_mode'), mode);
    gl.uniform1f(uni(gl, p, 'u_glow'), glow);
    gl.uniform3fv(uni(gl, p, 'u_c0'), RAMP[0].c);
    gl.uniform3fv(uni(gl, p, 'u_c1'), RAMP[1].c);
    gl.uniform3fv(uni(gl, p, 'u_c2'), RAMP[2].c);
    gl.uniform3f(uni(gl, p, 'u_fog'), 0.04, 0.16, 0.31);
  }

  function drawGrid() {
    const p = s.res.grid_p;
    const g = s.res.grid;
    gridUniforms(p, 0, s.bass);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.xz);
    attrib(0, 2, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.h);
    attrib(1, 1, 0, 0);
    const offsets = QUALITY[s.level].passes > 1 ? [-1, 0, 1] : [0];
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.depth);
    for (const o of offsets) {
      gl.uniform1f(uni(gl, p, 'u_off'), o);
      gl.drawElements(gl.LINES, g.depthCount, g.indexType, 0);
    }
    gl.uniform1f(uni(gl, p, 'u_off'), 0);
    gl.uniform1f(uni(gl, p, 'u_mode'), 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.cross);
    gl.drawElements(gl.LINES, g.crossCount, g.indexType, 0);
    gl.uniform1f(uni(gl, p, 'u_mode'), 1);
    gl.drawArrays(gl.POINTS, 0, g.vertices);
  }

  function drawStars() {
    const p = s.res.grid_p;
    gridUniforms(p, 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.res.stars);
    attrib(0, 2, 12, 0);
    attrib(1, 1, 12, 8);
    gl.drawArrays(gl.POINTS, 0, STAR_VISIBLE[s.level]);
  }

  function drawBackground(cam) {
    const p = s.res.bg_p;
    gl.useProgram(p.prog);
    gl.uniform1f(uni(gl, p, 'u_horizon'), horizonY(cam));
    gl.uniform1f(uni(gl, p, 'u_glow'), horizonGlow(s.bass));
    gl.uniform1f(uni(gl, p, 'u_energy'), s.energy);
    gl.uniform1f(uni(gl, p, 'u_time'), s.time);
    gl.uniform1f(uni(gl, p, 'u_aspect'), view.w / view.h);
    gl.disable(gl.BLEND);
    drawQuadWith(p);
    gl.enable(gl.BLEND);
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

  function updateHeights(t) {
    const q = QUALITY[s.level];
    fillHeights(s.history, q.cols, t / 1000, s.heights);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.res.grid.h);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.heights);
  }

  function draw(spectrum, t = 0) {
    if (s.lost || s.disposed || !s.res) return;
    const sp = spectrum || [];
    const step = s.clock.advance(t);
    for (let i = 0; i < step.pushes; i += 1) s.history.push(sp);
    s.scroll = step.frac;
    let bass = 0;
    const n = Math.min(BASS_BINS, sp.length);
    for (let i = 0; i < n; i += 1) bass += clamp01(sp[i]);
    s.bass = n ? bass / n : 0;
    s.energy = easeEnergy(s.energy, energyOf(sp), s.lastT === null ? 1 : (t - s.lastT) / 1000);
    s.lastT = t;
    s.time = (t / 1000) % 600;
    updateHeights(t);
    const cam = cameraAt(t / 1000, s.bass);
    mat4Perspective(cam.fov, view.w / view.h, NEAR, FAR, proj);
    mat4LookAt(cam.eye, cam.target, cam.up, look);
    mat4Multiply(proj, look, mvp);
    if (s.res.bloom) renderBloom();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.w, view.h);
    drawBackground(cam);
    drawStars();
    drawGrid();
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
    if (s.res && !s.lost) buildBloom();
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
