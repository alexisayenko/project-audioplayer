import {
  MIRROR_SCHEMA, MIRROR_GROUPS, getMirror, setMirror, resetMirror, onMirror, replaceMirror,
} from './viz-mirror-settings.js';
import { pixelBars } from './viz-spectrum.js';
import { getBarLayout, derivedBarWidth } from './viz-bars.js';
import {
  MIRROR_PRESET_LIST, MIRROR_PRESET_THUMB, applyMirrorPreset, findActiveMirrorPreset, setLastMirrorPreset,
} from './viz-mirror-presets.js';

const defaultStore = { get: getMirror, set: setMirror, reset: resetMirror, on: onMirror, replace: replaceMirror };

const decimals = (step) => {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function make(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildField(doc, spec, write) {
  const row = make(doc, 'label', `viz-synth-row viz-synth-${spec.type}`);
  row.append(make(doc, 'span', 'viz-synth-name', spec.label));
  const input = make(doc, spec.type === 'select' ? 'select' : 'input', 'viz-synth-input');
  let out = null;
  let read;
  let paint;
  if (spec.type === 'range') {
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    out = make(doc, 'output', 'viz-synth-out');
    const d = decimals(spec.step);
    read = () => Number(input.value);
    paint = (v) => { input.value = String(v); out.textContent = spec.zero && Number(v) === 0 ? spec.zero : Number(v).toFixed(d); };
  } else if (spec.type === 'select') {
    for (const o of spec.options) {
      const opt = make(doc, 'option', '', titleCase(o));
      opt.value = o;
      input.append(opt);
    }
    read = () => input.value;
    paint = (v) => { input.value = v; };
  } else {
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    read = () => input.checked;
    paint = (v) => { input.checked = !!v; input.setAttribute('aria-checked', String(!!v)); };
  }
  const onEdit = () => write(spec.key, read());
  input.addEventListener('input', onEdit);
  input.addEventListener('change', onEdit);
  row.append(input);
  if (out) row.append(out);
  return { row, paint, input, out };
}

export function createMirrorPanel({ doc = document, store = defaultStore, getWidth = () => doc.defaultView?.innerWidth || 1200, getLayout = getBarLayout } = {}) {
  const root = make(doc, 'div', 'viz-synth viz-mirror');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Mirrored spectrum style');
  const stop = (e) => e.stopPropagation();
  root.addEventListener('keydown', stop);
  root.addEventListener('keyup', stop);
  root.addEventListener('keypress', stop);

  const resetAll = make(doc, 'button', 'viz-synth-reset viz-synth-reset-all', 'Reset all');
  resetAll.type = 'button';
  resetAll.addEventListener('click', () => store.reset());
  root.append(resetAll);

  const presets = make(doc, 'section', 'viz-synth-presets');
  presets.setAttribute('aria-labelledby', 'viz-mirror-presets-h');
  const ph = make(doc, 'h3', 'viz-synth-heading t-eyebrow', 'Presets');
  ph.id = 'viz-mirror-presets-h';
  const grid = make(doc, 'div', 'viz-synth-preset-grid');
  const tiles = [];
  const overwrite = (settings) => {
    if (store.replace) { store.replace(settings); return; }
    for (const spec of MIRROR_SCHEMA) store.set(spec.key, settings[spec.key]);
  };
  for (const p of MIRROR_PRESET_LIST) {
    const btn = make(doc, 'button', 'viz-synth-preset');
    btn.type = 'button';
    btn.dataset.preset = p.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${p.name} preset`);
    const img = make(doc, 'img', 'viz-synth-thumb');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => { img.hidden = true; btn.classList.add('viz-synth-nothumb'); });
    img.src = MIRROR_PRESET_THUMB(p.id);
    btn.append(img, make(doc, 'span', 'viz-synth-preset-name', p.name));
    btn.addEventListener('click', () => { setLastMirrorPreset(p.id); overwrite(applyMirrorPreset(p.id)); });
    tiles.push({ id: p.id, btn });
    grid.append(btn);
  }
  presets.append(ph, grid);
  root.append(presets);
  root.append(make(doc, 'h3', 'viz-synth-heading t-eyebrow', 'Fine tune'));

  const fields = [];
  let counter = null;
  let effNote = null;
  for (const group of MIRROR_GROUPS) {
    const det = make(doc, 'details', 'viz-synth-group');
    det.dataset.group = group;
    det.open = true;
    det.append(make(doc, 'summary', 'viz-synth-summary', group));
    const body = make(doc, 'div', 'viz-synth-body');
    for (const spec of MIRROR_SCHEMA) {
      if (spec.group !== group) continue;
      const fld = buildField(doc, spec, (k, v) => store.set(k, v));
      fields.push({ spec, ...fld });
      body.append(fld.row);
    }
    if (group === 'Bars') {
      const note = make(doc, 'output', 'viz-synth-count');
      note.setAttribute('aria-live', 'off');
      counter = note;
      body.append(note);
    }
    if (group === 'Sections') {
      effNote = make(doc, 'output', 'viz-synth-effective');
      effNote.setAttribute('aria-live', 'off');
      body.append(effNote);
    }
    const reset = make(doc, 'button', 'viz-synth-reset', `Reset ${group.toLowerCase()}`);
    reset.type = 'button';
    reset.addEventListener('click', () => store.reset(group));
    body.append(reset);
    det.append(body);
    root.append(det);
  }

  const repaint = () => {
    const s = store.get();
    for (const f of fields) f.paint(s[f.spec.key]);
    const derived = s.sectionHeight > 0 && s.segments > 0;
    const lay = getLayout?.() ?? null;
    const widthDerived = s.sectionAspect > 0 && s.sectionHeight > 0;
    const shownPx = lay && lay.derived ? lay.sectionPx : s.sectionHeight;
    const barW = derivedBarWidth(s, shownPx);
    for (const f of fields) {
      if (f.spec.key === 'barWidth') {
        f.input.disabled = widthDerived;
        f.row.classList.toggle('viz-synth-derived', widthDerived);
        if (widthDerived) f.out.textContent = `${Math.round(barW)}, from ${s.sectionAspect} x ${Math.round(shownPx * 10) / 10} px`;
        continue;
      }
      if (f.spec.key !== 'maxHeight') continue;
      f.input.disabled = derived;
      f.row.classList.toggle('viz-synth-derived', derived);
      if (derived) {
        const gap = Math.round(s.sectionHeight * s.segmentGap * 100) / 100;
        f.out.textContent = `${Math.round(s.segments * (s.sectionHeight + gap))}, from ${s.segments} x ${s.sectionHeight} px`;
      } else if (lay) {
        f.out.textContent = `${s.maxHeight > 0 ? s.maxHeight : 'Auto'} (effective ${Math.round(lay.height)} px)`;
      }
    }
    if (effNote) {
      const fit = derived && lay && lay.derived && lay.fit < 1;
      const px = lay ? Math.round(lay.sectionPx * 10) / 10 : 0;
      effNote.textContent = lay && lay.rows > 0 ? `effective: ${lay.rows} rows x ${px} px (room ${Math.round(lay.room)} px)` : '';
      if (effNote.textContent && widthDerived) effNote.textContent = effNote.textContent.replace(' (room', `, width ${Math.round(barW)} px (room`);
      if (fit && lay.fit < 0.75) effNote.textContent += '. More room: set Visualizer height to Full';
    }
    if (counter) counter.textContent = `~${pixelBars(getWidth(), barW, s.gap).count} bars`;
    const active = findActiveMirrorPreset(s);
    for (const t of tiles) t.btn.setAttribute('aria-pressed', String(t.id === active));
  };
  repaint();
  const off = store.on(repaint);
  const poll = globalThis.setInterval?.(repaint, 500);
  poll?.unref?.();

  return {
    el: root,
    repaint,
    destroy() { off(); globalThis.clearInterval?.(poll); root.remove(); },
  };
}
