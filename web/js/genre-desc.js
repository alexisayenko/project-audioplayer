import { el } from './dom.js';

const TEMPO = /^tempo\s*:\s*(.+)$/i;
const BPM_VALUE = /^(about|around|approx\.?|approximately|circa|roughly|~)?\s*(\d+(?:\s*[-\u2013]\s*\d+)?)\s*(?:bpm)?$/i;

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

function splitTempo(value) {
  const cut = value.indexOf(',');
  return {
    main: cut > 0 ? value.slice(0, cut) : value,
    note: cut > 0 ? value.slice(cut + 1).trim() : '',
  };
}

function sentence(text) {
  const t = text.trim();
  if (!t) return '';
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?\u2026]["')\]]*$/.test(s) ? s : `${s}.`;
}

function tempoFact(main) {
  const bpm = BPM_VALUE.exec(main.trim());
  const shown = bpm
    ? el('span', { class: 'bpm-badge', title: 'Beats per minute', 'aria-label': `${bpm[1] ? `${bpm[1]} ` : ''}${bpm[2]} BPM` },
      bpm[2].replace(/\s+/g, ''), el('small', { 'aria-hidden': 'true' }, 'BPM'))
    : el('span', { class: 'gc-tempo-value' }, main);
  return el('p', { class: 'gc-tempo' },
    el('span', { class: 'gc-tempo-label' }, 'Tempo'),
    bpm && bpm[1] ? el('span', { class: 'gc-tempo-qual' }, bpm[1]) : null,
    shown);
}

export function descriptionNode(text, emptyText) {
  const { tempo, rest } = parseDescription(text);
  if (!tempo && rest.length <= 1) {
    const one = rest[0] || '';
    return el('p', { class: `gc-desc t-body${one ? '' : ' muted'}` }, one || emptyText);
  }
  const { main, note } = tempo ? splitTempo(tempo) : { main: '', note: '' };
  const prose = [note, ...rest].map(sentence).filter(Boolean).join(' ');
  return el('div', { class: 'gc-desc gc-desc-rich' },
    tempo ? tempoFact(main) : null,
    prose ? el('p', { class: 'gc-prose' }, prose) : null);
}
