import { TERRAIN_STYLES, getStyle, setStyle, onStyle } from './viz-terrain-style.js';
import { createPartsToggles } from './viz-parts-ui.js';
import { modeLabel } from './viz-modes.js';
import { flightOn, flightReduced, setFlightOn, onFlight } from './viz-flight.js';

export const PANEL_COLLAPSED_KEY = 'ap2.viz.panelCollapsed';
export const NARROW_PX = 480;

export function panelSections(mode) {
  return { style: mode === 'terrain', flight: mode === 'terrain', parts: mode === 'bars' };
}

export function panelTitle(mode) {
  return `${modeLabel(mode)} style`;
}

export function panelHasContent(mode) {
  const s = panelSections(mode);
  return s.style || s.flight || s.parts;
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
  flightBtn.className = 'viz-switch';
  flightBtn.setAttribute('role', 'switch');
  flightBtn.textContent = 'Camera flight';
  const flightNote = doc.createElement('small');
  flightNote.textContent = 'Off: reduced motion is on';
  const paintFlight = () => {
    const reduced = flightReduced();
    flightBtn.setAttribute('aria-checked', String(flightOn()));
    flightBtn.setAttribute('aria-pressed', String(flightOn()));
    flightBtn.disabled = reduced;
    flightNote.hidden = !reduced;
  };
  flightBtn.addEventListener('click', () => setFlightOn(!flightOn()));
  const offFlight = onFlight(paintFlight);
  paintFlight();
  flightRow.append(flightBtn, flightNote);

  const partsRoot = doc.createElement('div');
  const toggles = createPartsToggles({ root: partsRoot, state: parts.state, onChange: parts.onChange, onRefuse: parts.onRefuse });

  body.append(styleRow, flightRow, partsRoot);
  root.append(head, body);

  const setMode = (m) => {
    const s = panelSections(m);
    head.textContent = panelTitle(m);
    styleRow.hidden = !s.style;
    flightRow.hidden = !s.flight;
    paintFlight();
    partsRoot.hidden = !s.parts;
    root.dataset.empty = panelHasContent(m) ? '0' : '1';
  };
  setMode(mode);
  return {
    el: root,
    setMode,
    setParts: (s) => toggles.set(s),
    toggles,
    isEmpty: () => root.dataset.empty === '1',
    dispose() { offStyle(); offFlight(); root.remove(); },
  };
}
