import { el } from './dom.js';
import { loadingNote } from './loading-note.js';
import { icon } from './icons.js';

export const TERMS_URL = 'data/theory-terms.json';
export const FAIL_TEXT = 'Could not load the terms. Reload to try again.';
export const EMPTY_TEXT = 'No terms yet.';

export function sortTerms(list) {
  return list
    .filter((t) => t && typeof t.id === 'string' && typeof t.term === 'string' && typeof t.description === 'string')
    .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
}

export async function loadTerms(fetchFn = globalThis.fetch) {
  const res = await fetchFn(TERMS_URL);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('bad data');
  return sortTerms(data);
}

export const ANATOMY_URL = 'data/theory-anatomy.json';
export const ANATOMY_FAIL_TEXT = 'Could not load the examples. Reload to try again.';
export const ANATOMY_TITLE = 'Composition metadata anatomy';

export async function loadAnatomy(fetchFn = globalThis.fetch) {
  const res = await fetchFn(ANATOMY_URL);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.examples)) throw new Error('bad data');
  return data;
}

export const pathValue = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function formatValue(v) {
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(', ') : 'none';
  if (v && typeof v === 'object') return Object.values(v).join(' ');
  return v == null ? 'none' : String(v);
}

export function rowsFor(example, fields) {
  return fields
    .map((f) => ({ ...f, value: pathValue(example.song, f.path) }))
    .filter((r) => r.value !== undefined);
}

const panel = (title, content) => el('details', { class: 'an-panel' },
  el('summary', {}, el('span', { class: 'an-chev', 'aria-hidden': 'true' }, icon('chevron', 'inline')), el('span', {}, title)),
  content);

export function renderAnatomy(data) {
  const { fields, examples } = data;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const titleNode = el('p', { class: 'an-title' });
  const tableBody = el('tbody', {});
  const jsonNode = el('pre', { class: 'an-json', tabindex: '0', 'aria-label': 'Stored song as JSON' });
  const table = el('div', { class: 'an-panel-body' },
    el('div', { class: 'an-tablewrap' },
      el('table', { class: 'an-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Field'), el('th', { scope: 'col' }, 'Value'), el('th', { scope: 'col' }, 'Meaning'))),
        tableBody)));
  const out = el('div', { class: 'an-out', id: 'an-out', 'aria-live': 'polite' },
    titleNode,
    panel('Legend', table),
    panel('How this song is stored', el('div', { class: 'an-panel-body' }, jsonNode)));
  const buttons = examples.map((e) => el('button', { type: 'button', class: 'an-ex', 'aria-pressed': 'false', 'aria-controls': 'an-out' }, e.rawTitle));
  const list = el('div', { class: 'an-examples', role: 'group', 'aria-label': 'Examples' }, buttons);
  const root = el('div', { class: 'an' }, list, out);

  const draw = (example) => {
    const segs = [];
    const rows = [];
    const place = (seg) => {
      const hint = seg.node.querySelector('.an-label');
      const card = titleNode.getBoundingClientRect?.();
      if (!hint || !card) return;
      hint.style.setProperty('--an-shift', '0px');
      const r = hint.getBoundingClientRect();
      const shift = Math.max(card.left - r.left, Math.min(0, card.right - r.right));
      hint.style.setProperty('--an-shift', `${shift}px`);
    };
    const setActive = (ids) => {
      for (const s of segs) {
        const on = !!ids && s.fields.some((f) => ids.includes(f));
        s.node.classList.toggle('is-on', on);
        if (on) place(s);
      }
      for (const r of rows) r.node.classList.toggle('is-on', !!ids && ids.includes(r.id));
    };
    const hook = (node, ids) => {
      node.addEventListener('mouseenter', () => setActive(ids));
      node.addEventListener('mouseleave', () => setActive(null));
      node.addEventListener('focus', () => setActive(ids));
      node.addEventListener('blur', () => setActive(null));
    };

    const parts = example.segments.map((s) => {
      if (!s.fields?.length) return el('span', { class: 'an-sep' }, s.text);
      const tone = byId.get(s.fields[0])?.tone ?? 'plain';
      const label = s.label ?? byId.get(s.fields[0])?.label ?? '';
      const node = el('span', { class: 'an-seg', tabindex: '0', 'data-tone': tone },
        el('span', { class: 'an-text' }, s.text),
        el('span', { class: 'an-label' }, label));
      segs.push({ node, fields: s.fields });
      hook(node, s.fields);
      return node;
    });

    const body = rowsFor(example, fields).map((r) => {
      const node = el('tr', { class: 'an-row', tabindex: '0', 'data-tone': r.tone },
        el('th', { scope: 'row', 'data-label': 'Field' }, el('code', {}, r.path), el('span', { class: 'an-fname' }, r.label)),
        el('td', { 'data-label': 'Value' }, formatValue(r.value)),
        el('td', { 'data-label': 'Meaning' }, r.description));
      rows.push({ node, id: r.id });
      hook(node, [r.id]);
      return node;
    });

    titleNode.replaceChildren(...parts);
    tableBody.replaceChildren(...body);
    jsonNode.textContent = JSON.stringify(example.song, null, 2);
    examples.forEach((e, i) => buttons[i].setAttribute('aria-pressed', e === example ? 'true' : 'false'));
  };

  buttons.forEach((b, i) => b.addEventListener('click', () => draw(examples[i])));
  if (examples.length) draw(examples[0]);
  return root;
}

export function renderTheory(root) {
  let dead = false;
  const body = el('div', { class: 'th-body' }, loadingNote());
  const anatomyBody = el('div', { class: 'th-body' }, loadingNote());
  root.append(
    el('header', { class: 'page-head' },
      el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
      el('h1', { class: 't-display' }, 'Music theory')),
    el('section', { class: 'th', 'aria-label': 'Terms' }, body),
    el('section', { class: 'th th-anatomy', 'aria-labelledby': 'an-heading' },
      el('h2', { class: 't-title', id: 'an-heading' }, ANATOMY_TITLE),
      el('p', { class: 'muted t-body' }, 'How one raw song title is split into the fields the library stores. Pick an example, then hover or focus a part of the title or a row of the legend to link them.'),
      anatomyBody),
  );
  loadAnatomy().then((data) => {
    if (dead) return;
    if (!data.examples.length) throw new Error('empty');
    anatomyBody.replaceChildren(renderAnatomy(data));
  }).catch(() => { if (!dead) anatomyBody.replaceChildren(el('p', { class: 'muted t-body', role: 'status' }, ANATOMY_FAIL_TEXT)); });
  const show = (node) => { if (!dead) body.replaceChildren(node); };
  loadTerms().then((terms) => {
    if (!terms.length) { show(el('p', { class: 'muted t-body', role: 'status' }, EMPTY_TEXT)); return; }
    show(el('dl', { class: 'th-list' }, terms.map((t) => el('div', { class: 'th-item card', id: `term-${t.id}` },
      el('dt', { class: 't-title' }, t.term),
      el('dd', { class: 'th-desc t-body' }, t.description)))));
  }).catch(() => show(el('p', { class: 'muted t-body', role: 'status' }, FAIL_TEXT)));
  return () => { dead = true; };
}
