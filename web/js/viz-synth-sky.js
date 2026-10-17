import { clamp01, mulberry32 } from './viz-terrain-math.js';
import { beginRect, endRect, countFull } from './viz-synth-fill.js';

const TWO_PI = Math.PI * 2;
const STAR_REF_AREA = 1280 * 720;
const STAR_STRIDE = 5;
const MID_STOP = 0.5;

const hexCache = new Map();
function rgb(str) {
  let c = hexCache.get(str);
  if (!c) {
    const m = /^#([0-9a-f]{6})$/i.exec(str);
    const n = m ? Number.parseInt(m[1], 16) : 0;
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    hexCache.set(str, c);
  }
  return c;
}

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function put3(dst, key, src) {
  const d = dst[key] || (dst[key] = [0, 0, 0]);
  d[0] = src[0]; d[1] = src[1]; d[2] = src[2];
}

function put2(dst, key, a, b) {
  const d = dst[key] || (dst[key] = [0, 0]);
  d[0] = a; d[1] = b;
}

export function skyColors(p, sunP) {
  const top = rgb(p.top);
  const bottom = rgb(p.bottom);
  const mid = p.midOn ? rgb(p.mid) : mix3(top, bottom, MID_STOP);
  const fog = sunP?.bandOn ? mix3(bottom, rgb(sunP.bandColor), 0.5) : bottom.slice();
  return { top: top.slice(), mid: mid.slice(), bottom: bottom.slice(), horizon: bottom.slice(), fog };
}

export function starField(p, w, h) {
  const area = Math.max(0, w * h);
  const n = Math.round(p.stars * Math.min(1, area / STAR_REF_AREA));
  const out = new Float32Array(n * STAR_STRIDE);
  const rnd = mulberry32(p.starSeed);
  const maxY = Math.max(0, p.horizonV * h - 1);
  for (let i = 0; i < n; i += 1) {
    const o = i * STAR_STRIDE;
    out[o] = rnd() * w;
    out[o + 1] = rnd() * maxY;
    const r = rnd();
    out[o + 2] = p.starSize * (0.6 + 0.8 * r * r);
    out[o + 3] = rnd() * TWO_PI;
    out[o + 4] = 0.4 + 0.6 * rnd();
  }
  return out;
}

export function twinkleAt(phase, t, amount, q) {
  if (!q?.starsAnimated || q.reduced || !(amount > 0) || !Number.isFinite(t)) return 1;
  return 1 - clamp01(amount) * 0.5 * (1 + Math.sin(phase + t * 1.3));
}

export function skyUniforms(scene, p, signal, out = {}) {
  const q = scene.q || {};
  put3(out, 'top', rgb(p.top));
  put3(out, 'mid', p.midOn ? rgb(p.mid) : mix3(rgb(p.top), rgb(p.bottom), MID_STOP));
  put3(out, 'bottom', rgb(p.bottom));
  put2(out, 'res', scene.res[0], scene.res[1]);
  out.horizonV = scene.horizonV;
  out.midStop = MID_STOP;
  out.starBright = clamp01(p.starBright);
  out.starSizePx = p.starSize * scene.dpr;
  out.twinkle = q.starsAnimated && !scene.reduced ? clamp01(p.twinkle) : 0;
  out.time = scene.reduced ? 0 : scene.time;
  out.starCount = p.stars;
  return out;
}

export function horizonUniforms(scene, p, signal, out = {}) {
  const hPx = scene.res[1];
  put3(out, 'color', rgb(p.hColor));
  put3(out, 'bandColor', rgb(p.hBandColor));
  put2(out, 'res', scene.res[0], hPx);
  out.horizonY = scene.horizonV * hPx;
  out.thickPx = p.hThick * scene.dpr;
  out.glow = clamp01(p.hGlow);
  out.spreadPx = p.hSpread * hPx;
  out.soft = clamp01(p.hSoft);
  out.bandOn = p.hBand ? 1 : 0;
  out.bandPx = p.hBand ? p.hBandHeight * hPx : 0;
  return out;
}

export function skyRect(scene) {
  const w = scene.res[0];
  return [0, 0, w, scene.horizonV * scene.res[1] + 2];
}

export function horizonRect(scene, p) {
  const w = scene.res[0];
  const h = scene.res[1];
  const hy = scene.horizonV * h;
  const thick = p.hThick * scene.dpr;
  const glow = clamp01(p.hGlow);
  const spread = p.hSpread * h;
  const reach = glow > 0.002 ? (spread * Math.log(512 * glow)) / 2.2 : 0;
  const edge = Math.max(thick * 0.5, 1) * 1.5 + 2;
  const below = Math.max(0, reach) + thick + edge;
  const above = below + (p.hBand ? p.hBandHeight * h : 0);
  return [0, hy - above, w, hy + below];
}

export function vignetteUniforms(scene, p, out = {}) {
  put2(out, 'res', scene.res[0], scene.res[1]);
  out.amount = p.vignette ? clamp01(p.vignetteAmount) : 0;
  out.aspect = scene.aspect;
  return out;
}

const QUAD_VS = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const SKY_FS = `
precision highp float;
uniform vec2 u_res;
uniform float u_horizonV;
uniform float u_midStop;
uniform vec3 u_top;
uniform vec3 u_mid;
uniform vec3 u_bottom;
void main() {
  float v = 1.0 - gl_FragCoord.y / u_res.y;
  float t = clamp(v / max(u_horizonV, 0.001), 0.0, 1.0);
  vec3 c = t < u_midStop
    ? mix(u_top, u_mid, t / u_midStop)
    : mix(u_mid, u_bottom, (t - u_midStop) / (1.0 - u_midStop));
  gl_FragColor = vec4(c, 1.0);
}
`;

export const STAR_VS = `
precision highp float;
attribute vec4 a_star;
attribute float a_bright;
uniform vec2 u_css;
uniform float u_dpr;
uniform float u_time;
uniform float u_twinkle;
uniform float u_bright;
varying float v_a;
void main() {
  vec2 ndc = vec2(a_star.x / u_css.x * 2.0 - 1.0, 1.0 - a_star.y / u_css.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = max(1.0, a_star.z * u_dpr);
  float tw = 1.0 - u_twinkle * 0.5 * (1.0 + sin(a_star.w + u_time * 1.3));
  v_a = a_bright * u_bright * tw;
}
`;

export const STAR_FS = `
precision mediump float;
varying float v_a;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float f = smoothstep(0.5, 0.15, length(d));
  gl_FragColor = vec4(vec3(v_a * f), 1.0);
}
`;

export const HORIZON_FS = `
precision highp float;
uniform vec2 u_res;
uniform float u_horizonY;
uniform float u_thickPx;
uniform float u_glow;
uniform float u_spreadPx;
uniform float u_soft;
uniform float u_bandOn;
uniform float u_bandPx;
uniform vec3 u_color;
uniform vec3 u_bandColor;
void main() {
  float y = u_res.y - gl_FragCoord.y;
  float d = abs(y - u_horizonY);
  float hf = u_thickPx * 0.5;
  float edge = mix(0.75, max(hf, 1.0) * 1.5 + 1.0, u_soft);
  float line = 1.0 - smoothstep(hf - 0.5, hf + edge, d);
  float glow = u_glow * exp(-d / max(u_spreadPx, 1.0) * 2.2);
  vec3 c = u_color * (line + glow);
  if (u_bandOn > 0.5) {
    float up = u_horizonY - y;
    float b = step(0.0, up) * (1.0 - smoothstep(0.0, max(u_bandPx, 1.0), up));
    c += u_bandColor * b * 0.8;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

export const VIGNETTE_FS = `
precision highp float;
uniform vec2 u_res;
uniform float u_amount;
uniform float u_aspect;
void main() {
  vec2 p = gl_FragCoord.xy / u_res - 0.5;
  p.x *= min(u_aspect, 1.6);
  float vig = smoothstep(0.35, 0.95, length(p));
  float k = 1.0 - u_amount * vig;
  gl_FragColor = vec4(k, k, k, 1.0);
}
`;

export function createSkyPass(gl, deps) {
  const link = deps.linkProgram;
  const stats = { starCount: 0, uploads: 0, builds: 0 };
  let w = 1;
  let h = 1;
  let dpr = 1;
  let progs = null;
  let quad = null;
  let starBuf = null;
  let starKey = '';
  let starN = 0;
  const uSky = {};
  const uHor = {};
  const uVig = {};

  function cell(p, name) {
    let c = p.vals.get(name);
    if (!c) { c = [Number.NaN, Number.NaN, Number.NaN]; p.vals.set(name, c); }
    return c;
  }
  function loc(p, name) {
    if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(p.prog, name));
    return p.locs.get(name);
  }
  function set1(p, name, a) {
    const c = cell(p, name);
    if (c[0] === a) return;
    c[0] = a;
    gl.uniform1f(loc(p, name), a);
  }
  function set2(p, name, a, b) {
    const c = cell(p, name);
    if (c[0] === a && c[1] === b) return;
    c[0] = a; c[1] = b;
    gl.uniform2f(loc(p, name), a, b);
  }
  function set3(p, name, v) {
    const c = cell(p, name);
    if (c[0] === v[0] && c[1] === v[1] && c[2] === v[2]) return;
    c[0] = v[0]; c[1] = v[1]; c[2] = v[2];
    gl.uniform3f(loc(p, name), v[0], v[1], v[2]);
  }

  function build() {
    progs = {
      sky: link(gl, QUAD_VS, SKY_FS, ['a_pos']),
      star: link(gl, STAR_VS, STAR_FS, ['a_star', 'a_bright']),
      hor: link(gl, QUAD_VS, HORIZON_FS, ['a_pos']),
      vig: link(gl, QUAD_VS, VIGNETTE_FS, ['a_pos']),
    };
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    starBuf = gl.createBuffer();
    starKey = '';
    starN = 0;
    stats.builds += 1;
  }

  function release() {
    if (!progs) return;
    for (const k of Object.keys(progs)) gl.deleteProgram(progs[k].prog);
    gl.deleteBuffer(quad);
    gl.deleteBuffer(starBuf);
    progs = null;
    quad = null;
    starBuf = null;
  }

  function drawQuad(p) {
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function ensureStars(scene, p) {
    const key = `${scene.w}|${scene.h}|${p.stars}|${p.starSeed}|${scene.horizonV}|${p.starSize}`;
    if (key === starKey) return;
    starKey = key;
    const data = starField({ stars: p.stars, starSeed: p.starSeed, starSize: p.starSize, horizonV: scene.horizonV }, scene.w, scene.h);
    starN = data.length / STAR_STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    stats.starCount = starN;
    stats.uploads += 1;
  }

  function drawBack(scene, params, signal) {
    if (!progs) return;
    const p = params.sky;
    skyUniforms(scene, p, signal, uSky);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const s = progs.sky;
    gl.useProgram(s.prog);
    set2(s, 'u_res', uSky.res[0], uSky.res[1]);
    set1(s, 'u_horizonV', uSky.horizonV);
    set1(s, 'u_midStop', uSky.midStop);
    set3(s, 'u_top', uSky.top);
    set3(s, 'u_mid', uSky.mid);
    set3(s, 'u_bottom', uSky.bottom);
    if (beginRect(gl, scene, ...skyRect(scene))) {
      drawQuad(s);
      endRect(gl);
    }
    if (p.stars <= 0 || uSky.starBright <= 0) return;
    ensureStars(scene, p);
    if (starN <= 0) return;
    const t = progs.star;
    gl.useProgram(t.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    set2(t, 'u_css', scene.w, scene.h);
    set1(t, 'u_dpr', scene.dpr);
    set1(t, 'u_time', uSky.time);
    set1(t, 'u_twinkle', uSky.twinkle);
    set1(t, 'u_bright', uSky.starBright);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STAR_STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, STAR_STRIDE * 4, 16);
    gl.drawArrays(gl.POINTS, 0, starN);
    gl.disableVertexAttribArray(1);
    gl.disable(gl.BLEND);
  }

  function drawFront(scene, params, signal) {
    if (!progs) return;
    const p = params.sky;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    horizonUniforms(scene, p, signal, uHor);
    const hp = progs.hor;
    gl.useProgram(hp.prog);
    set2(hp, 'u_res', uHor.res[0], uHor.res[1]);
    set1(hp, 'u_horizonY', uHor.horizonY);
    set1(hp, 'u_thickPx', uHor.thickPx);
    set1(hp, 'u_glow', uHor.glow);
    set1(hp, 'u_spreadPx', uHor.spreadPx);
    set1(hp, 'u_soft', uHor.soft);
    set1(hp, 'u_bandOn', uHor.bandOn);
    set1(hp, 'u_bandPx', uHor.bandPx);
    set3(hp, 'u_color', uHor.color);
    set3(hp, 'u_bandColor', uHor.bandColor);
    if (beginRect(gl, scene, ...horizonRect(scene, p))) {
      drawQuad(hp);
      endRect(gl);
    }
    vignetteUniforms(scene, p, uVig);
    if (uVig.amount > 0) {
      const vp = progs.vig;
      gl.useProgram(vp.prog);
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      set2(vp, 'u_res', uVig.res[0], uVig.res[1]);
      set1(vp, 'u_amount', uVig.amount);
      set1(vp, 'u_aspect', uVig.aspect);
      countFull(scene);
      drawQuad(vp);
    }
    gl.disable(gl.BLEND);
  }

  build();

  return {
    drawBack,
    drawFront,
    draw(scene, params, signal) {
      drawBack(scene, params, signal);
      drawFront(scene, params, signal);
    },
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      starKey = '';
    },
    rebuild() {
      progs = null;
      build();
    },
    dispose() { release(); },
    get size() { return { w, h, dpr }; },
    stats,
  };
}
