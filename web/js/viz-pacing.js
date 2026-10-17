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
export const PACE_BAN_MAX_S = 120;
export const PACE_BAN_RESET_S = 60;
export const PACE_GRACE_S = 8;
export const PACE_TOP = 3;
export const PACE_START = 2;
export const MIN_VALID_FRAMES = 30;
export const TERRAIN_TARGET_FPS = 60;
export const HALF_RATE_FPS = 30;
export const LOW_BATTERY_LEVEL = 0.2;

export function targetIntervalMs({ terrain = false, refreshMs = REFRESH_SLOW_MS, half = false, lowPower = false, reduced = false, baseFps = HALF_RATE_FPS } = {}) {
  if (!terrain) return 1000 / baseFps;
  if (half || lowPower || reduced) return 1000 / HALF_RATE_FPS;
  const refresh = Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : REFRESH_SLOW_MS;
  return Math.max(refresh, 1000 / TERRAIN_TARGET_FPS);
}

export function watchLowPower(nav = globalThis.navigator) {
  const st = { low: false };
  try {
    const p = nav?.getBattery?.();
    p?.then?.((b) => {
      const upd = () => { st.low = !b.charging && b.level < LOW_BATTERY_LEVEL; };
      upd();
      b.addEventListener?.('chargingchange', upd);
      b.addEventListener?.('levelchange', upd);
    }).catch?.(() => {});
  } catch {}
  return st;
}

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
      if (Number.isNaN(dt) || dt <= 0) return null;
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
    restart(frames2 = 3) { skip = frames2; valid = 0; ema = 0; },
    reset() { last = null; ema = 0; skip = 0; n = 0; valid = 0; refresh = REFRESH_SLOW_MS; fastUntil = 0; },
    get ema() { return ema; },
    get fps() { return ema > 0 ? 1000 / ema : 0; },
    get refresh() { return refresh; },
    get valid() { return valid >= MIN_VALID_FRAMES; },
  };
}

export function makePaceGovernor({ top = PACE_TOP, start = PACE_START, shedMax = 0, shedStart = 0 } = {}) {
  let cap = Math.min(top, Math.max(-1, start));
  let shedTop = Math.max(0, Math.floor(shedMax));
  let shed = Math.min(shedTop, Math.max(0, Math.floor(shedStart)));
  const shedBanUntil = new Array(16).fill(0);
  const shedBans = new Array(16).fill(PACE_BAN_S);
  let lite = false;
  let overSince = null;
  let okSince = null;
  let lockUntil = 0;
  const banUntil = new Array(top + 2).fill(0);
  const bans = new Array(top + 2).fill(PACE_BAN_S);
  let liteOkSince = null;
  let graceUntil = 0;
  let pendingGrace = null;
  let stableSince = null;
  let note = null;
  const downNote = (ts, ema, target, suffix, banS) => ({ dir: -1, at: ts, text: `interval ${ema.toFixed(1)} ms > ${(target * PACE_OVER).toFixed(1)} ms for ${((ts - overSince) / 1000).toFixed(1)} s${suffix}`, banS });
  const upNote = (ts, ema, target, suffix) => ({ dir: 1, at: ts, text: `interval ${ema.toFixed(1)} ms < ${(target * PACE_OK).toFixed(1)} ms for ${((ts - okSince) / 1000).toFixed(1)} s${suffix}`, banS: 0 });
  const settle = (ts) => { lockUntil = ts + PACE_SETTLE_S * 1000; };
  const onOver = (ts, ema, target) => {
    overSince ??= ts;
    okSince = null;
    liteOkSince = null;
    if (ts - overSince >= PACE_LITE_S * 1000) lite = true;
    if (!(ts - overSince >= PACE_DOWN_S * 1000 && ts >= lockUntil)) return 0;
    if (shed < shedTop) {
      note = downNote(ts, ema, target, ' (render scale)', shedBans[shed]);
      stableSince = null;
      shedBanUntil[shed] = ts + shedBans[shed] * 1000;
      shedBans[shed] = Math.min(PACE_BAN_MAX_S, shedBans[shed] * 2);
      shed += 1;
    } else if (cap > -1 && (cap > 0 || lite)) {
      note = downNote(ts, ema, target, '', bans[cap + 1]);
      stableSince = null;
      banUntil[cap + 1] = ts + bans[cap + 1] * 1000;
      bans[cap + 1] = Math.min(PACE_BAN_MAX_S, bans[cap + 1] * 2);
      cap -= 1;
    } else return 0;
    overSince = null;
    settle(ts);
    return -1;
  };
  const onUnder = (ts, ema, target, ok) => {
    overSince = null;
    if (!ok) {
      okSince = null;
      liteOkSince = null;
      return 0;
    }
    okSince ??= ts;
    liteOkSince ??= ts;
    if (lite && ts - liteOkSince >= PACE_LITE_OFF_S * 1000) lite = false;
    const climbCap = cap < (shedTop > 0 ? Math.min(top, 2) : top);
    if (!(ts - okSince >= PACE_UP_S * 1000)) return 0;
    if (!climbCap && shed > 0 && ts >= shedBanUntil[shed - 1] && ts >= lockUntil) {
      note = upNote(ts, ema, target, ' (render scale)');
      shed -= 1;
    } else if (cap < top && (climbCap || shed === 0) && ts >= banUntil[cap + 2] && ts >= lockUntil) {
      note = upNote(ts, ema, target, '');
      cap += 1;
    } else return 0;
    okSince = null;
    settle(ts);
    return 1;
  };
  return {
    grace(ms = PACE_GRACE_S * 1000) { pendingGrace = Math.max(pendingGrace ?? 0, ms); },
    update(ts, ema, target, valid) {
      let changed = 0;
      if (pendingGrace !== null) { graceUntil = Math.max(graceUntil, ts + pendingGrace); pendingGrace = null; }
      if (ts < graceUntil) { overSince = null; okSince = null; liteOkSince = null; stableSince = null; return changed; }
      if (!valid || !(ema > 0)) { overSince = null; okSince = null; liteOkSince = null; return changed; }
      const over = ema > target * PACE_OVER;
      const ok = ema < target * PACE_OK;
      if (!over) {
        stableSince ??= ts;
        if (ts - stableSince >= PACE_BAN_RESET_S * 1000) { bans.fill(PACE_BAN_S); stableSince = ts; }
      }
      if (over) changed = onOver(ts, ema, target);
      else changed = onUnder(ts, ema, target, ok);
      return changed;
    },
    configure({ shedMax: m = shedTop, shed: n = shed } = {}) {
      shedTop = Math.max(0, Math.floor(m));
      shed = Math.min(shedTop, Math.max(0, Math.floor(n)));
      shedBanUntil.fill(0);
      shedBans.fill(PACE_BAN_S);
    },
    reset() { overSince = null; okSince = null; liteOkSince = null; stableSince = null; lite = false; },
    info(ts) {
      const banLeft = Math.max(0, ...banUntil.map((u) => u - ts)) / 1000;
      const graceLeft = Math.max(0, graceUntil - ts) / 1000;
      return { note, ago: note ? (ts - note.at) / 1000 : null, banLeft, graceLeft };
    },
    get cap() { return Math.max(0, cap); },
    get rung() { return cap; },
    get half() { return cap < 0; },
    get lite() { return lite; },
    get level() { return Math.min(2, Math.max(0, cap)); },
    get hiDpr() { return cap >= 3 && shed === 0; },
    get shed() { return shed; },
    get shedMax() { return shedTop; },
    get exhausted() { return shed >= shedTop && cap < 0; },
  };
}
