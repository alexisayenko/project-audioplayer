import { estimateEnvelope, LANE_WINDOW_S, MIN_PERIODS } from './live-bpm.js';
import { liveBpmLabel } from './bpm-label.js';

export const BAND_COUNTS = [4, 6, 8, 12];
export const DEFAULT_BAND_COUNT = 6;
export const LOW_LANE_MAX_HZ = 250;
export const LANE_MIN_PX = 18;
export const LANE_PX = 102;
export const BANDS_H_MIN = 480;
export const BANDS_H_MAX = 1320;
export const BANDS_FOOT = 16;

export function bandRangeText(band) {
  const k = (f) => +(f / 1000).toFixed(2);
  return band.lo >= 1000 && band.hi >= 1000 ? `${k(band.lo)}-${k(band.hi)} kHz` : `${band.lo}-${band.hi} Hz`;
}

const table = (rows) => Object.freeze(rows.map(([name, lo, hi, hint = '']) => {
  const band = { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, lo, hi, hint };
  return Object.freeze({ ...band, range: bandRangeText(band) });
}));

export const BAND_TABLES = Object.freeze({
  4: table([
    ['Sub', 20, 60, 'kick thump'], ['Bass', 60, 250], ['Mids', 250, 2000], ['Highs', 2000, 10000],
  ]),
  6: table([
    ['Sub', 20, 60, 'kick thump'], ['Bass', 60, 150, 'kick, bass'], ['Low-mid', 150, 400, 'snare body'],
    ['Mids', 400, 2000, 'vocals, synths'], ['Presence', 2000, 6000, 'snare crack'], ['Air', 6000, 16000, 'hi-hats'],
  ]),
  8: table([
    ['Sub', 20, 50], ['Kick/Bass', 50, 100], ['Bass/Low', 100, 200], ['Low-mid', 200, 400],
    ['Mids', 400, 800], ['Upper mids', 800, 1600], ['Presence', 1600, 4000], ['Air', 4000, 16000],
  ]),
  12: table([
    ['Sub', 20, 40, 'sub-bass'], ['Kick', 40, 80, 'kick fundamental, bass'], ['Punch', 80, 150, 'kick punch, bass guitar'],
    ['Warmth', 150, 250, 'snare body'], ['Low mids', 250, 400], ['Boxy', 400, 630, 'boxy mids'],
    ['Voice', 630, 1000, 'vocal body'], ['Mids', 1000, 1600], ['Presence', 1600, 2500, 'vocal presence'],
    ['Attack', 2500, 4000, 'snare crack'], ['Hats', 4000, 8000, 'hi-hats, sibilance'], ['Air', 8000, 16000, 'cymbals, air'],
  ]),
});

export const bandsFor = (count) => BAND_TABLES[count] ?? BAND_TABLES[DEFAULT_BAND_COUNT];

export const lowLaneCount = (bands) => {
  let n = 0;
  while (n < bands.length && bands[n].hi <= LOW_LANE_MAX_HZ) n += 1;
  return n;
};

export const bandsHeight = (count) => Math.min(BANDS_H_MAX, Math.max(BANDS_H_MIN, count * LANE_PX));

export const laneHeight = (h, count) => (h - BANDS_FOOT) / count;

export const bandsLabel = (bands) => bands.map((b) => `${b.name} ${b.range}`).join(', ');

export const LANE_ENV_RATE = 200;
export const LANE_UPDATE_MS = 1000;
export const LANE_START_SLACK_S = 0.05;
export const LANE_MIN_CONFIDENCE = 0.5;
export const LANE_RATIO_TOLERANCE = 0.03;
export const LANE_BPM_W = 40;
export const LANE_NO_DATA_TIP = `No regular pattern in the last ${LANE_WINDOW_S} s (needs more than ${MIN_PERIODS} beats)`;
export const LANE_CAPTION = `Each lane shows the repeat rate of its own hits over the last ${LANE_WINDOW_S} s. The kick lane usually matches the main beat; hi-hats often run at 2x or 4x, a snare at 1/2.`;

export const LANE_RATIOS = Object.freeze([
  Object.freeze({ ratio: 2, chip: 'x2', tip: 'twice the main beat' }),
  Object.freeze({ ratio: 4, chip: 'x4', tip: 'four times the main beat' }),
  Object.freeze({ ratio: 0.5, chip: 'x1/2', tip: 'half the main beat' }),
  Object.freeze({ ratio: 0.25, chip: 'x1/4', tip: 'a quarter of the main beat' }),
  Object.freeze({ ratio: 1.5, chip: 'x3/2', tip: 'one and a half times the main beat' }),
]);

const near = (bpm, target) => Math.abs(bpm / target - 1) <= LANE_RATIO_TOLERANCE;

export function laneRelation(main, bpm) {
  if (!(main > 0) || !(bpm > 0)) return { kind: 'none', chip: '', tip: '' };
  if (near(bpm, main)) return { kind: 'same', chip: '', tip: 'the main beat' };
  for (const r of LANE_RATIOS) if (near(bpm, main * r.ratio)) return { kind: 'multiple', chip: r.chip, tip: r.tip };
  return { kind: 'other', chip: '', tip: 'not a simple multiple of the main beat' };
}

export function laneEnvelope(points, rate, windowS, out) {
  const n = Math.round(windowS * rate);
  if (points.length < 2 || out.length < n) return false;
  const end = points[points.length - 1].t;
  const first = end - (n - 1) / rate;
  if (points[0].t > first + LANE_START_SLACK_S) return false;
  out.fill(0, 0, n);
  for (let k = points.length - 1; k >= 0 && points[k].t >= first; k -= 1) {
    if (!points[k].onset) continue;
    const bin = Math.round((points[k].t - first) * rate);
    if (bin < n) out[bin] += points[k].strength;
  }
  return true;
}

export function estimateLane(points, scratch, rate = LANE_ENV_RATE, windowS = LANE_WINDOW_S) {
  if (!laneEnvelope(points, rate, windowS, scratch)) return null;
  const res = estimateEnvelope(scratch.subarray(0, Math.round(windowS * rate)), rate, windowS);
  return res && res.confidence >= LANE_MIN_CONFIDENCE ? res : null;
}

export const laneScratch = (rate = LANE_ENV_RATE, windowS = LANE_WINDOW_S) => new Float32Array(Math.round(windowS * rate));

export const laneBpmText = (res) => (res ? liveBpmLabel(res.bpm) : '-');

export const laneConfidence = (res) => (res ? Math.round(100 * Math.min(1, Math.max(0, res.confidence))) : 0);

export function laneTitle(band, res, rel) {
  if (!res) return `${band.name} ${band.range}: ${LANE_NO_DATA_TIP}`;
  const base = `${band.name} ${band.range}: ${liveBpmLabel(res.bpm)} BPM, confidence ${laneConfidence(res)} percent`;
  return rel.kind === 'none' ? base : `${base}, ${rel.chip ? `${rel.chip}: ${rel.tip}` : rel.tip}`;
}
