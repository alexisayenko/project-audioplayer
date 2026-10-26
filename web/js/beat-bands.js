import { gt, gte } from './cmp.js';
import { estimateIntervals, MIN_PERIODS } from './live-bpm.js';
import { liveBpmLabel } from './bpm-label.js';

export const BAND_COUNTS = [4, 6, 8, 12, 16, 24];
export const DEFAULT_BAND_COUNT = 6;
export const LOW_LANE_MAX_HZ = 250;
export const LANE_MIN_PX = 18;
export const LANE_PX = 108;
export const BANDS_H_MIN = 480;
export const PHONE_CAP_MAX_COUNT = 12;
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
  // 16 and 24: roughly log-spaced (ratio 1.52 and 1.32) 20 Hz to 16 kHz, edges hand-rounded. The mic FFT is 16384
  // (bin 2.7 to 2.9 Hz at 44.1 and 48 kHz), so the lowest 24-band lane 20-26 Hz is the narrowest at 2 bins and no two
  // lanes share a bin (checked for both rates in the tests).
  16: table([
    ['Sub', 20, 30], ['Sub-bass', 30, 45], ['Kick', 45, 70, 'kick fundamental'], ['Bass', 70, 105, 'bass guitar'],
    ['Upper bass', 105, 160, 'kick punch'], ['Warmth', 160, 240, 'snare body'], ['Low mids', 240, 370], ['Boxy', 370, 560, 'boxy mids'],
    ['Body', 560, 850], ['Voice', 850, 1300, 'vocal body'], ['Upper mids', 1300, 2000], ['Presence', 2000, 2900, 'vocal presence'],
    ['Attack', 2900, 4400, 'snare crack'], ['Bite', 4400, 7000], ['Hats', 7000, 10400, 'hi-hats, sibilance'], ['Air', 10400, 16000, 'cymbals, air'],
  ]),
  24: table([
    ['Sub', 20, 26], ['Sub-bass', 26, 34], ['Deep kick', 34, 45], ['Kick', 45, 60, 'kick fundamental'], ['Kick/bass', 60, 80],
    ['Bass', 80, 105, 'bass guitar'], ['Upper bass', 105, 140, 'kick punch'], ['Low warmth', 140, 185], ['Warmth', 185, 245, 'snare body'],
    ['Low mids', 245, 320], ['Mud', 320, 425], ['Boxy', 425, 560, 'boxy mids'], ['Body', 560, 740], ['Honk', 740, 980],
    ['Voice', 980, 1300, 'vocal body'], ['Upper mids', 1300, 1700], ['Clarity', 1700, 2200], ['Presence', 2200, 2900, 'vocal presence'],
    ['Attack', 2900, 3900, 'snare crack'], ['Bite', 3900, 5200], ['Sibilance', 5200, 6900], ['Hats', 6900, 8800, 'hi-hats'],
    ['Sheen', 8800, 11800], ['Air', 11800, 16000, 'cymbals, air'],
  ]),
});

export const bandsFor = (count) => BAND_TABLES[count] ?? BAND_TABLES[DEFAULT_BAND_COUNT];

export const lowLaneCount = (bands) => {
  let n = 0;
  while (n < bands.length && bands[n].hi <= LOW_LANE_MAX_HZ) n += 1;
  return n;
};

export const bandsHeight = (count) => Math.max(BANDS_H_MIN, count * LANE_PX);

export const bandsPhoneCapped = (count) => count <= PHONE_CAP_MAX_COUNT;

export const laneHeight = (h, count) => (h - BANDS_FOOT) / count;

export const bandsLabel = (bands) => bands.map((b) => `${b.name} ${b.range}`).join(', ');

export const LANE_UPDATE_MS = 1000;
export const LANE_START_SLACK_S = 0.05;
export { IOI_MIN_CONFIDENCE as LANE_MIN_CONFIDENCE } from './live-bpm.js';
export const LANE_RATIO_TOLERANCE = 0.03;
export const LANE_WINDOWS_S = Object.freeze([1, 4, 8, 15, 30]);
export const LANE_WINDOW_DEFAULT_S = 4;
export const LANE_HISTORY_S = 30;
export const LANE_WINDOW_LABELS = Object.freeze({ 1: '1 s', 4: '4 s', 8: '8 s', 15: '15 s', 30: '30 s' });
export const laneWindowFor = (s) => (LANE_WINDOWS_S.includes(s) ? s : LANE_WINDOW_DEFAULT_S);
export const laneNoDataTip = (windowS) => `No regular pattern in the last ${windowS} s (needs more than ${MIN_PERIODS} repeats)`;
export const laneCaption = (windowS) => `Each lane shows the repeat rate of its own hits over the last ${windowS} s, read from the gaps between hits. The kick lane usually matches the main beat; hi-hats often run at 2x or 4x, a snare at 1/2.`;

export const LANE_RATIOS = Object.freeze([
  Object.freeze({ ratio: 2, chip: 'x2', tip: 'twice the main beat' }),
  Object.freeze({ ratio: 4, chip: 'x4', tip: 'four times the main beat' }),
  Object.freeze({ ratio: 0.5, chip: 'x1/2', tip: 'half the main beat' }),
  Object.freeze({ ratio: 0.25, chip: 'x1/4', tip: 'a quarter of the main beat' }),
  Object.freeze({ ratio: 1.5, chip: 'x3/2', tip: 'one and a half times the main beat' }),
]);

const near = (bpm, target) => Math.abs(bpm / target - 1) <= LANE_RATIO_TOLERANCE;

export function laneRelation(main, bpm) {
  if (!gt(main, 0) || !gt(bpm, 0)) return { kind: 'none', chip: '', tip: '' };
  if (near(bpm, main)) return { kind: 'same', chip: '', tip: 'the main beat' };
  for (const r of LANE_RATIOS) if (near(bpm, main * r.ratio)) return { kind: 'multiple', chip: r.chip, tip: r.tip };
  return { kind: 'other', chip: '', tip: 'not a simple multiple of the main beat' };
}

export function estimateLane(onsets, now, start, windowS = LANE_WINDOW_DEFAULT_S) {
  if (!gte(now - start, windowS - LANE_START_SLACK_S)) return null;
  const from = now - windowS;
  let first = onsets.length;
  while (first > 0 && onsets[first - 1].t >= from) first -= 1;
  const count = onsets.length - first;
  const times = new Array(count);
  const strengths = new Array(count);
  for (let i = 0; i < count; i += 1) {
    times[i] = onsets[first + i].t - from;
    strengths[i] = onsets[first + i].strength;
  }
  return estimateIntervals(times, strengths, windowS);
}

export const laneBpmText = (res) => (res ? liveBpmLabel(res.bpm) : '-');

export const laneConfidence = (res) => (res ? Math.round(100 * Math.min(1, Math.max(0, res.confidence))) : 0);

export function laneTitle(band, res, rel, windowS = LANE_WINDOW_DEFAULT_S) {
  if (!res) return `${band.name} ${band.range}: ${laneNoDataTip(windowS)}`;
  const base = `${band.name} ${band.range}: ${liveBpmLabel(res.bpm)} BPM, confidence ${laneConfidence(res)} percent`;
  if (rel.kind === 'none') return base;
  const relText = rel.chip ? `${rel.chip}: ${rel.tip}` : rel.tip;
  return `${base}, ${relText}`;
}
