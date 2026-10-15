import { clamp01, energyOf, easeEnergy } from './viz-terrain-math.js';

export const SIGNAL_SLOW_S = 1.2;
export const BASS_BINS = 6;
export const FLASH_SWING = 0.25;
export const FLASH_MAX_RATE = 1.5;
export const FLASH_MID = 0.5;
export const FLASH_MIN_GAP_S = 1 / 3;
export const REDUCED_LEVEL = 0.3;

export function limitFlash(prev, target, dtS, gate = null) {
  const p = clamp01(prev);
  const dt = Math.max(0, Math.min(0.5, Number.isFinite(dtS) ? dtS : 0));
  const step = Math.min(FLASH_SWING, FLASH_MAX_RATE * dt);
  let next = p + Math.max(-step, Math.min(step, clamp01(target) - p));
  if (gate) {
    gate.t = Math.max(0, (gate.t ?? 0) - dt);
    if (p < FLASH_MID && next >= FLASH_MID) {
      if (gate.t > 0) next = FLASH_MID - 1e-6;
      else gate.t = FLASH_MIN_GAP_S;
    }
  }
  return next;
}

export function createSignal() {
  const out = { bass: 0, energy: 0, pulse: 0, flash: 0 };
  const still = { bass: REDUCED_LEVEL, energy: REDUCED_LEVEL, pulse: REDUCED_LEVEL, flash: REDUCED_LEVEL };
  const gate = { t: 0 };
  return {
    step(spectrum, dtS, reduced = false) {
      if (reduced) return still;
      const dt = Math.max(0, Math.min(0.5, Number.isFinite(dtS) ? dtS : 0));
      const sp = spectrum || [];
      const n = Math.min(BASS_BINS, sp.length);
      let bass = 0;
      for (let i = 0; i < n; i += 1) bass += clamp01(sp[i]);
      const slow = 1 - Math.exp(-dt / SIGNAL_SLOW_S);
      const raw = energyOf(sp);
      out.bass += ((n ? bass / n : 0) - out.bass) * slow;
      out.energy += (raw - out.energy) * slow;
      out.pulse = easeEnergy(out.pulse, raw, dt);
      out.flash = limitFlash(out.flash, out.pulse, dt, gate);
      return out;
    },
  };
}
