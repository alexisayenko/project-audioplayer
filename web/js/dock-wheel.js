import { volumePercent, clampVolume } from './volume-logic.js';

export const NOTCH_PX = 100;
export const COARSE_STEP = 0.05;
export const FINE_STEP = 0.01;
export const MIN_DELTA = 0.5;
export const NOTE_MS = 1000;
const LINE_PX = 40;

export function wheelPixels(e, page = 800) {
  const d = Number(e.deltaY) || 0;
  if (e.deltaMode === 1) return d * LINE_PX;
  if (e.deltaMode === 2) return d * page;
  return d;
}

export function attachDockWheel(dock, { player, note, pct, sr, passive = false }) {
  let acc = 0;
  let timer = 0;
  const show = (v) => {
    if (!note) return;
    const p = volumePercent(v);
    pct.textContent = `${p}%`;
    sr.textContent = `Volume ${p}%`;
    note.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => { note.classList.remove('show'); }, NOTE_MS);
  };
  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey || dock.hidden || player.volumeAdjustable === false) return;
    if (e.target?.closest?.('[role="menu"], dialog, .menu')) return;
    const px = wheelPixels(e);
    if (Math.abs(px) < MIN_DELTA) return;
    e.preventDefault();
    acc += px;
    const step = e.shiftKey ? FINE_STEP : COARSE_STEP;
    const notches = Math.trunc(acc / NOTCH_PX);
    if (!notches) return;
    acc -= notches * NOTCH_PX;
    const from = player.muted ? 0 : player.volume;
    const next = clampVolume(Math.round((from - notches * step) * 100) / 100);
    player.setVolume(next);
    show(next);
  };
  dock.addEventListener('wheel', onWheel, { passive });
  return () => { dock.removeEventListener('wheel', onWheel); clearTimeout(timer); };
}
