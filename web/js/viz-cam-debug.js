import { camClamp, camFormat, camParse, CAM_LIMITS, EYE_HEIGHT, DEFAULT_PITCH_DEG } from './viz-terrain-math.js';

export const CAM_KEY = 'ap2.viz.dbg.cam4';

const defaults = () => ({ eye: EYE_HEIGHT, pitch: DEFAULT_PITCH_DEG });
let cam = defaults();
const listeners = new Set();

export function getCam() { return cam; }

export function setCam(v, store = globalThis.localStorage) {
  cam = camClamp({ ...cam, ...v });
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
    cam = raw ? camClamp(JSON.parse(raw)) : defaults();
  } catch {
    cam = defaults();
  }
  return cam;
}

export function createCamPanel(doc = document) {
  const root = doc.createElement('div');
  root.className = 'viz-cam-panel';
  root.addEventListener('click', (e) => e.stopPropagation());
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
    root.append(row);
    rows[key] = { input, out };
  };
  mk('eye', 'Eye', 0.01);
  mk('pitch', 'Pitch', 0.1);
  const line = doc.createElement('input');
  line.type = 'text';
  line.setAttribute('aria-label', 'Camera values');
  line.addEventListener('change', () => setCam(camParse(line.value)));
  const btns = doc.createElement('div');
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => resetCam());
  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy values';
  copy.addEventListener('click', () => {
    line.select?.();
    try { void globalThis.navigator?.clipboard?.writeText(camFormat(cam)); } catch { /* clipboard unavailable */ }
  });
  btns.append(reset, copy);
  root.append(line, btns);
  const paint = (c) => {
    rows.eye.input.value = c.eye;
    rows.eye.out.textContent = c.eye.toFixed(2);
    rows.pitch.input.value = c.pitch;
    rows.pitch.out.textContent = `${c.pitch.toFixed(1)}°`;
    line.value = camFormat(c);
  };
  listeners.add(paint);
  paint(cam);
  return { el: root, dispose() { listeners.delete(paint); root.remove(); } };
}
