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

function sentence(text) {
  const t = text.trim();
  if (!t) return '';
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?\u2026]["')\]]*$/.test(s) ? s : `${s}.`;
}

function tempoMain(value) {
  const cut = value.indexOf(',');
  return (cut > 0 ? value.slice(0, cut) : value).trim().replace(/[.!?\u2026]+$/, '').trim();
}

function tempoLine(main) {
  const bpm = BPM_VALUE.exec(main);
  if (!bpm) return el('p', { class: 'gc-tempo' }, main.charAt(0).toUpperCase() + main.slice(1));
  const spoken = `${bpm[1] ? `${bpm[1]} ` : ''}${bpm[2]} BPM`;
  const chip = el('span', { class: 'bpm-badge', title: 'Beats per minute', 'aria-label': spoken },
    bpm[2].replace(/\s+/g, ''), el('small', { 'aria-hidden': 'true' }, 'BPM'));
  return el('p', { class: 'gc-tempo', role: 'group', 'aria-label': `Tempo ${spoken}` }, chip);
}

export function descriptionNode(text, emptyText) {
  const { tempo, rest } = parseDescription(text);
  if (!tempo && !rest.length) {
    return el('p', { class: 'gc-desc t-body muted' }, emptyText);
  }
  const main = tempo ? tempoMain(tempo) : '';
  const prose = rest.map(sentence).filter(Boolean).join(' ');
  return el('div', { class: 'gc-desc gc-desc-rich' },
    main ? tempoLine(main) : null,
    prose ? el('p', { class: 'gc-prose' }, prose) : null);
}
