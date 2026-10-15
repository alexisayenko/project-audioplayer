export function parseColor(text, fallback = [255, 255, 255]) {
  const s = String(text ?? '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export const mixColor = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export const STOP_AT = [0, 0.25, 0.6, 1];

const STOPS = [[255, 31, 142], [255, 61, 115], [255, 106, 82], [255, 154, 58]];

const ICE = {
  stops: [[11, 58, 158], [31, 111, 224], [79, 184, 245], [230, 251, 255]],
  bgTop: [2, 5, 15],
  bgMid: [10, 42, 102],
};

const ICE2 = {
  stops: ['#040d31', '#061a53', '#113b86', '#2464ac', '#3077c2', '#3d8bd9', '#4a9ff0', '#6cc0f5', '#98dcfa', '#d0f4ff', '#f4fdff'].map((h) => parseColor(h)),
  dim: ['#040d31', '#061a53', '#113b86', '#2464ac'].map((h) => parseColor(h)),
  bg: [2, 5, 15],
  ghost: [8, 20, 45],
};

export const FALLBACK_COLORS = {
  a: STOPS[0], b: STOPS[3], stops: STOPS, accent: [87, 211, 233], scrim: [26, 11, 51], line: [255, 255, 255], center: [27, 10, 51], ice: ICE, ice2: ICE2,
};

export function readVizColors(style, fallback) {
  const get = (name, def) => parseColor(style?.getPropertyValue?.(name), def);
  const stops = fallback.stops.map((def, k) => get(`--viz-s${k}`, def));
  return {
    a: stops[0],
    b: stops[3],
    stops,
    accent: get('--accent', fallback.accent),
    scrim: get('--viz-bg-top', fallback.scrim),
    line: get('--viz-line', fallback.line),
    center: get('--viz-bg-center', fallback.center),
    ice: {
      stops: fallback.ice.stops.map((def, k) => get(`--viz-ice-${k}`, def)),
      bgTop: get('--viz-ice-bg-top', fallback.ice.bgTop),
      bgMid: get('--viz-ice-bg-mid', fallback.ice.bgMid),
    },
    ice2: {
      stops: fallback.ice2.stops.map((def, k) => get(`--viz-ice2-${k}`, def)),
      dim: fallback.ice2.dim.map((def, k) => get(`--viz-ice2-dim-${k}`, def)),
      bg: get('--viz-ice2-bg', fallback.ice2.bg),
      ghost: get('--viz-ice2-ghost', fallback.ice2.ghost),
    },
  };
}

export const lighten = (c, t) => mixColor(c, [255, 255, 255], t);

export function barStops(colors) {
  const s = colors.stops ?? [colors.a, mixColor(colors.a, colors.b, 0.3), mixColor(colors.a, colors.b, 0.7), colors.b];
  return s.map((color, k) => ({ at: s.length === STOP_AT.length ? STOP_AT[k] : k / (s.length - 1), color }));
}

export function sampleGradient(stops, t) {
  const x = Math.min(1, Math.max(0, t));
  for (let k = 1; k < stops.length; k += 1) {
    if (x <= stops[k].at) return mixColor(stops[k - 1].color, stops[k].color, (x - stops[k - 1].at) / (stops[k].at - stops[k - 1].at));
  }
  return stops.at(-1).color;
}
