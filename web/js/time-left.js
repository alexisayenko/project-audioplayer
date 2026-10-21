import { fmtTime } from './dom.js';
import { fmtClock } from './loop-engine.js';

export const TIME_LEFT_KEY = 'ap2.timeLeft';

const known = (dur) => Number.isFinite(dur) && dur > 0;

export function fmtRemaining(cur, dur) {
  if (!known(dur)) return null;
  const pos = Number.isFinite(cur) && cur > 0 ? cur : 0;
  return `-${fmtTime(Math.ceil(Math.max(0, dur - pos) - 1e-9))}`;
}

export function fmtRemainingClock(cur, dur) {
  if (!known(dur)) return null;
  const pos = Number.isFinite(cur) && cur > 0 ? cur : 0;
  return `-${fmtClock(Math.ceil(Math.max(0, dur - pos) * 10 - 1e-9) / 10)}`;
}

let showLeft = false;
try { showLeft = localStorage.getItem(TIME_LEFT_KEY) === '1'; } catch { showLeft = false; }
const listeners = new Set();

export const timeLeftOn = () => showLeft;
export const onTimeLeftChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setTimeLeft(on) {
  showLeft = !!on;
  try { localStorage.setItem(TIME_LEFT_KEY, showLeft ? '1' : '0'); } catch { /* storage unavailable */ }
  for (const fn of listeners) fn(showLeft);
}

export function paintElapsed(btn, elapsedText, remainingText) {
  const left = showLeft && remainingText != null;
  btn.textContent = left ? remainingText : elapsedText;
  btn.disabled = remainingText == null;
  btn.setAttribute('aria-pressed', String(left));
  btn.setAttribute('aria-label', left ? 'Time left, press to show elapsed time' : 'Elapsed time, press to show time left');
}

export function bindElapsed(btn) {
  btn.addEventListener('click', () => setTimeLeft(!showLeft));
  return btn;
}

export function elapsedButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 't-elapsed';
  return bindElapsed(btn);
}
