import { el } from './dom.js';
import { icon } from './icons.js';

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 80;

export function stepper({ id, label, min, max, step = 1, get, set, unit, inputmode, decLabel, incLabel }) {
  const snap = (v) => {
    const n = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
    return +n.toFixed(6) || 0;
  };
  const input = el('input', { id, class: 'hm-step-num', type: 'number', min: String(min), max: String(max), step: String(step), value: String(get()), ...(inputmode ? { inputmode } : {}) });
  const button = (name, text) => el('button', { class: 'btn hm-step-btn', type: 'button', 'aria-label': text, 'aria-controls': id }, icon(name, 'action'));
  const dec = button('minus', decLabel);
  const inc = button('plus', incLabel);
  const unitNode = unit ? el('span', { class: 'hm-step-unit t-subhead muted', 'aria-hidden': 'true' }, unit) : null;
  const group = el('div', { class: 'hm-stepper', role: 'group', 'aria-label': label }, dec, input, inc, unitNode);

  const bump = (dir) => {
    if (input.disabled) return;
    const next = snap(get() + dir * step);
    if (next !== get()) set(next);
  };
  let delayTimer = null;
  let repeatTimer = null;
  const stopHold = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    delayTimer = null;
    repeatTimer = null;
  };
  const wire = (btn, dir) => {
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      stopHold();
      bump(dir);
      try { btn.setPointerCapture?.(ev.pointerId); } catch { /* capture is optional */ }
      delayTimer = setTimeout(() => { repeatTimer = setInterval(() => bump(dir), HOLD_REPEAT_MS); }, HOLD_DELAY_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) btn.addEventListener(type, stopHold);
    btn.addEventListener('click', (ev) => { if (ev.detail === 0) bump(dir); });
  };
  wire(dec, -1);
  wire(inc, 1);

  input.addEventListener('input', () => {
    const v = Number.parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    if (v < min || v > max) { input.setAttribute('aria-invalid', 'true'); return; }
    input.removeAttribute('aria-invalid');
    const next = snap(v);
    if (next !== get()) set(next);
  });
  input.addEventListener('change', () => {
    input.removeAttribute('aria-invalid');
    const v = Number.parseFloat(input.value);
    const next = Number.isFinite(v) ? snap(v) : get();
    if (next !== get()) set(next);
    input.value = String(get());
  });

  const sync = () => {
    const v = get();
    if (document.activeElement !== input || Number(input.value) !== v) input.value = String(v);
    dec.disabled = input.disabled;
    inc.disabled = input.disabled;
  };

  return { group, input, sync };
}
