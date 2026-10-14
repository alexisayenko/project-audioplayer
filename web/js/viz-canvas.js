import {
  ATTACK, RELEASE, IDLE_EPSILON, VIZ_FPS, VIZ_DPR_CAP, DPR_CAP, VIZ_HEIGHT_SCALE, TILT_DB_PER_OCT,
} from './viz-constants.js';
import {
  barsDb, unitBars, makeReference, bassEnergy, smoothBars, idleBars, maxOf, makePulse, makePacer, makeGovernor, capDpr, pickSpokes, barCount, shapeBars,
} from './viz-spectrum.js';
import { createTracker, diagnose, debugLines, byteMax, createStatusEl, userAgentFamily, audioOrigin } from './viz-signal.js';
import { createGlow } from './viz-glow.js';
import { readVizColors, FALLBACK_COLORS } from './viz-color.js';
import { drawBars } from './viz-bars.js';
import { createBackdrop } from './viz-backdrop.js';
import { drawRing } from './viz-ring.js';
import { createModeRenderer, MODES, DEFAULT_MODE } from './viz-modes.js';

const SPOKES = 48;
const COLOR_TTL_MS = 5000;
const RING_FRACTION = 0.3;
const ANCHOR_TTL_MS = 500;

export const shouldRun = ({ enabled, active, visible, onScreen, reduced }) => !!(enabled && active && visible && onScreen && !reduced);

function defaults() {
  const win = globalThis;
  return {
    doc: win.document,
    getAnalyser: () => null,
    isPlaying: () => false,
    isVisible: () => !win.document?.hidden,
    reducedQuery: () => win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null,
    isCoarse: () => !!win.matchMedia?.('(pointer: coarse)')?.matches,
    getColors: () => readVizColors(win.getComputedStyle?.(win.document.documentElement), FALLBACK_COLORS),
    getAnchor: () => null,
    getDiag: () => ({}),
    raf: (fn) => win.requestAnimationFrame(fn),
    caf: (id) => win.cancelAnimationFrame?.(id),
    createGLCanvas,
    createOffscreen,
    debug: wantsDebug(win),
    now: () => (win.performance?.now ? win.performance.now() : Date.now()),
    dpr: () => win.devicePixelRatio || 1,
    IntersectionObserver: win.IntersectionObserver,
    ResizeObserver: win.ResizeObserver,
  };
}

function createGLCanvas(canvas) {
  const gl = canvas.ownerDocument?.createElement?.('canvas');
  if (!gl || !canvas.after) return null;
  gl.className = `${canvas.className} viz-canvas-gl`;
  gl.setAttribute('aria-hidden', 'true');
  canvas.after(gl);
  return gl;
}

function createOffscreen(canvas) {
  return canvas.ownerDocument?.createElement?.('canvas') ?? null;
}

const wantsDebug = (win) => /[#?&]vizdebug=1\b/.test(`${win.location?.search ?? ''}${win.location?.hash ?? ''}`);

function spectrumOpts(an) {
  return {
    sampleRate: an.context?.sampleRate || 44100,
    fftSize: an.fftSize || 2048,
    minDb: Number.isFinite(an.minDecibels) ? an.minDecibels : -100,
    maxDb: Number.isFinite(an.maxDecibels) ? an.maxDecibels : -30,
  };
}

const INERT = Object.freeze({
  setEnabled() {}, setMode() {}, setVizMode() {}, setHeightScale() {}, effectiveMode: () => DEFAULT_MODE, refresh() {}, resize() {}, frame() {}, destroy() {}, isRunning: () => false, isReduced: () => false, level: 0,
});

export function createViz({ canvas, mode: startMode = 'background', deps = {} }) {
  const d = { ...defaults(), ...deps };
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return INERT;
  const reducedMql = d.reducedQuery();
  const coarse = d.isCoarse();
  const pacer = makePacer(VIZ_FPS);
  const gov = makeGovernor({ fps: VIZ_FPS });
  const glow = createGlow(() => d.createOffscreen(canvas));
  const backdrop = createBackdrop(() => d.createOffscreen(canvas));
  const dprCap = () => (startMode === 'full' && !coarse ? DPR_CAP : VIZ_DPR_CAP);
  const pulse = makePulse();
  const ref = makeReference();
  const tracker = createTracker();
  const status = d.status ?? createStatusEl(d.doc);
  const st = { bars: new Float32Array(0), buf: null, rot: 0, last: 0, colors: null, colorAt: -Infinity, anchor: null, anchorAt: -Infinity };
  const view = { w: 0, h: 0, dpr: 1 };
  const laKey = {};
  const la = d.lookahead ?? null;
  const laOff = la?.onChange?.(() => { if (raf == null) evaluate(); });
  let enabled = false;
  let mode = startMode;
  let vizMode = DEFAULT_MODE;
  let heightScale = VIZ_HEIGHT_SCALE;
  let renderer = null;
  let glCanvas = null;
  let glObserver = null;
  let avgMs = 0;
  const targets = new Map();
  const f = { c: null, shaped: null, spokes: null, bass: 0, rotation: 0, q: null, now: 0 };
  let onScreen = true;
  let raf = null;
  let running = false;
  const observers = [];

  const reduced = () => !!reducedMql?.matches;
  const bandCount = () => barCount(view.w);
  const energy = () => Math.max(maxOf(st.bars), pulse.value);

  function colors(now) {
    if (!st.colors || now - st.colorAt > COLOR_TTL_MS) { st.colors = d.getColors(); st.colorAt = now; }
    return st.colors;
  }

  function anchor(now) {
    if (now - st.anchorAt > ANCHOR_TTL_MS) { st.anchor = d.getAnchor(); st.anchorAt = now; }
    return st.anchor;
  }

  function ensureBands() {
    const n = bandCount();
    if (st.bars.length !== n) st.bars = new Float32Array(n);
    return n;
  }

  function read(an, n, dt) {
    if (!st.buf || st.buf.length !== an.frequencyBinCount) st.buf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(st.buf);
    if (tracker.record(st.buf).silent) return { target: new Float32Array(n), bass: 0 };
    const o = spectrumOpts(an);
    const levels = barsDb(st.buf, n, { ...o, tilt: TILT_DB_PER_OCT });
    const win = ref.update(levels, dt);
    return { target: unitBars(levels, { ...win }), bass: bassEnergy(st.buf, { ...o, ...win }) };
  }

  function snapshot(playing, an) {
    const diag = d.getDiag();
    const win = globalThis;
    const t = tracker.t;
    let bytes = null;
    if (an && d.debug) {
      if (!st.bytes || st.bytes.length !== an.frequencyBinCount) st.bytes = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(st.bytes);
      bytes = byteMax(st.bytes);
    }
    return {
      ...t, ...audioOrigin(diag.audio, win.location), playing, paused: !!diag.audio?.paused, graphState: diag.graphState ?? 'n/a', ctxState: diag.ctxState ?? 'none',
      hasAnalyser: !!an, fftSize: an?.fftSize, byteMax: bytes, pageOrigin: win.location?.origin, ua: userAgentFamily(win.navigator?.userAgent), frameMs: `${avgMs.toFixed(1)} ms`,
    };
  }

  function publishStatus(playing, an) {
    if (d.debug) { status.set(debugLines(snapshot(playing, an)).join('\n')); return; }
    const diag = d.getDiag();
    status.set(diagnose({
      playing, graphState: diag.graphState, ctxState: diag.ctxState, hasAnalyser: !!an, silentRun: tracker.t.silentRun,
    }).text);
  }

  function step(dt) {
    const n = ensureBands();
    const playing = d.isPlaying();
    const an = playing ? d.getAnalyser() : null;
    let target = new Float32Array(n);
    let bass = 0;
    if (an) ({ target, bass } = read(an, n, dt));
    else {
      ref.reset();
      tracker.lost();
    }
    publishStatus(playing, an);
    smoothBars(st.bars, target, ATTACK, RELEASE, dt * 60);
    pulse.step(bass, dt);
    st.rot += dt * 0.12;
  }

  function draw2d() {
    const { w, h } = view;
    const { c, shaped, spokes, bass, rotation, now } = f;
    if (renderer.id === 'ring') {
      const a = mode === 'full' ? null : anchor(now);
      const r = Math.min(w, h) * RING_FRACTION * heightScale;
      drawRing(ctx, a ? a.x : w / 2, a ? a.y : h / 2, r, spokes, { colors: c, bass, rotation, glow: false, alpha: mode === 'full' ? 1 : 0.5 });
      return;
    }
    if (mode === 'full' && f.q?.backdrop) backdrop.draw(ctx, w, h, c, bass);
    drawBars(ctx, w, h, shaped, {
      colors: c, alpha: mode === 'full' ? 1 : 0.85, dpr: view.dpr, horizon: 0.5, span: heightScale,
    });
  }

  const glScale = () => (mode === 'full' ? 1 : heightScale);

  function layoutGL() {
    if (!glCanvas?.style) return;
    const s = glScale();
    if (mode === 'full') {
      glCanvas.style.height = '100%';
      glCanvas.style.top = '0%';
    } else {
      glCanvas.style.height = `calc(100dvh * ${s})`;
      glCanvas.style.top = `calc(50dvh * ${1 - s})`;
    }
  }

  function removeGL() {
    glObserver?.();
    glObserver = null;
    targets.delete(glCanvas);
    glCanvas?.remove?.();
    glCanvas = null;
  }

  function ensureRenderer() {
    if (renderer) return renderer;
    const wantsGL = MODES.find((m) => m.id === vizMode)?.requiresWebGL;
    if (wantsGL && !glCanvas) {
      glCanvas = d.createGLCanvas?.(canvas) ?? null;
      layoutGL();
      if (glCanvas) glObserver = watch(glCanvas);
    }
    renderer = createModeRenderer(vizMode, canvas, glCanvas, { draw2d, createTerrain: d.createTerrain });
    if (view.w > 0) renderer.resize(view.w, renderer.usesGL ? view.h * glScale() : view.h, view.dpr);
    if (renderer.usesGL) canvas.hidden = true;
    return renderer;
  }

  function dropRenderer() {
    renderer?.dispose();
    renderer = null;
    la?.request(laKey, false);
    if (vizMode !== 'terrain' && glCanvas) removeGL();
  }

  function paint(now, still) {
    const { w, h } = view;
    if (!(w > 0) || !(h > 0)) return;
    ctx.clearRect(0, 0, w, h);
    const q = gov.quality();
    const bars = still ? idleBars(ensureBands(), 0) : st.bars;
    f.q = q;
    f.now = now;
    f.c = colors(now);
    f.bass = still ? 0 : pulse.value;
    f.rotation = still ? 0 : st.rot;
    f.spokes = pickSpokes(bars, SPOKES);
    f.shaped = shapeBars(bars, still ? 0 : now, undefined, f.shaped);
    const r = ensureRenderer();
    r.setQuality(gov.level);
    la?.request(laKey, enabled && r.id === 'terrain');
    r.draw(bars, now, r.id === 'terrain' ? la?.get(now) ?? null : null);
    if (!r.usesGL) glow.apply(ctx, canvas, w, h, q.glow);
    if (d.debug) paintDebug(bars.length);
  }

  function paintDebug(n) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = '11px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${avgMs.toFixed(1)} ms  bars ${n}  L${gov.level}`, 8, 14);
    ctx.restore();
  }

  function clear() {
    if (view.w > 0 && view.h > 0) ctx.clearRect(0, 0, view.w, view.h);
  }

  function active() {
    return shouldRun({
      enabled, active: d.isPlaying() || energy() > IDLE_EPSILON, visible: d.isVisible(), onScreen, reduced: reduced(),
    });
  }

  function stop() {
    if (raf != null) d.caf(raf);
    raf = null;
    running = false;
  }

  function settle() {
    stop();
    if (!enabled || !d.isVisible() || !onScreen) { clear(); return; }
    st.bars = new Float32Array(st.bars.length);
    pulse.reset();
    tracker.lost();
    status.set(d.debug ? debugLines(snapshot(false, null)).join('\n') : '');
    paint(d.now(), true);
  }

  function evaluate() {
    if (active()) {
      if (raf == null) { running = true; raf = d.raf(frame); }
    } else if (running || raf != null || enabled) {
      settle();
    } else {
      clear();
    }
  }

  function frame(ts) {
    raf = null;
    if (pacer.due(ts)) {
      const t0 = d.now();
      const dt = st.last ? Math.min(0.1, Math.max(0.001, (ts - st.last) / 1000)) : 1 / 60;
      st.last = ts;
      step(dt);
      paint(t0, false);
      const work = d.now() - t0;
      avgMs = avgMs ? avgMs * 0.9 + work * 0.1 : work;
      gov.record(work);
    }
    evaluate();
  }

  function resize(cssW, cssH, target = canvas) {
    const dpr = capDpr(d.dpr(), dprCap());
    view.dpr = dpr;
    view.w = Math.max(0, Math.round(cssW));
    view.h = Math.max(0, Math.round(cssH));
    st.colorAt = -Infinity;
    if (target === canvas) {
      canvas.width = Math.round(view.w * dpr);
      canvas.height = Math.round(view.h * dpr);
      ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    } else {
      renderer?.resize(view.w, view.h, dpr);
    }
    st.anchorAt = -Infinity;
    if (raf == null) evaluate();
  }

  function watch(el) {
    const offs = [];
    if (typeof d.ResizeObserver === 'function') {
      const ro = new d.ResizeObserver((entries) => {
        for (const e of entries) {
          if (e.target?.hidden) continue;
          if (e.contentRect) resize(e.contentRect.width, e.contentRect.height, e.target);
        }
      });
      ro.observe(el);
      offs.push(() => ro.disconnect());
    } else if (el.clientWidth) resize(el.clientWidth, el.clientHeight, el);
    if (typeof d.IntersectionObserver === 'function') {
      const io = new d.IntersectionObserver((entries) => {
        for (const e of entries) targets.set(e.target, e.isIntersecting);
        onScreen = [...targets.values()].some(Boolean);
        evaluate();
      });
      io.observe(el);
      offs.push(() => io.disconnect());
    }
    return () => offs.forEach((fn) => fn());
  }

  function observe() {
    observers.push(watch(canvas));
    d.doc?.addEventListener?.('visibilitychange', evaluate);
    reducedMql?.addEventListener?.('change', evaluate);
    observers.push(() => {
      d.doc?.removeEventListener?.('visibilitychange', evaluate);
      reducedMql?.removeEventListener?.('change', evaluate);
    });
  }

  observe();
  return {
    setEnabled(on) { enabled = !!on; if (!enabled) la?.request(laKey, false); evaluate(); },
    setMode(m) { mode = m; st.anchorAt = -Infinity; if (raf == null) evaluate(); },
    setVizMode(id) {
      if (id === vizMode) return;
      vizMode = id;
      dropRenderer();
      if (raf == null) evaluate();
    },
    setHeightScale(s) {
      heightScale = s;
      layoutGL();
      if (renderer?.usesGL) renderer.resize(view.w, view.h * glScale(), view.dpr);
      if (raf == null) evaluate();
    },
    effectiveMode: () => renderer?.id ?? vizMode,
    refresh: evaluate,
    resize,
    frame,
    isRunning: () => raf != null,
    isReduced: reduced,
    get level() { return gov.level; },
    destroy() {
      stop();
      laOff?.();
      observers.forEach((fn) => fn());
      dropRenderer();
      removeGL();
      glow.dispose();
      backdrop.dispose();
      clear();
    },
  };
}
