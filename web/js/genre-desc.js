import { el } from './dom.js';

const TEMPO = /^tempo\s*:\s*(.+)$/i;

export function parseDescription(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  let tempo = null;
  const rest = [];
  for (const line of lines) {
    const m = !tempo && TEMPO.exec(line);
    if (m) tempo = m[1];
    else rest.push(line);
  }
  return { tempo, rest };
}

function tempoFact(value) {
  const cut = value.indexOf(',');
  const main = cut > 0 ? value.slice(0, cut) : value;
  const note = cut > 0 ? value.slice(cut + 1).trim() : '';
  return el('p', { class: 'gc-tempo' },
    el('span', { class: 'gc-tempo-label' }, 'Tempo'),
    el('span', { class: 'gc-tempo-value' }, main),
    note ? el('span', { class: 'gc-tempo-note' }, note) : null);
}

export function descriptionNode(text, emptyText) {
  const { tempo, rest } = parseDescription(text);
  if (!tempo && rest.length <= 1) {
    const one = rest[0] || '';
    return el('p', { class: `gc-desc t-body${one ? '' : ' muted'}` }, one || emptyText);
  }
  return el('div', { class: 'gc-desc gc-desc-rich' },
    tempo ? tempoFact(tempo) : null,
    rest.length === 1 ? el('p', { class: 'gc-line' }, rest[0]) : null,
    rest.length > 1 ? el('ul', { class: 'gc-points' }, ...rest.map((line) => el('li', {}, line))) : null);
}
