import { camClamp, camFormat, camParse, nowClamp, nowFormat, nowParse, nowGains, parseNowField, NOW_LIMITS, NOW_DEFAULTS, CAM_LIMITS, EYE_HEIGHT, DEFAULT_PITCH_DEG, YAW_COVER_MAX_DEG } from './viz-terrain-math.js';

import { getStyle, onStyle } from './viz-terrain-style.js';
import { flight, flightYawPlan } from './viz-flight.js';

export const CAM_KEY = 'ap2.viz.dbg.cam5';

let qualityForce = null;
export const getQualityForce = () => qualityForce;
export function setQualityForce(v) { qualityForce = Number.isInteger(v) && v >= 0 && v <= 2 ? v : null; return qualityForce; }

const defaults = () => ({ eye: EYE_HEIGHT, pitch: DEFAULT_PITCH_DEG, yaw: 0, sync: 0, ...NOW_DEFAULTS });
const clampAll = (v) => ({ ...camClamp(v), ...nowClamp(v) });
let cam = defaults();
const listeners = new Set();

const yawCoverNote = () => Math.max(0, Math.round(YAW_COVER_MAX_DEG - Math.atan(Math.tan(32.5 * (Math.PI / 180)) * 1.78) * (180 / Math.PI)));

export function getCam() { return cam; }

export function setCam(v, store = globalThis.localStorage) {
  cam = clampAll({ ...cam, ...v });
  try { store?.setItem(CAM_KEY, JSON.stringify(cam)); } catch { /* storage unavailable */ }
  for (const fn of listeners) fn(cam);
  return cam;
}

export function resetCam(store = globalThis.localStorage) {
  try { store?.removeItem(CAM_KEY); } catch { /* storage unavailable */ }
  cam = defaults();
  for (const fn of listeners) fn(cam);
  return cam;
}

export function loadCam(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(CAM_KEY);
    cam = raw ? clampAll(JSON.parse(raw)) : defaults();
  } catch {
    cam = defaults();
  }
  return cam;
}

export const CAM_COLLAPSED_KEY = 'ap2.viz.dbg.camCollapsed';

export function createCamPanel(doc = document) {
  const root = doc.createElement('div');
  root.className = 'viz-cam-panel';
  root.addEventListener('click', (e) => e.stopPropagation());
  const head = doc.createElement('button');
  head.type = 'button';
  head.className = 'viz-cam-head';
  head.textContent = 'Camera';
  head.setAttribute('aria-controls', 'viz-cam-body');
  head.textContent = 'Camera (debug)';
  const body = doc.createElement('div');
  body.className = 'viz-cam-body';
  body.id = 'viz-cam-body';
  const setCollapsed = (v, save = true) => {
    root.classList.toggle('collapsed', v);
    head.setAttribute('aria-expanded', String(!v));
    body.hidden = v;
    if (save) { try { globalThis.localStorage?.setItem(CAM_COLLAPSED_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ } }
  };
  let startCollapsed = false;
  try { startCollapsed = globalThis.localStorage?.getItem(CAM_COLLAPSED_KEY) === '1'; } catch { /* storage unavailable */ }
  setCollapsed(startCollapsed, false);
  head.addEventListener('click', () => setCollapsed(!root.classList.contains('collapsed')));
  root.append(head, body);
  const rows = {};
  const mk = (key, label, step) => {
    const row = doc.createElement('label');
    const name = doc.createElement('span');
    name.textContent = label;
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = CAM_LIMITS[key][0];
    input.max = CAM_LIMITS[key][1];
    input.step = step;
    const out = doc.createElement('output');
    input.addEventListener('input', () => setCam({ [key]: +input.value }));
    row.append(name, input, out);
    body.append(row);
    rows[key] = { input, out };
  };
  mk('eye', 'Eye', 0.01);
  mk('pitch', 'Pitch', 0.1);
  mk('yaw', 'Yaw', 0.1);
  mk('sync', 'Sync', 10);
  const mkField = (key, label, step) => {
    const row = doc.createElement('label');
    const name = doc.createElement('span');
    name.textContent = label;
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = NOW_LIMITS[key][0];
    input.max = NOW_LIMITS[key][1];
    input.step = step;
    input.inputMode = 'decimal';
    const out = doc.createElement('output');
    const apply = () => {
      const eff = nowGains(cam, getStyle());
      const v = parseNowField(input.value, key, key === 'nowH' ? eff.h : eff.b);
      setCam({ [key]: v });
      const g = nowGains(cam, getStyle());
      input.value = (key === 'nowH' ? g.h : g.b).toFixed(step < 0.1 ? 2 : 1);
    };
    input.addEventListener('input', () => { const v = parseNowField(input.value, key, null); if (v !== null && input.value.trim() !== '') setCam({ [key]: v }); });
    input.addEventListener('change', apply);
    input.addEventListener('blur', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    row.append(name, input, out);
    body.append(row);
    rows[key] = { input, out };
  };
  mkField('nowH', 'Now line height', 0.05);
  mkField('nowB', 'Now line glow', 0.1);
  const qRow = doc.createElement('label');
  const qName = doc.createElement('span');
  qName.textContent = 'Quality';
  const qSel = doc.createElement('select');
  qSel.setAttribute('aria-label', 'Terrain quality');
  for (const [v, label] of [['auto', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2']]) {
    const o = doc.createElement('option');
    o.value = v;
    o.textContent = label;
    qSel.append(o);
  }
  qSel.value = qualityForce === null ? 'auto' : String(qualityForce);
  qSel.addEventListener('change', () => setQualityForce(qSel.value === 'auto' ? null : +qSel.value));
  qRow.append(qName, qSel);
  body.append(qRow);
  const line = doc.createElement('textarea');
  line.rows = 2;
  line.spellcheck = false;
  line.setAttribute('aria-label', 'Camera values');
  line.addEventListener('change', () => setCam({ ...camParse(line.value), ...nowParse(line.value) }));
  const btns = doc.createElement('div');
  btns.className = 'viz-cam-btns';
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => resetCam());
  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy values';
  copy.addEventListener('click', () => {
    line.select?.();
    try { void globalThis.navigator?.clipboard?.writeText(`${camFormat(cam)} ${nowFormat(cam)}`); } catch { /* clipboard unavailable */ }
  });
  const note = doc.createElement('small');
  note.textContent = `Yaw is fully covered up to about +-${yawCoverNote()} deg at 16:9; beyond that the side of the grid fades out instead of showing a bare edge. Sync is a trim added to the automatic output-latency estimate (positive = visuals earlier).`;
  btns.append(reset, copy);
  const flightLine = doc.createElement('small');
  flightLine.className = 'viz-flight-line';
  flightLine.hidden = true;
  const paintFlight = () => {
    const on = flight.active();
    flightLine.hidden = !on;
    if (!on) return;
    const o = flight.offsets(cam, flight.aspect());
    const plan = flightYawPlan(cam.yaw, flight.aspect());
    flightLine.textContent = `flight offset: eye ${o.eye >= 0 ? '+' : ''}${o.eye.toFixed(1)} yaw ${o.yaw >= 0 ? '+' : ''}${o.yaw.toFixed(1)}deg, yaw amplitude +-${plan.amp.toFixed(1)}deg${plan.limited ? ' (yaw limited by view width)' : ''}`;
  };
  const flightTimer = globalThis.setInterval?.(paintFlight, 250);
  body.append(line, flightLine, btns, note);
  const paint = (c) => {
    rows.eye.input.value = c.eye;
    rows.eye.out.textContent = c.eye.toFixed(2);
    rows.pitch.input.value = c.pitch;
    rows.pitch.out.textContent = `${c.pitch.toFixed(1)}°`;
    rows.yaw.input.value = c.yaw;
    rows.yaw.out.textContent = `${c.yaw.toFixed(1)}°`;
    rows.sync.input.value = c.sync;
    rows.sync.out.textContent = `${c.sync > 0 ? '+' : ''}${c.sync} ms`;
    const g = nowGains(c, getStyle());
    rows.nowH.input.value = g.h.toFixed(2);
    rows.nowH.out.textContent = 'x';
    rows.nowB.input.value = g.b.toFixed(1);
    rows.nowB.out.textContent = 'x';
    line.value = `${camFormat(c)} ${nowFormat({ nowH: g.h, nowB: g.b })}`;
  };
  listeners.add(paint);
  const offStyle = onStyle(() => paint(cam));
  paint(cam);
  return { el: root, dispose() { globalThis.clearInterval?.(flightTimer); listeners.delete(paint); offStyle(); root.remove(); } };
}
