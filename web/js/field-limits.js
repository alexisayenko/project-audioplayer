export const FIELD_MARGIN = 0.2;

const axisLimits = (values, minSpan, floor) => {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * FIELD_MARGIN;
  lo -= pad;
  hi += pad;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (floor !== undefined && lo < floor) {
    hi += floor - lo;
    lo = floor;
  }
  return { lo, hi };
};

export function fieldLimits(points, { minSpanX = 10, minSpanY = 40, floorY, fallback } = {}) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return fallback ?? null;
  return {
    x: axisLimits(pts.map((p) => p.x), minSpanX),
    y: axisLimits(pts.map((p) => p.y), minSpanY, floorY),
  };
}

export function clampRange(lo, hi, bounds) {
  if (!bounds) return { lo, hi };
  const span = hi - lo;
  if (span >= bounds.hi - bounds.lo) return { lo: bounds.lo, hi: bounds.hi };
  const nlo = Math.min(bounds.hi - span, Math.max(bounds.lo, lo));
  return { lo: nlo, hi: nlo + span };
}
