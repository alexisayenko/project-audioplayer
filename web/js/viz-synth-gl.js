import {
  HISTORY_BINS, ROWS_PER_SECOND, createFrame, createSeries, makeRowClock, fillLiveFrame, fillLookFrame, blendFrames, rowLayout, gridDims, gridHalfWidth,
  clamp01, resample,
} from './viz-terrain-math.js';
import { linkProgram } from './viz-terrain-gl.js';
import { fillSynthHeights, futureHeights, futureLayout } from './viz-synth-field.js';
import { getSynth, parseHex } from './viz-synth-settings.js';
import { createSignal } from './viz-synth-signal.js';
import { synthQuality, clampShed, renderSize } from './viz-synth-quality.js';
import { newFill } from './viz-synth-fill.js';
import { createSkyPass } from './viz-synth-sky.js';
import { createSunPass } from './viz-synth-sun.js';
import { createGroundPass } from './viz-synth-ground.js';

const LOOK_BLEND_S = 1;
const MAX_LEVEL = 2;
const RESTORE_TIMEOUT_MS = 3000;
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const PASS_ORDER = ['sky', 'sun', 'ground'];

const DEFAULT_PASSES = { sky: createSkyPass, sun: createSunPass, ground: createGroundPass };

function getContext(canvas) {
  const attrs = { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'low-power' };
  return canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
}

const clampLevel = (v) => Math.min(MAX_LEVEL, Math.max(0, Math.round(Number.isFinite(v) ? v : 1)));

export function createSynth(canvas, opts = {}) {
  const gl = opts.gl || getContext(canvas);
  if (!gl) return null;
  const onError = opts.onError || (() => {});
  const readSettings = opts.settings || getSynth;
  const factories = { ...DEFAULT_PASSES, ...(opts.passes || {}) };
  const view = { w: canvas.width || 1, h: canvas.height || 1, dpr: 1, ratio: 1 };
  const s = {
    level: clampLevel(opts.quality ?? 1),
    lite: false,
    shed: clampShed(opts.shed ?? 0),
    hiDpr: false,
    fill: { px: 0, quads: 0, ratio: 0 },
    lost: false,
    disposed: false,
    css: null,
    series: createSeries(),
    clock: makeRowClock(),
    signal: createSignal(),
    lookFrame: null,
    liveFrame: null,
    heights: null,
    future: null,
    dims: null,
    lookAt: null,
    lastT: null,
    reducedFlag: false,
    drawn: null,
    builds: 0,
    ah: { timeline: null, time: 0 },
    lat: { rows: 0, cols: 0, hw: 0, dz: 0, data: null, future: null },
  };
  s.q = synthQuality(s.level, { lite: false, hiDpr: false, shed: s.shed });
  const scene = { w: 1, h: 1, dpr: 1, aspect: 1, res: [1, 1], horizonV: 0.4, time: 0, dt: 0, reduced: false, q: s.q, fill: newFill() };
  let passes = null;
  let mq = null;
  let restoreTimer = null;

  const isReduced = () => {
    if (typeof opts.reduced === 'function') return !!opts.reduced();
    if (typeof opts.reduced === 'boolean') return opts.reduced;
    return s.reducedFlag;
  };

  function buildPasses() {
    const made = {};
    try {
      for (const k of PASS_ORDER) made[k] = factories[k](gl, { linkProgram });
    } catch (err) {
      for (const p of Object.values(made)) p?.dispose?.();
      throw err;
    }
    passes = made;
    s.builds += 1;
    for (const k of PASS_ORDER) if (s.css) passes[k].resize?.(s.css.w, s.css.h, view.dpr);
  }

  function releasePasses() {
    if (!passes) return;
    for (const k of PASS_ORDER) passes[k]?.dispose?.();
    passes = null;
  }

  function refreshQuality() {
    s.q = synthQuality(s.level, { lite: s.lite, hiDpr: s.hiDpr, shed: s.shed });
    scene.q = s.q;
  }

  function allocate(aspect) {
    const d = gridDims(s.level, aspect);
    const key = `${d.rows}x${d.cols}`;
    if (s.dims && s.dims.key === key) return s.dims;
    s.dims = { rows: d.rows, cols: d.cols, key };
    s.liveFrame = createFrame(d.rows);
    s.lookFrame = createFrame(d.rows);
    s.heights = new Float32Array(d.rows * d.cols);
    s.future = new Float32Array(d.rows * d.cols);
    s.lat.future = null;
    s.clock.reset();
    return s.dims;
  }

  function updateHeights(sec, ahead, settings) {
    const { rows, cols } = s.dims;
    let tl = null;
    let k = 0;
    if (ahead?.timeline) {
      tl = ahead.timeline;
      if (s.lookAt === null) s.lookAt = sec;
      k = clamp01((sec - s.lookAt) / LOOK_BLEND_S);
    } else s.lookAt = null;
    let info = fillLiveFrame(s.liveFrame, s.series, sec);
    if (tl) {
      const li = fillLookFrame(s.lookFrame, tl, ahead.time);
      blendFrames(s.liveFrame, s.lookFrame, k);
      info = { base: k >= 1 ? li.base : info.base, frac: info.frac + (li.frac - info.frac) * k };
    }
    const p = settings.terrain;
    fillSynthHeights(s.liveFrame, cols, sec, p, s.heights);
    const fl = futureLayout(rows, p);
    const wantFuture = p.future && p.futureOpacity > 0;
    if (wantFuture) futureHeights(s.liveFrame, cols, sec, p, s.future, s.heights);
    const lat = s.lat;
    lat.rows = rows;
    lat.cols = cols;
    lat.hw = gridHalfWidth(scene.aspect);
    lat.dz = rowLayout(rows).dz;
    lat.data = s.heights;
    if (wantFuture) {
      if (!lat.future || lat.future.length !== fl.n * cols) lat.future = s.future.subarray(0, fl.n * cols);
    } else lat.future = null;
    passes.ground.setHeights(lat, info.base + info.frac, scene, settings);
  }

  function sameFrame(settings, reduced) {
    const d = s.drawn;
    return !!d && d.settings === settings && d.w === view.w && d.h === view.h && d.level === s.level && d.lite === s.lite && d.shed === s.shed && d.dpr === view.dpr && d.reduced === reduced;
  }

  function draw(spectrum, t = 0, aheadIn = null, latS = 0) {
    if (s.lost || s.disposed || !passes) return;
    const settings = readSettings();
    const reduced = isReduced();
    if (reduced && sameFrame(settings, reduced)) return;
    const lat = Number.isFinite(latS) ? latS : 0;
    let ahead = null;
    if (aheadIn?.timeline) {
      s.ah.timeline = aheadIn.timeline;
      s.ah.time = aheadIn.time - lat;
      ahead = s.ah;
    }
    const sp = spectrum || [];
    const sec = (Number.isFinite(t) ? t : 0) / 1000;
    const dtS = s.lastT === null ? 0 : Math.max(0, Math.min(0.5, (t - s.lastT) / 1000));
    s.lastT = t;
    const step = s.clock.advance(t);
    const gap = 1000 / ROWS_PER_SECOND;
    const pushes = reduced ? 1 : step.pushes;
    for (let i = 0; i < pushes; i += 1) s.series.push(resample(sp, HISTORY_BINS), (t - (pushes - 1 - i) * gap) / 1000);
    const signal = s.signal.step(sp, dtS, reduced);
    scene.w = s.css?.w ?? view.w / view.dpr;
    scene.h = s.css?.h ?? view.h / view.dpr;
    scene.dpr = view.ratio;
    scene.aspect = view.w / view.h;
    scene.res[0] = view.w;
    scene.res[1] = view.h;
    scene.horizonV = settings.sky.horizonV;
    scene.time = reduced ? 0 : sec % 600;
    scene.dt = reduced ? 0 : dtS;
    scene.reduced = reduced;
    scene.q = s.q;
    scene.fill.px = 0;
    scene.fill.quads = 0;
    allocate(scene.aspect);
    updateHeights(sec - lat, ahead, settings);
    const c = parseHex(settings.sky.bottom);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, view.w, view.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    scene.fill.px += view.w * view.h;
    scene.fill.quads += 1;
    const { sky, sun, ground } = passes;
    sky.drawBack(scene, settings, signal);
    sun.drawHaze(scene, settings.sun, signal);
    sun.drawSun(scene, settings.sun, signal);
    ground.drawHills(scene, settings, signal);
    ground.drawFloor(scene, settings, signal);
    sun.drawReflection(scene, settings.sun, signal);
    ground.drawTerrain(scene, settings, signal);
    sky.drawFront(scene, settings, signal);
    s.fill.px = scene.fill.px;
    s.fill.quads = scene.fill.quads;
    s.fill.ratio = scene.fill.px / (view.w * view.h);
    if (reduced) s.drawn = { settings, w: view.w, h: view.h, level: s.level, lite: s.lite, shed: s.shed, dpr: view.dpr, reduced };
    else s.drawn = null;
  }

  function resize(w, h, dpr = 1) {
    s.css = { w, h, dpr };
    view.dpr = Math.min(s.q.dprCap, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
    const size = renderSize(w, h, view.dpr, s.q.renderScale);
    view.w = size.w;
    view.h = size.h;
    view.ratio = size.ratio;
    canvas.width = view.w;
    canvas.height = view.h;
    s.drawn = null;
    s.clock.reset();
    if (passes && !s.lost) for (const k of PASS_ORDER) passes[k].resize?.(w, h, view.dpr);
  }

  function setDprCap(hi) {
    const on = !!hi;
    if (on === s.hiDpr) return;
    s.hiDpr = on;
    refreshQuality();
    if (s.css) resize(s.css.w, s.css.h, s.css.dpr);
  }

  function setLite(on) {
    const v = !!on;
    if (v === s.lite) return;
    s.lite = v;
    refreshQuality();
    s.drawn = null;
  }

  function setShed(n) {
    const next = clampShed(n);
    if (next === s.shed) return;
    s.shed = next;
    refreshQuality();
    s.drawn = null;
    if (s.css) resize(s.css.w, s.css.h, s.css.dpr);
  }

  function setQuality(level) {
    const next = clampLevel(level);
    if (next === s.level) return;
    s.level = next;
    refreshQuality();
    s.dims = null;
    s.drawn = null;
    s.clock.reset();
    if (s.css) resize(s.css.w, s.css.h, s.css.dpr);
  }

  function clearRestoreTimer() {
    if (restoreTimer !== null) globalThis.clearTimeout?.(restoreTimer);
    restoreTimer = null;
  }

  function dispose() {
    if (s.disposed) return;
    s.disposed = true;
    clearRestoreTimer();
    canvas.removeEventListener?.('webglcontextlost', onLost);
    canvas.removeEventListener?.('webglcontextrestored', onRestored);
    mq?.removeEventListener?.('change', onMq);
    if (!s.lost) releasePasses();
    passes = null;
  }

  function onLost(e) {
    e?.preventDefault?.();
    s.lost = true;
    clearRestoreTimer();
    restoreTimer = globalThis.setTimeout?.(() => {
      restoreTimer = null;
      if (s.lost && !s.disposed) onError(new Error('webgl context not restored'));
    }, RESTORE_TIMEOUT_MS) ?? null;
    restoreTimer?.unref?.();
  }

  function onRestored() {
    clearRestoreTimer();
    if (s.disposed) return;
    try {
      for (const k of PASS_ORDER) passes[k].rebuild();
      s.builds += 1;
      s.lost = false;
      s.drawn = null;
      s.clock.reset();
      s.lastT = null;
    } catch (err) {
      onError(err);
    }
  }

  function onMq(e) {
    s.reducedFlag = !!e.matches;
    s.drawn = null;
  }

  try {
    mq = globalThis.matchMedia?.(REDUCED_QUERY) ?? null;
    s.reducedFlag = !!mq?.matches;
    mq?.addEventListener?.('change', onMq);
    buildPasses();
  } catch (err) {
    mq?.removeEventListener?.('change', onMq);
    releasePasses();
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
    setLite,
    setShed,
    setDprCap,
    dispose,
    get quality() { return s.level; },
    get stats() {
      const g = passes?.ground?.stats;
      return {
        level: s.level, tiers: g?.tiers ?? 0, vertices: g?.vertices ?? 0, dpr: view.dpr, lite: s.lite, w: view.w, h: view.h, builds: s.builds,
        shed: s.shed, scale: s.q.renderScale, quads: s.fill.quads, fill: s.fill.ratio, glowRings: s.q.glowPasses, glowTaps: s.q.glowTaps,
      };
    },
    get lost() { return s.lost; },
  };
}
