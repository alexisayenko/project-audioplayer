export const SYNTH_MAX_DPR = 1.5;
export const SYNTH_HI_DPR = 2;
export const SHED_MAX = 3;
export const SHED_SCALES = [1, 0.75, 0.6, 0.5];
export const MIN_RENDER_SCALE = 0.4;
export const SHED_STORAGE_KEY = 'ap2.viz.synth.shed';
const PX_BUCKET = 500000;

export const clampShed = (v) => Math.min(SHED_MAX, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));

const bucketOf = (px) => Math.round((Number.isFinite(px) ? px : 0) / PX_BUCKET);

export function loadShed(storage, pixels) {
  try {
    const v = JSON.parse(storage?.getItem?.(SHED_STORAGE_KEY) ?? 'null');
    if (v && v.px === bucketOf(pixels) && Number.isInteger(v.shed)) return clampShed(v.shed);
  } catch {}
  return 0;
}

export function saveShed(storage, pixels, shed) {
  try {
    storage?.setItem?.(SHED_STORAGE_KEY, JSON.stringify({ px: bucketOf(pixels), shed: clampShed(shed) }));
  } catch {}
}

export function renderScaleFor(shed) {
  return Math.max(MIN_RENDER_SCALE, SHED_SCALES[clampShed(shed)]);
}

export function renderSize(cssW, cssH, dpr, scale) {
  const k = dpr * Math.min(1, Math.max(MIN_RENDER_SCALE, Number.isFinite(scale) ? scale : 1));
  return { w: Math.max(1, Math.round(cssW * k)), h: Math.max(1, Math.round(cssH * k)), ratio: k };
}

export function synthQuality(level, flags = {}) {
  const lv = Math.min(2, Math.max(0, Math.round(Number.isFinite(level) ? level : 1)));
  const lite = !!flags.lite;
  const low = lv === 0;
  const shed = clampShed(flags.shed);
  const rings = lite || shed >= 2 ? 0 : low || shed === 1 ? 1 : 2;
  return {
    level: lv,
    lite,
    half: !!flags.half,
    shed,
    renderScale: renderScaleFor(shed),
    starsAnimated: lv === 2 && !lite,
    hazeMotion: lv === 2 && !lite,
    sliceDetail: low ? 'low' : 'full',
    sliceScale: low ? 0.5 : 1,
    sliceStepped: low,
    cellMul: low || shed >= 3 ? 2 : 1,
    glowPasses: rings,
    glowTaps: shed >= 1 ? 2 : 4,
    reflBlur: !lite && !low && shed < 2,
    dprCap: low ? 1 : lv === 2 && flags.hiDpr ? SYNTH_HI_DPR : SYNTH_MAX_DPR,
  };
}
