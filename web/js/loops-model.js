import { MIN_LOOP, validRegion } from './loop-engine.js';

export const MAX_LOOPS = 20;
export const MAX_NAME = 40;
export const FULL_TEXT = `A song can have at most ${MAX_LOOPS} loops. Delete one to save another.`;

const ok = (loops) => ({ ok: true, loops });
const fail = (error) => ({ ok: false, error });
const round3 = (t) => Math.round(t * 1000) / 1000;

export const loopsOf = (song) => (Array.isArray(song?.loops) ? song.loops : []);

export function defaultName(loops) {
  const used = new Set(loops.map((l) => l.name));
  let n = 1;
  while (used.has(`Loop ${n}`)) n += 1;
  return `Loop ${n}`;
}

export function cleanName(name) {
  return String(name ?? '').trim().slice(0, MAX_NAME);
}

export function addLoop(loops, region, duration, name = '') {
  if (loops.length >= MAX_LOOPS) return fail(FULL_TEXT);
  if (!validRegion(region, duration + 1)) return fail('Mark a start and an end first.');
  const twin = loops.find((l) => sameRegion(l, region));
  if (twin) return fail(`Already saved as ${twin.name}.`);
  const label = cleanName(name) || defaultName(loops);
  return ok([...loops, { name: label, start: round3(region.start), end: round3(region.end) }]);
}

export function renameLoop(loops, index, name) {
  if (!loops[index]) return fail('That loop is gone.');
  const label = cleanName(name);
  if (!label) return fail('A loop needs a name.');
  return ok(loops.map((l, i) => (i === index ? { ...l, name: label } : l)));
}

export function removeLoop(loops, index) {
  if (!loops[index]) return fail('That loop is gone.');
  return ok(loops.filter((_, i) => i !== index));
}

export function sameRegion(a, b) {
  return !!a && !!b && Math.abs(a.start - b.start) < 0.005 && Math.abs(a.end - b.end) < 0.005;
}

export const MIN_LENGTH = MIN_LOOP;
