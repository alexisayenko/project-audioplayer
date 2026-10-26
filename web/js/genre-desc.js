import { el } from './dom.js';

const TEMPO = /^tempo\s*:\s*(\S.*)$/i;
const BPM_LEAD = String.raw`(about|around|approx\.?|approximately|circa|roughly|~)?`;
const BPM_NUMBER = String.raw`(\d+(?:\s*[-\u2013]\s*\d+)?)`;
const BPM_VALUE = new RegExp(String.raw`^${BPM_LEAD}\s*${BPM_NUMBER}\s*(?:bpm)?$`, 'i');
const SENTENCE_END = '.!?\u2026';

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
  const head = (cut > 0 ? value.slice(0, cut) : value).trim();
  let end = head.length;
  while (end > 0 && SENTENCE_END.includes(head[end - 1])) end -= 1;
  return head.slice(0, end).trim();
}

function tempoMainOf(text) {
  const { tempo } = parseDescription(text);
  return tempo ? tempoMain(tempo) : '';
}

export function tempoBadge(text) {
  const bpm = BPM_VALUE.exec(tempoMainOf(text));
  if (!bpm) return null;
  const lead = bpm[1] ? `${bpm[1]} ` : '';
  const spoken = `${lead}${bpm[2]} BPM`;
  return el('span', { class: 'bpm-badge gc-bpm', role: 'img', title: 'Beats per minute', 'aria-label': `Tempo ${spoken}` },
    bpm[2].replace(/\s+/g, ''), el('small', { 'aria-hidden': 'true' }, 'BPM'));
}

function tempoText(main) {
  return el('p', { class: 'gc-tempo' }, main.charAt(0).toUpperCase() + main.slice(1));
}

export function descriptionNode(text, emptyText) {
  const { rest } = parseDescription(text);
  const main = tempoMainOf(text);
  const plain = main && !BPM_VALUE.test(main) ? main : '';
  const prose = rest.map(sentence).filter(Boolean).join(' ');
  if (!plain && !prose) {
    return el('p', { class: 'gc-desc t-body muted' }, emptyText);
  }
  return el('div', { class: 'gc-desc gc-desc-rich' },
    plain ? tempoText(plain) : null,
    prose ? el('p', { class: 'gc-prose' }, prose) : null);
}
