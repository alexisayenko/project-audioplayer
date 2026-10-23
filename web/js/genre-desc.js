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
  return (cut > 0 ? value.slice(0, cut) : value).trim();
}

function tempoParts(main) {
  const bpm = BPM_VALUE.exec(main);
  if (!bpm) return [sentence(`Tempo ${main}`)];
  const chip = el('span', { class: 'bpm-badge', title: 'Beats per minute', 'aria-label': `${bpm[1] ? `${bpm[1]} ` : ''}${bpm[2]} BPM` },
    bpm[2].replace(/\s+/g, ''), el('small', { 'aria-hidden': 'true' }, 'BPM'));
  return [`Tempo ${bpm[1] ? `${bpm[1]} ` : ''}`, chip, '.'];
}

export function descriptionNode(text, emptyText) {
  const { tempo, rest } = parseDescription(text);
  if (!tempo && !rest.length) {
    return el('p', { class: 'gc-desc t-body muted' }, emptyText);
  }
  const main = tempo ? tempoMain(tempo) : '';
  const prose = rest.map(sentence).filter(Boolean).join(' ');
  const parts = [...(main ? tempoParts(main) : []), prose ? `${main ? ' ' : ''}${prose}` : ''].filter(Boolean);
  return el('div', { class: 'gc-desc gc-desc-rich' },
    parts.length ? el('p', { class: 'gc-prose' }, ...parts) : null);
}
