import { clamp01 } from './viz-terrain-math.js';
import { beginRect, endRect, countFull } from './viz-synth-fill.js';

export const MAX_BANDS = 16;
const FLASH_GAIN = 0.15;
const STEP_ROWS_PX = 4;
const MIN_GROWTH = 1.001;
const SLICE_PERIOD_S = 4;

const hexCache = new Map();

function toRgb(c) {
  if (Array.isArray(c) || ArrayBuffer.isView(c)) return [c[0], c[1], c[2]];
  const key = String(c);
  let v = hexCache.get(key);
  if (!v) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(key);
    v = m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
    hexCache.set(key, v);
  }
  return v.slice();
}

const num = (v, d) => (Number.isFinite(v) ? v : d);
const flashOf = (signal) => clamp01(num(signal?.flash, 0));
const halfDetail = (q) => !!q && (q.sliceDetail === false || q.sliceDetail === 'half' || q.sliceDetail === 'low');

export function sunLayout(scene, p) {
  const r = num(p.radius, 0.22);
  const horizonV = num(scene.horizonV, 0.4);
  return { cx: 0.5, cy: horizonV - num(p.height, 0.5) * r, r };
}

export function sliceBands(p) {
  const count = Math.max(0, Math.min(MAX_BANDS, Math.round(num(p.sliceCount, 0))));
  const first = Math.max(0.0005, num(p.sliceFirst, 0.025));
  const g = Math.max(1, num(p.sliceGrowth, 1));
  const out = [];
  let y = clamp01(num(p.sliceStart, 0.5));
  for (let i = 0; i < count; i++) {
    const w = first * Math.pow(g, i);
    const y0 = y + w;
    if (y0 >= 1) break;
    out.push({ y0, y1: Math.min(1, y0 + w) });
    y = y0 + w;
  }
  return out;
}

export function sunColorAt(p, tDisc) {
  const t = clamp01(num(tDisc, 0));
  const top = toRgb(p.top);
  const bottom = toRgb(p.bottom);
  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  if (p.midOn) {
    const mid = toRgb(p.mid);
    return t < 0.5 ? lerp(top, mid, t * 2) : lerp(mid, bottom, (t - 0.5) * 2);
  }
  return lerp(top, bottom, t);
}

export function advancePhase(prev, dt, p, q, reduced, out) {
  const o = out || { slice: 0, haze: 0 };
  const s = prev ? num(prev.slice, 0) : 0;
  const h = prev ? num(prev.haze, 0) : 0;
  const frozen = !!reduced || (!!q && q.hazeMotion === false);
  if (frozen) {
    o.slice = s;
    o.haze = h;
    return o;
  }
  const d = Math.max(0, Math.min(0.25, num(dt, 0)));
  o.slice = (s + (d * clamp01(num(p.sliceDrift, 0))) / SLICE_PERIOD_S) % 1;
  o.haze = (h + d * clamp01(num(p.hazeMove, 0)) * 1.2) % (Math.PI * 2);
  return o;
}

function paletteUniforms(p) {
  return { uTop: toRgb(p.top), uMid: toRgb(p.mid), uBottom: toRgb(p.bottom), uMidOn: p.midOn ? 1 : 0 };
}

export function sunRect(scene, p) {
  const lay = sunLayout(scene, p);
  const w = scene.res[0];
  const h = scene.res[1];
  const r = lay.r * h + 2;
  return [lay.cx * w - r, lay.cy * h - r, lay.cx * w + r, lay.cy * h + r];
}

export function hazeRects(scene, p) {
  const lay = sunLayout(scene, p);
  const w = scene.res[0];
  const h = scene.res[1];
  const out = { ring: null, band: null };
  if (p.on && p.ringOn && num(p.ringAlpha, 0) > 0) {
    const r = lay.r * 1.1 * h * Math.max(1.001, num(p.ringRadius, 1.5)) + 2;
    const rx = r * (p.ringShape === 'band' ? 2.4 : 1);
    out.ring = [lay.cx * w - rx, lay.cy * h - r, lay.cx * w + rx, lay.cy * h + r];
  }
  if (p.bandOn && num(p.bandHeight, 0) > 0) {
    const hp = num(scene.horizonV, 0.4) * h;
    const bh = clamp01(num(p.bandHeight, 0)) * h + 2;
    out.band = [0, hp - bh, w, hp + bh];
  }
  return out;
}

export function reflectionRect(scene, p) {
  const lay = sunLayout(scene, p);
  const w = scene.res[0];
  const h = scene.res[1];
  const hp = num(scene.horizonV, 0.4) * h;
  const groundH = Math.max(0, 1 - num(scene.horizonV, 0.4));
  const len = p.on && p.refl !== 'off' && num(p.reflOpacity, 0) > 0 ? clamp01(num(p.reflLength, 0.5)) * groundH * h : 0;
  const sheen = p.sheen && num(p.sheenAmount, 0) > 0;
  const down = Math.max(len, sheen ? 0.3 * h : 0) + 2;
  const span = len > 0 && !sheen ? lay.r * h * 3 : w;
  return [lay.cx * w - span, hp, lay.cx * w + span, hp + down];
}

export function sunUniforms(scene, p, signal, driftPhase) {
  const lay = sunLayout(scene, p);
  const half = halfDetail(scene.q);
  const stepped = p.sliceEdge === 'stepped' || half;
  let bands = sliceBands(p);
  if (half) bands = bands.slice(0, Math.ceil(bands.length / 2));
  const arr = new Float32Array(MAX_BANDS * 2);
  bands.forEach((b, i) => {
    arr[i * 2] = b.y0;
    arr[i * 2 + 1] = b.y1;
  });
  const dpr = num(scene.dpr, 1);
  const g = Math.max(MIN_GROWTH, num(p.sliceGrowth, 1));
  const first = Math.max(0.0005, num(p.sliceFirst, 0.025));
  const phase = clamp01(num(driftPhase?.slice, 0));
  return {
    uRes: [scene.res[0], scene.res[1]],
    uCenter: [lay.cx, lay.cy],
    uRadius: lay.r,
    ...paletteUniforms(p),
    uBands: arr,
    uBandCount: bands.length,
    uEdgeSoftPx: stepped ? 0 : 1.5 * dpr,
    uStepPx: stepped ? Math.max(1, Math.round(STEP_ROWS_PX * dpr)) : 0,
    uDrift: [clamp01(num(p.sliceStart, 0.5)), (2 * first) / (g - 1), Math.pow(g, phase)],
    uBright: 1 + FLASH_GAIN * flashOf(signal),
    uOn: p.on ? 1 : 0,
  };
}

export function hazeUniforms(scene, p, signal, phase) {
  const lay = sunLayout(scene, p);
  const flash = flashOf(signal);
  const move = clamp01(num(p.hazeMove, 0));
  const pulse = 1 + move * (0.05 * Math.sin(num(phase?.haze, 0)) + 0.05 * flash);
  const gain = 1 + FLASH_GAIN * flash;
  return {
    uRes: [scene.res[0], scene.res[1]],
    uCenter: [lay.cx, lay.cy],
    uRadius: lay.r * pulse,
    uHorizon: scene.horizonV,
    uRingOn: p.on && p.ringOn ? 1 : 0,
    uRingColor: toRgb(p.ringColor),
    uRingRadius: Math.max(1.001, num(p.ringRadius, 1.5)),
    uRingSoft: clamp01(num(p.ringSoft, 0.7)),
    uRingAlpha: clamp01(num(p.ringAlpha, 0)) * gain,
    uRingBand: p.ringShape === 'band' ? 1 : 0,
    uBandOn: p.bandOn ? 1 : 0,
    uBandColor: toRgb(p.bandColor),
    uBandHeight: clamp01(num(p.bandHeight, 0)),
    uBandAlpha: 0.6 * gain,
  };
}

export function reflectionUniforms(scene, p, signal, phase) {
  const lay = sunLayout(scene, p);
  const gain = 1 + FLASH_GAIN * flashOf(signal);
  const ripple = clamp01(num(p.reflRipple, 0));
  const style = p.refl === 'blur' ? 1 : 0;
  const active = p.on && p.refl !== 'off';
  const groundH = Math.max(0, 1 - num(scene.horizonV, 0.4));
  return {
    uRes: [scene.res[0], scene.res[1]],
    uHorizon: scene.horizonV,
    uCx: lay.cx,
    uSunR: lay.r,
    uLength: clamp01(num(p.reflLength, 0.5)) * groundH,
    uStyle: style,
    uOpacity: active ? clamp01(num(p.reflOpacity, 0)) * gain : 0,
    uFade: clamp01(num(p.reflFade, 0.7)),
    uRipple: ripple,
    uRippleFreq: 38,
    uPhase: num(phase?.haze, 0) * 2 + num(phase?.slice, 0) * Math.PI * 2,
    ...paletteUniforms(p),
    uFollow: p.reflFollow ? 1 : 0,
    uColor: toRgb(p.reflColor),
    uSheen: p.sheen ? clamp01(num(p.sheenAmount, 0)) : 0,
    uSoft: scene.q && scene.q.reflBlur === false ? 0 : 1,
  };
}

const VS = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `precision highp float;
uniform vec2 uRes;
vec2 fragPx() { return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); }
`;

const GRADIENT = `uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBottom;
uniform float uMidOn;
vec3 sunGrad(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 two = mix(uTop, uBottom, t);
  vec3 three = t < 0.5 ? mix(uTop, uMid, t * 2.0) : mix(uMid, uBottom, (t - 0.5) * 2.0);
  return mix(two, three, uMidOn);
}
`;

export const SUN_FS = `${COMMON}${GRADIENT}uniform vec2 uCenter;
uniform float uRadius;
uniform float uBands[32];
uniform float uBandCount;
uniform float uEdgeSoftPx;
uniform float uStepPx;
uniform vec3 uDrift;
uniform float uBright;
uniform float uOn;
void main() {
  if (uOn < 0.5) discard;
  vec2 px = fragPx();
  float R = uRadius * uRes.y;
  vec2 c = vec2(uCenter.x * uRes.x, uCenter.y * uRes.y);
  float py = px.y;
  if (uStepPx > 0.5) py = (floor(py / uStepPx) + 0.5) * uStepPx;
  float d = length(vec2(px.x - c.x, py - c.y));
  float edge = 1.0 - smoothstep(R - 1.0, R + 0.5, length(px - c));
  if (edge <= 0.0) discard;
  float y = (py - (c.y - R)) / (2.0 * R);
  float s = y - uDrift.x;
  float ys = y;
  if (s > 0.0) ys = uDrift.x + (s + uDrift.y) / uDrift.z - uDrift.y;
  float soft = uEdgeSoftPx / (2.0 * R);
  float cut = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uBandCount) break;
    float y0 = uBands[i * 2];
    float y1 = uBands[i * 2 + 1];
    float a = soft > 0.0 ? smoothstep(y0 - soft, y0 + soft, ys) * (1.0 - smoothstep(y1 - soft, y1 + soft, ys))
                         : step(y0, ys) * (1.0 - step(y1, ys));
    cut = max(cut, a);
  }
  float alpha = edge * (1.0 - cut);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(sunGrad(y) * uBright, alpha);
}`;

export const HAZE_FS = `${COMMON}uniform vec2 uCenter;
uniform float uRadius;
uniform float uHorizon;
uniform float uRingOn;
uniform vec3 uRingColor;
uniform float uRingRadius;
uniform float uRingSoft;
uniform float uRingAlpha;
uniform float uRingBand;
uniform float uBandOn;
uniform vec3 uBandColor;
uniform float uBandHeight;
uniform float uBandAlpha;
void main() {
  vec2 px = fragPx();
  float R = uRadius * uRes.y;
  vec2 c = vec2(uCenter.x * uRes.x, uCenter.y * uRes.y);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uRingOn > 0.5) {
    vec2 dv = px - c;
    dv.x /= mix(1.0, 2.4, uRingBand);
    float n = length(dv) / R;
    float t = clamp((n - 1.0) / max(uRingRadius - 1.0, 0.001), 0.0, 1.0);
    float k = pow(1.0 - smoothstep(0.0, 1.0, t), mix(4.0, 1.0, uRingSoft));
    float ra = k * uRingAlpha;
    col += uRingColor * ra;
    a += ra;
  }
  if (uBandOn > 0.5 && uBandHeight > 0.0) {
    float hp = uHorizon * uRes.y;
    float dy = (hp - px.y) / (uBandHeight * uRes.y);
    float k = clamp(1.0 - abs(dy), 0.0, 1.0);
    k = k * k;
    float ba = k * uBandAlpha;
    col += uBandColor * ba;
    a += ba;
  }
  if (a <= 0.0) discard;
  gl_FragColor = vec4(col, a);
}`;

export const REFL_FS = `${COMMON}${GRADIENT}uniform float uHorizon;
uniform float uCx;
uniform float uSunR;
uniform float uLength;
uniform float uStyle;
uniform float uOpacity;
uniform float uFade;
uniform float uRipple;
uniform float uRippleFreq;
uniform float uPhase;
uniform float uFollow;
uniform vec3 uColor;
uniform float uSheen;
uniform float uSoft;
void main() {
  vec2 px = fragPx();
  float hp = uHorizon * uRes.y;
  float dy = px.y - hp;
  if (dy < 0.0) discard;
  float Rpx = uSunR * uRes.y;
  float dx = px.x - uCx * uRes.x;
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uOpacity > 0.0 && uLength > 0.0) {
    float t = dy / (uLength * uRes.y);
    if (t < 1.0) {
      float wob = sin(uRippleFreq * pow(t, 0.7) + uPhase) * uRipple * Rpx * 0.08;
      float half_ = Rpx * (1.0 - 0.4 * t) * mix(1.0, 1.5, uStyle);
      float soft = half_ * mix(0.04, 0.7, uStyle) * mix(0.15, 1.0, uSoft);
      float across = 1.0 - smoothstep(half_ - soft, half_ + soft + 0.5, abs(dx - wob));
      float rows = 0.5 + 0.5 * sin(uRippleFreq * pow(t, 0.7) * 1.7 + uPhase * 1.3);
      float cutRows = uSoft > 0.5 ? rows : step(0.5, rows);
      float breaks = 1.0 - uRipple * (1.0 - cutRows) * smoothstep(0.0, 0.12, t);
      float fade = pow(1.0 - t, mix(0.6, 3.0, uFade));
      float ra = across * breaks * fade * uOpacity;
      vec3 rc = mix(uColor, sunGrad(1.0 - t * 0.85), uFollow);
      col += rc * ra;
      a += ra;
    }
  }
  if (uSheen > 0.0) {
    float near = exp(-dy / (0.05 * uRes.y));
    float across = 0.3 + 0.7 * exp(-(dx * dx) / (2.0 * Rpx * Rpx * 4.0));
    float sa = uSheen * 0.35 * near * across;
    vec3 sc = mix(uColor, sunGrad(0.9), uFollow);
    col += sc * sa;
    a += sa;
  }
  if (a <= 0.0) discard;
  gl_FragColor = vec4(col, a);
}`;

function setUniform(gl, rec, name, v) {
  let loc = rec.locs.get(name);
  if (loc === undefined) {
    loc = gl.getUniformLocation(rec.prog, name);
    rec.locs.set(name, loc);
  }
  if (loc === null) return false;
  const prev = rec.vals.get(name);
  if (typeof v === 'number') {
    if (prev === v) return false;
    rec.vals.set(name, v);
    gl.uniform1f(loc, v);
    return true;
  }
  if (prev && prev.length === v.length) {
    let same = true;
    for (let i = 0; i < v.length; i++) if (prev[i] !== v[i]) { same = false; break; }
    if (same) return false;
  }
  rec.vals.set(name, Array.from(v));
  if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
  else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
  else gl.uniform1fv(loc, v);
  return true;
}

export function createSunPass(gl, deps) {
  const { linkProgram } = deps;
  const stats = { draws: 0, uploads: 0, rebuilds: 0, programs: 0 };
  let progs = null;
  let buf = null;
  let phase = { slice: 0, haze: 0 };
  let lastTime = NaN;

  function build() {
    progs = {
      haze: linkProgram(gl, VS, HAZE_FS, ['aPos']),
      sun: linkProgram(gl, VS, SUN_FS, ['aPos']),
      refl: linkProgram(gl, VS, REFL_FS, ['aPos']),
    };
    stats.programs = 3;
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  function release() {
    if (!progs) return;
    for (const k of Object.keys(progs)) gl.deleteProgram(progs[k].prog);
    if (buf) gl.deleteBuffer(buf);
    progs = null;
    buf = null;
  }

  function step(scene) {
    if (scene.time === lastTime) return;
    lastTime = scene.time;
    phase = advancePhase(phase, scene.dt, stepParams, scene.q, scene.reduced, phase);
  }

  let stepParams = {};

  function run(rec, uniforms, blendSrc, blendDst, scene, rect) {
    if (rect) {
      if (!beginRect(gl, scene, rect[0], rect[1], rect[2], rect[3])) return;
    } else countFull(scene);
    gl.useProgram(rec.prog);
    for (const name of Object.keys(uniforms)) {
      if (setUniform(gl, rec, name, uniforms[name])) stats.uploads++;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(blendSrc, blendDst);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    if (rect) endRect(gl);
    stats.draws++;
  }

  build();

  const pass = {
    stats,
    drawHaze(scene, p, signal) {
      stepParams = p;
      step(scene);
      const u = hazeUniforms(scene, p, signal, phase);
      if (!u.uRingOn && !u.uBandOn) return;
      const rects = hazeRects(scene, p);
      if (u.uRingOn && rects.ring) run(progs.haze, { ...u, uBandOn: 0 }, gl.SRC_ALPHA, gl.ONE, scene, rects.ring);
      if (u.uBandOn && rects.band) run(progs.haze, { ...u, uRingOn: 0 }, gl.SRC_ALPHA, gl.ONE, scene, rects.band);
    },
    drawSun(scene, p, signal) {
      stepParams = p;
      step(scene);
      if (!p.on) return;
      run(progs.sun, sunUniforms(scene, p, signal, phase), gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, scene, sunRect(scene, p));
    },
    drawReflection(scene, p, signal) {
      stepParams = p;
      step(scene);
      const u = reflectionUniforms(scene, p, signal, phase);
      if (u.uOpacity <= 0 && u.uSheen <= 0) return;
      run(progs.refl, u, gl.SRC_ALPHA, gl.ONE, scene, reflectionRect(scene, p));
    },
    draw(scene, p, signal) {
      pass.drawHaze(scene, p, signal);
      pass.drawSun(scene, p, signal);
      pass.drawReflection(scene, p, signal);
    },
    resize() {},
    rebuild() {
      progs = null;
      buf = null;
      stats.rebuilds++;
      build();
    },
    dispose() {
      release();
    },
  };
  return pass;
}
