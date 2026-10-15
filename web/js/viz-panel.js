import { TERRAIN_STYLES, getStyle, setStyle, onStyle } from './viz-terrain-style.js';
import { createPartsToggles } from './viz-parts-ui.js';
import { modeLabel } from './viz-modes.js';
import { createSynthPanel } from './viz-synth-panel.js';
import { flight, flightOn, flightReduced, setFlightOn, onFlight } from './viz-flight.js';

const signed = (v, d) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

export function flightReadout(o, playing) {
  const text = `eye ${signed(o.eye, 1)}  yaw ${signed(o.yaw, 1)}deg`;
  return playing ? text : `${text} (paused with the music)`;
}

export const PANEL_COLLAPSED_KEY = 'ap2.viz.panelCollapsed';
export const NARROW_PX = 480;

export function panelSections(mode) {
  return { style: mode === 'terrain', flight: mode === 'terrain', parts: mode === 'bars', synth: mode === 'synthwave' };
}

export function panelTitle(mode) {
  return `${modeLabel(mode)} style`;
}

export function panelHasContent(mode) {
  const s = panelSections(mode);
  return s.style || s.flight || s.parts || s.synth;
}

export function defaultCollapsed(width) {
  return width < NARROW_PX;
}

export function readCollapsed(store, width) {
  try {
    const v = store?.getItem(PANEL_COLLAPSED_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage unavailable */ }
  return defaultCollapsed(width);
}

export function createStylePanel({ doc = document, mode, width, parts }) {
  const root = doc.createElement('div');
  root.className = 'viz-panel viz-style-panel';
  root.addEventListener('click', (e) => e.stopPropagation());
  const head = doc.createElement('button');
  head.type = 'button';
  head.className = 'viz-cam-head';
  head.setAttribute('aria-controls', 'viz-style-body');
  const body = doc.createElement('div');
  body.className = 'viz-cam-body';
  body.id = 'viz-style-body';
  const setCollapsed = (v, save = true) => {
    root.classList.toggle('collapsed', v);
    head.setAttribute('aria-expanded', String(!v));
    body.hidden = v;
    if (save) { try { globalThis.localStorage?.setItem(PANEL_COLLAPSED_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ } }
  };
  setCollapsed(readCollapsed(globalThis.localStorage, width), false);
  head.addEventListener('click', () => setCollapsed(!root.classList.contains('collapsed')));

  const styleRow = doc.createElement('label');
  const styleName = doc.createElement('span');
  styleName.textContent = 'Terrain style';
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

  const flightRow = doc.createElement('div');
  flightRow.className = 'viz-flight-row';
  const flightBtn = doc.createElement('button');
  flightBtn.type = 'button';
  flightBtn.id = 'viz-flight-toggle';
  flightBtn.className = 'viz-flag-switch';
  flightBtn.setAttribute('role', 'switch');
  flightBtn.textContent = 'Camera flight';
  const flightNote = doc.createElement('small');
  flightNote.textContent = 'Off: reduced motion is on';
  const flightRead = doc.createElement('small');
  flightRead.className = 'viz-flight-readout';
  const paintRead = () => {
    const show = flightOn() && !flightRow.hidden;
    flightRead.hidden = !show;
    if (show) flightRead.textContent = flightReadout(flight.applied(), flight.isPlaying());
  };
  const readTimer = globalThis.setInterval?.(paintRead, 250);
  readTimer?.unref?.();
  const paintFlight = () => {
    const reduced = flightReduced();
    flightBtn.setAttribute('aria-checked', String(flightOn()));
    flightBtn.setAttribute('aria-pressed', String(flightOn()));
    flightBtn.disabled = reduced;
    flightNote.hidden = !reduced;
    paintRead();
  };
  flightBtn.addEventListener('click', () => setFlightOn(!flightOn()));
  const offFlight = onFlight(paintFlight);
  paintFlight();
  flightRow.append(flightBtn, flightNote, flightRead);

  const partsRoot = doc.createElement('div');
  const toggles = createPartsToggles({ root: partsRoot, state: parts.state, onChange: parts.onChange, onRefuse: parts.onRefuse });

  const synthPanel = createSynthPanel({ doc });
  const synthRoot = synthPanel.el;

  body.append(styleRow, flightRow, partsRoot, synthRoot);
  root.append(head, body);

  const setMode = (m) => {
    const s = panelSections(m);
    head.textContent = panelTitle(m);
    styleRow.hidden = !s.style;
    flightRow.hidden = !s.flight;
    paintFlight();
    partsRoot.hidden = !s.parts;
    synthRoot.hidden = !s.synth;
    root.dataset.empty = panelHasContent(m) ? '0' : '1';
  };
  setMode(mode);
  return {
    el: root,
    setMode,
    setParts: (s) => toggles.set(s),
    toggles,
    isEmpty: () => root.dataset.empty === '1',
    dispose() { offStyle(); offFlight(); synthPanel.destroy(); globalThis.clearInterval?.(readTimer); root.remove(); },
  };
}
