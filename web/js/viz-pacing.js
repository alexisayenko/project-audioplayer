export const FRAME_EMA = 60;
export const GAP_MS = 250;
export const HOLD_FRAMES = 12;
export const REFRESH_RING = 120;
export const REFRESH_FAST_MS = 1000 / 120;
export const REFRESH_SLOW_MS = 1000 / 60;
export const REFRESH_SPLIT_MS = 12.5;
export const REFRESH_STICKY = 2400;
export const PACE_OVER = 1.2;
export const PACE_OK = 1.08;
export const PACE_LITE_S = 0.5;
export const PACE_LITE_OFF_S = 1;
export const PACE_DOWN_S = 2;
export const PACE_UP_S = 5;
export const PACE_SETTLE_S = 3;
export const PACE_BAN_S = 30;
export const PACE_BAN_MAX_S = 480;
export const PACE_TOP = 3;
export const PACE_START = 2;
export const MIN_VALID_FRAMES = 30;

export function makeFrameMeter({ frames = FRAME_EMA, hold = HOLD_FRAMES } = {}) {
  const ring = new Float32Array(REFRESH_RING);
  const sorted = new Float32Array(REFRESH_RING);
  let last = null;
  let ema = 0;
  let skip = 0;
  let n = 0;
  let valid = 0;
  let refresh = REFRESH_SLOW_MS;
  let fastUntil = 0;
  const pickRefresh = () => {
    const len = Math.min(n, REFRESH_RING);
    if (len < 60) return;
    sorted.set(ring.subarray(0, len));
    const view = sorted.subarray(0, len);
    view.sort();
    if (view[len >> 2] < REFRESH_SPLIT_MS) fastUntil = n + REFRESH_STICKY;
    refresh = n < fastUntil ? REFRESH_FAST_MS : REFRESH_SLOW_MS;
  };
  return {
    tick(ts) {
      if (last === null) { last = ts; return null; }
      const dt = ts - last;
      last = ts;
      if (!(dt > 0)) return null;
      if (dt > GAP_MS) { skip = hold; return null; }
      if (skip > 0) { skip -= 1; return null; }
      ema = ema ? ema + (dt - ema) / frames : dt;
      ring[n % REFRESH_RING] = dt;
      n += 1;
      valid += 1;
      if (n % 30 === 0) pickRefresh();
      return dt;
    },
    hold(frames2 = hold) { skip = frames2; valid = 0; },
    reset() { last = null; ema = 0; skip = 0; n = 0; valid = 0; refresh = REFRESH_SLOW_MS; fastUntil = 0; },
    get ema() { return ema; },
    get fps() { return ema > 0 ? 1000 / ema : 0; },
    get refresh() { return refresh; },
    get valid() { return valid >= MIN_VALID_FRAMES; },
  };
}

export function makePaceGovernor({ top = PACE_TOP, start = PACE_START } = {}) {
  let cap = Math.min(top, Math.max(0, start));
  let lite = false;
  let overSince = null;
  let okSince = null;
  let lockUntil = 0;
  const banUntil = new Array(top + 1).fill(0);
  const bans = new Array(top + 1).fill(PACE_BAN_S);
  let liteOkSince = null;
  return {
    update(ts, ema, refresh, valid) {
      let changed = 0;
      if (!valid || !(ema > 0)) { overSince = null; okSince = null; liteOkSince = null; return changed; }
      const over = ema > refresh * PACE_OVER;
      const ok = ema < refresh * PACE_OK;
      if (over) {
        overSince ??= ts;
        okSince = null;
        liteOkSince = null;
        if (ts - overSince >= PACE_LITE_S * 1000) lite = true;
        if (ts - overSince >= PACE_DOWN_S * 1000 && ts >= lockUntil && cap > 0) {
          banUntil[cap] = ts + bans[cap] * 1000;
          bans[cap] = Math.min(PACE_BAN_MAX_S, bans[cap] * 2);
          cap -= 1;
          changed = -1;
          overSince = null;
          lockUntil = ts + PACE_SETTLE_S * 1000;
        }
      } else {
        overSince = null;
        if (ok) {
          okSince ??= ts;
          liteOkSince ??= ts;
          if (lite && ts - liteOkSince >= PACE_LITE_OFF_S * 1000) lite = false;
          if (ts - okSince >= PACE_UP_S * 1000 && cap < top && ts >= banUntil[cap + 1] && ts >= lockUntil) {
            cap += 1;
            changed = 1;
            okSince = null;
            lockUntil = ts + PACE_SETTLE_S * 1000;
          }
        } else {
          okSince = null;
          liteOkSince = null;
        }
      }
      return changed;
    },
    reset() { overSince = null; okSince = null; liteOkSince = null; lite = false; },
    get cap() { return cap; },
    get lite() { return lite; },
    get level() { return Math.min(2, cap); },
    get hiDpr() { return cap >= 3; },
  };
}
