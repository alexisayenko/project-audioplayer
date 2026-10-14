import { TERRAIN_STYLES, getStyle, setStyle, onStyle } from './viz-terrain-style.js';
import { camClamp, camFormat, camParse, CAM_LIMITS, EYE_HEIGHT, DEFAULT_PITCH_DEG, YAW_COVER_MAX_DEG } from './viz-terrain-math.js';

export const CAM_KEY = 'ap2.viz.dbg.cam5';

let qualityForce = null;
export const getQualityForce = () => qualityForce;
export function setQualityForce(v) { qualityForce = Number.isInteger(v) && v >= 0 && v <= 2 ? v : null; return qualityForce; }

const defaults = () => ({ eye: EYE_HEIGHT, pitch: DEFAULT_PITCH_DEG, yaw: 0, sync: 0 });
let cam = defaults();
const listeners = new Set();

const yawCoverNote = () => Math.max(0, Math.round(YAW_COVER_MAX_DEG - Math.atan(Math.tan(32.5 * (Math.PI / 180)) * 1.78) * (180 / Math.PI)));

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
  mk('yaw', 'Yaw', 0.1);
  mk('sync', 'Sync', 1);
  const styleRow = doc.createElement('label');
  const styleName = doc.createElement('span');
  styleName.textContent = 'Style';
  const styleSel = doc.createElement('select');
  styleSel.setAttribute('aria-label', 'Terrain style');
  for (const st of TERRAIN_STYLES) {
    const o = doc.createElement('option');
    o.value = st.id;
    o.textContent = st.label;
    styleSel.append(o);
  }
  styleSel.value = getStyle();
  styleSel.addEventListener('change', () => setStyle(styleSel.value));
  const offStyle = onStyle((id) => { styleSel.value = id; });
  styleRow.append(styleName, styleSel);
  root.append(styleRow);
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
  root.append(qRow);
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
  const note = doc.createElement('small');
  note.textContent = `Yaw is fully covered up to about +-${yawCoverNote()} deg at 16:9; beyond that the far side of the grid can show bare edge. Sync is a trim added to the automatic output-latency estimate (positive = visuals earlier).`;
  btns.append(reset, copy);
  root.append(line, btns, note);
  const paint = (c) => {
    rows.eye.input.value = c.eye;
    rows.eye.out.textContent = c.eye.toFixed(2);
    rows.pitch.input.value = c.pitch;
    rows.pitch.out.textContent = `${c.pitch.toFixed(1)}°`;
    rows.yaw.input.value = c.yaw;
    rows.yaw.out.textContent = `${c.yaw.toFixed(1)}°`;
    rows.sync.input.value = c.sync;
    rows.sync.out.textContent = `${c.sync > 0 ? '+' : ''}${c.sync} ms`;
    line.value = camFormat(c);
  };
  listeners.add(paint);
  paint(cam);
  return { el: root, dispose() { listeners.delete(paint); offStyle(); root.remove(); } };
}
