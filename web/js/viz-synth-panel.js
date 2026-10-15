import {
  SYNTH_SCHEMA, SYNTH_GROUPS, getSynth, setSynth, resetSynth, onSynth,
} from './viz-synth-settings.js';

const defaultStore = { get: getSynth, set: setSynth, reset: resetSynth, on: onSynth };

const pathValue = (settings, path) => {
  const i = path.indexOf('.');
  return settings[path.slice(0, i)][path.slice(i + 1)];
};

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
  let input;
  let out = null;
  let read;
  let paint;
  if (spec.type === 'range' || spec.type === 'int') {
    input = make(doc, 'input', 'viz-synth-input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    out = make(doc, 'output', 'viz-synth-out');
    const d = decimals(spec.step);
    read = () => Number(input.value);
    paint = (v) => { input.value = String(v); out.textContent = Number(v).toFixed(d); };
  } else if (spec.type === 'select') {
    input = make(doc, 'select', 'viz-synth-input');
    for (const o of spec.options) {
      const opt = make(doc, 'option', '', titleCase(o));
      opt.value = o;
      input.append(opt);
    }
    read = () => input.value;
    paint = (v) => { input.value = v; };
  } else if (spec.type === 'bool') {
    input = make(doc, 'input', 'viz-synth-input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    read = () => input.checked;
    paint = (v) => { input.checked = !!v; input.setAttribute('aria-checked', String(!!v)); };
  } else {
    input = make(doc, 'input', 'viz-synth-input');
    input.type = 'color';
    read = () => input.value;
    paint = (v) => { input.value = v; };
  }
  const onEdit = () => write(spec.path, read());
  input.addEventListener('input', onEdit);
  input.addEventListener('change', onEdit);
  row.append(input);
  if (out) row.append(out);
  return { row, input, paint };
}

export function createSynthPanel({ doc = document, store = defaultStore } = {}) {
  const root = make(doc, 'div', 'viz-synth');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Synthwave terrain style');
  const stop = (e) => e.stopPropagation();
  root.addEventListener('keydown', stop);
  root.addEventListener('keyup', stop);
  root.addEventListener('keypress', stop);

  const resetAll = make(doc, 'button', 'viz-synth-reset viz-synth-reset-all', 'Reset all');
  resetAll.type = 'button';
  resetAll.addEventListener('click', () => store.reset());
  root.append(resetAll);

  const fields = [];
  for (const group of SYNTH_GROUPS) {
    const det = make(doc, 'details', 'viz-synth-group');
    det.dataset.group = group;
    det.append(make(doc, 'summary', 'viz-synth-summary', group));
    const body = make(doc, 'div', 'viz-synth-body');
    for (const spec of SYNTH_SCHEMA) {
      if (spec.group !== group) continue;
      const fld = buildField(doc, spec, (p, v) => store.set(p, v));
      fields.push({ spec, ...fld });
      body.append(fld.row);
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
    for (const f of fields) f.paint(pathValue(s, f.spec.path));
  };
  repaint();
  const off = store.on(repaint);

  return {
    el: root,
    repaint,
    destroy() { off(); root.remove(); },
  };
}
