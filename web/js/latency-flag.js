import { readEnabled } from './perf.js';
import { storeRemove, storeSet } from './storage.js';

export const FLAG_KEY = 'ap2.perf';

let running = null;

/** True when the latency meter is switched on: `localStorage['ap2.perf']` is `1`, or the address has `perf=1` (PLY-212). */
export const meterOn = (win = globalThis) => readEnabled(win);

/** Loads and starts the meter (once). Nothing of it is loaded while it is off. */
export function startMeter({ load = () => import('./latency-meter.js') } = {}) {
  if (running) return running;
  running = load()
    .then((m) => m.startLatencyMeter({ onClose: () => setMeter(false) }))
    .catch(() => { running = null; return null; });
  return running;
}

export function stopMeter() {
  const r = running;
  running = null;
  void r?.then((m) => m?.stop());
}

/** The Settings switch: remembers the choice and starts or stops the meter at once (the full event marks of `perf.js` need a reload). */
export function setMeter(on, deps) {
  if (on) {
    storeSet(FLAG_KEY, '1');
    void startMeter(deps);
  } else {
    storeRemove(FLAG_KEY);
    stopMeter();
  }
}

/** Called once at startup. */
export function bootMeter(deps) {
  if (meterOn()) void startMeter(deps);
}
