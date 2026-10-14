export const SYNC_LIMITS_MS = [-300, 300];
export const LATENCY_MAX_S = 0.5;

export function outputLatencyS(ctx) {
  const part = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);
  return Math.min(LATENCY_MAX_S, part(ctx?.outputLatency) + part(ctx?.baseLatency));
}

export const nowTime = (audioTimeS, autoS, trimMs) => audioTimeS - autoS - (Number.isFinite(trimMs) ? trimMs : 0) / 1000;
