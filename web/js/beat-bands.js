export const BAND_COUNTS = [4, 6, 8, 12];
export const DEFAULT_BAND_COUNT = 6;
export const LOW_LANE_MAX_HZ = 250;
export const LANE_MIN_PX = 18;
export const LANE_PX = 34;
export const BANDS_H_MIN = 160;
export const BANDS_H_MAX = 440;
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
