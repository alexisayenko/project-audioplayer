export const SYNTH_MAX_DPR = 1.5;
export const SYNTH_HI_DPR = 2;

export function synthQuality(level, flags = {}) {
  const lv = Math.min(2, Math.max(0, Math.round(Number.isFinite(level) ? level : 1)));
  const lite = !!flags.lite;
  const low = lv === 0;
  return {
    level: lv,
    lite,
    half: !!flags.half,
    starsAnimated: lv === 2 && !lite,
    hazeMotion: lv === 2 && !lite,
    sliceDetail: low ? 'low' : 'full',
    sliceScale: low ? 0.5 : 1,
    sliceStepped: low,
    cellMul: low ? 2 : 1,
    glowPasses: lite ? 0 : low ? 1 : 2,
    reflBlur: !lite && !low,
    dprCap: low ? 1 : lv === 2 && flags.hiDpr ? SYNTH_HI_DPR : SYNTH_MAX_DPR,
  };
}
