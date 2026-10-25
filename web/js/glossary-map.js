import { TERMS, filterTerms } from './glossary-terms.js';

export const DOMAINS = [
  { id: 'physics', label: 'Physics of sound', token: '--chart-6' },
  { id: 'perception', label: 'Perception', token: '--chart-3' },
  { id: 'music', label: 'Music', token: '--chart-7' },
  { id: 'theory', label: 'Music theory', token: '--chart-2' },
  { id: 'instruments', label: 'Instruments', token: '--chart-5' },
  { id: 'analysis', label: 'Analysis tools', token: '--chart-0' },
];

const MEMBERS = {
  physics: ['sound', 'oscillation', 'vibration', 'compression-and-rarefaction', 'sound-wave', 'cycle-and-period','frequency', 'wavelength', 'amplitude', 'power', 'speed-of-sound', 'sine-wave', 'sawtooth-wave', 'square-wave', 'triangle-wave', 'pulse-wave', 'duty-cycle', 'white-noise', 'pink-noise', 'infrasound-and-ultrasound', 'soundboard', 'bridge', 'length', 'click-train', 'repetition-rate'],
  perception: ['pitch', 'timbre', 'missing-fundamental', 'cent', 'loudness', 'flutter-and-roughness'],
  music: ['note', 'tone', 'fundamental', 'harmonic-1', 'harmonics', 'overtone', 'partial', 'inharmonicity', 'beating', 'hammer-strike-position', 'strings-per-note', 'decay-across-harmonics', 'rhythm', 'beat', 'tempo', 'meter', 'bar', 'downbeat', 'onset', 'syncopation', 'subdivision', 'swing'],
  theory: ['scale', 'major-scale', 'minor-scale', 'chromatic-scale', 'pentatonic-scale', 'mode', 'key', 'tonic', 'semitone', 'whole-tone', 'octave', 'interval', 'third', 'fourth', 'fifth', 'consonance', 'dissonance', 'tuning', 'equal-temperament', 'just-intonation', 'pythagorean-tuning', 'reference-pitch', 'circle-of-fifths', 'chord', 'triad', 'seventh-chord', 'root', 'inversion', 'chord-progression', 'cadence', 'harmony', 'melody'],
  instruments: ['chordophones', 'aerophones', 'membranophones', 'idiophones', 'electrophones', 'primitive'],
  analysis: ['waveform', 'oscilloscope', 'spectrum', 'spectrogram', 'beat-bands', 'tempo-grid', 'bpm', 'analysis-window', 'trails', 'harmonic-markers', 'pitch-detection', 'octave-error', 'dbfs', 'db-spl', 'time-window', 'spectrum-analyzer', 'fourier-transform'],
};

export const DOMAIN_OF = Object.fromEntries(Object.entries(MEMBERS).flatMap(([domain, ids]) => ids.map((id) => [id, domain])));

export function termsByDomain(terms = TERMS) {
  return DOMAINS.map((d) => ({ ...d, terms: terms.filter((t) => DOMAIN_OF[t.id] === d.id) })).filter((d) => d.terms.length);
}

const rel = (from, label, to) => ({ from, label, to });

export const RELATIONS = [
  rel('sound', 'is a kind of', 'oscillation'),
  rel('sound', 'is a pattern of', 'compression-and-rarefaction'),
  rel('vibration', 'is a kind of', 'oscillation'),
  rel('oscillation', 'is described by', 'frequency'),
  rel('oscillation', 'is described by', 'amplitude'),
  rel('frequency', 'is the inverse of', 'cycle-and-period'),
  rel('frequency', 'x wavelength equals', 'speed-of-sound'),
  rel('wavelength', 'x frequency equals', 'speed-of-sound'),
  rel('wavelength', 'is longer at lower', 'frequency'),
  rel('speed-of-sound', 'does not depend on', 'pitch'),
  rel('amplitude', 'is perceived as', 'loudness'),
  rel('frequency', 'is perceived as', 'pitch'),
  rel('rhythm', 'speeds up (above 20 per second) into', 'pitch'),
  rel('beat', 'is a slow', 'click-train'),
  rel('click-train', 'has all equal', 'harmonics'),
  rel('click-train', 'is set by its', 'repetition-rate'),
  rel('click-train', 'at 15-30 per second gives', 'flutter-and-roughness'),
  rel('repetition-rate', 'is the same number as', 'frequency'),
  rel('tempo', '1 Hz = 60 BPM: tempo is a slow', 'frequency'),
  rel('power', 'is proportional to the square of', 'amplitude'),
  rel('sine-wave', 'has just one', 'frequency'),
  rel('infrasound-and-ultrasound', 'are named by their', 'frequency'),
  rel('bridge', 'passes the vibration to the', 'soundboard'),
  rel('soundboard', 'sends the vibration into the air as', 'sound'),
  rel('vibration', 'lasts as long as the', 'length'),
  rel('chordophones', 'vibrate strings to make', 'sound'),
  rel('chordophones', 'pass the vibration via the', 'bridge'),
  rel('electrophones', 'turn electrical signals into', 'sound'),
  rel('primitive', 'is an example of', 'electrophones'),
  rel('primitive', 'is one', 'sine-wave'),
  rel('aerophones', 'give all or only odd', 'harmonics'),
  rel('membranophones', 'have non-integer', 'partial'),
  rel('idiophones', 'have non-integer', 'partial'),
  rel('hammer-strike-position', 'weakens one of the', 'harmonics'),
  rel('strings-per-note', 'detuned strings give', 'beating'),
  rel('strings-per-note', 'is a feature of', 'chordophones'),
  rel('beating', 'comes from two close', 'frequency'),
  rel('decay-across-harmonics', 'is the roll-off of the', 'harmonics'),
  rel('decay-across-harmonics', 'shapes the', 'timbre'),
  rel('harmonics', 'are whole multiples of the', 'fundamental'),
  rel('fundamental', 'is also called', 'harmonic-1'),
  rel('harmonic-1', 'is the first of the', 'harmonics'),
  rel('fundamental', 'is the lowest', 'frequency'),
  rel('fundamental', 'sets the', 'pitch'),
  rel('overtone', 'is everything above the', 'fundamental'),
  rel('partial', 'includes the', 'harmonics'),
  rel('partial', 'includes non-integer ones, as in', 'inharmonicity'),
  rel('inharmonicity', 'shifts up the', 'harmonics'),
  rel('timbre', 'comes from the mix of', 'harmonics'),
  rel('note', 'is the musical name of a', 'pitch'),
  rel('note', 'is named after the', 'fundamental'),
  rel('note', 'is coloured by the', 'timbre'),
  rel('tone', 'is a sound with a clear', 'pitch'),
  rel('tone', 'is a kind of', 'sound'),
  rel('tone', 'is pure when it is a', 'sine-wave'),
  rel('missing-fundamental', 'is still heard as the', 'pitch'),
  rel('missing-fundamental', 'is rebuilt from the', 'overtone'),
  rel('cent', 'measures differences in', 'pitch'),
  rel('harmony', 'is made of', 'note'),
  rel('harmony', 'not the same as', 'harmonics'),
  rel('octave', 'is the ratio 2:1 of', 'frequency'),
  rel('interval', 'is measured in', 'cent'),
  rel('interval', 'includes', 'octave'),
  rel('harmony', 'is built from', 'interval'),
  rel('scale', 'is built from', 'semitone'),
  rel('scale', 'is built from', 'whole-tone'),
  rel('major-scale', 'is a kind of', 'scale'),
  rel('minor-scale', 'is a kind of', 'scale'),
  rel('chromatic-scale', 'is a kind of', 'scale'),
  rel('pentatonic-scale', 'is a kind of', 'scale'),
  rel('mode', 'is a rotation of', 'scale'),
  rel('key', 'is named by its', 'tonic'),
  rel('key', 'uses the notes of a', 'scale'),
  rel('tonic', 'is the first note of a', 'scale'),
  rel('tuning', 'sets the frequencies of', 'note'),
  rel('equal-temperament', 'is a kind of', 'tuning'),
  rel('just-intonation', 'is a kind of', 'tuning'),
  rel('pythagorean-tuning', 'is a kind of', 'tuning'),
  rel('pythagorean-tuning', 'is built by stacking', 'fifth'),
  rel('reference-pitch', 'fixes', 'tuning'),
  rel('third', 'is a kind of', 'interval'),
  rel('fourth', 'is a kind of', 'interval'),
  rel('fifth', 'is a kind of', 'interval'),
  rel('fifth', 'has the ratio 3:2 in', 'just-intonation'),
  rel('third', 'has the ratio 5:4 in', 'just-intonation'),
  rel('fourth', 'has the ratio 4:3 in', 'just-intonation'),
  rel('semitone', 'is 100 cents of', 'equal-temperament'),
  rel('semitone', 'is 100', 'cent'),
  rel('whole-tone', 'is two', 'semitone'),
  rel('equal-temperament', 'divides the', 'octave'),
  rel('chromatic-scale', 'has 12 semitones per', 'octave'),
  rel('triad', 'stacks thirds on a', 'root'),
  rel('triad', 'is a kind of', 'chord'),
  rel('seventh-chord', 'adds a seventh to a', 'triad'),
  rel('seventh-chord', 'is a kind of', 'chord'),
  rel('chord', 'is built on a', 'root'),
  rel('inversion', 'rearranges the notes of a', 'chord'),
  rel('chord', 'is made of', 'note'),
  rel('chord', 'makes', 'harmony'),
  rel('chord-progression', 'is a sequence of', 'chord'),
  rel('cadence', 'ends a', 'chord-progression'),
  rel('consonance', 'describes', 'interval'),
  rel('dissonance', 'describes', 'interval'),
  rel('dissonance', 'is partly caused by', 'beating'),
  rel('melody', 'is a sequence of', 'note'),
  rel('melody', 'is supported by', 'harmony'),
  rel('circle-of-fifths', 'orders keys by', 'fifth'),
  rel('key', 'is a point on the', 'circle-of-fifths'),
  rel('pitch-detection', 'finds the', 'fundamental'),
  rel('pitch-detection', 'still works with a', 'missing-fundamental'),
  rel('octave-error', 'is a typical mistake of', 'pitch-detection'),
  rel('db-spl', 'measures in the room the', 'loudness'),
  rel('dbfs', 'is a digital level, unlike', 'db-spl'),
  rel('dbfs', 'is 20 x log10 of the', 'amplitude'),
  rel('waveform', 'shows over time the', 'amplitude'),
  rel('oscilloscope', 'draws the', 'waveform'),
  rel('waveform', 'shows one', 'cycle-and-period'),
  rel('waveform', 'maps one cycle to one', 'wavelength'),
  rel('time-window', 'sets how much time is shown across the', 'waveform'),
  rel('spectrum', 'shows level across', 'frequency'),
  rel('spectrogram', 'shows over time the', 'spectrum'),
  rel('beat-bands', 'split the sound into ranges of', 'frequency'),
  rel('beat-bands', 'show the beat behind the', 'bpm'),
  rel('tempo-grid', 'draws the detected', 'bpm'),
  rel('bpm', 'is estimated over', 'analysis-window'),
  rel('tempo-grid', 'is drawn over the', 'beat-bands'),
  rel('trails', 'keep a fading ghost on the', 'spectrum'),
  rel('harmonic-markers', 'are ticks on the', 'spectrum'),
  rel('harmonic-markers', 'sit at multiples found by', 'pitch-detection'),
  rel('sawtooth-wave', 'has all', 'harmonics'),
  rel('square-wave', 'has only odd', 'harmonics'),
  rel('triangle-wave', 'has only odd', 'harmonics'),
  rel('sawtooth-wave', 'is a shape of the', 'waveform'),
  rel('square-wave', 'is a shape of the', 'waveform'),
  rel('triangle-wave', 'is a shape of the', 'waveform'),
  rel('pulse-wave', 'has a width called the', 'duty-cycle'),
  rel('square-wave', 'is a pulse wave with 50 percent', 'duty-cycle'),
  rel('square-wave', 'is a special case of the', 'pulse-wave'),
  rel('white-noise', 'has equal power at every', 'frequency'),
  rel('pink-noise', 'is filtered from', 'white-noise'),
  rel('pink-noise', 'falls 3 dB per', 'octave'),
  rel('spectrum-analyzer', 'shows the', 'spectrum'),
  rel('fourier-transform', 'is used by the', 'spectrum-analyzer'),
  rel('fourier-transform', 'splits any wave into', 'sine-wave'),
  rel('rhythm', 'is built from', 'beat'),
  rel('beat', 'repeats at the', 'tempo'),
  rel('tempo', 'is measured in', 'bpm'),
  rel('meter', 'groups beats into', 'bar'),
  rel('meter', 'sets how many', 'beat'),
  rel('bar', 'starts with the', 'downbeat'),
  rel('downbeat', 'is the first and strongest', 'beat'),
  rel('onset', 'is detected by', 'beat-bands'),
  rel('onset', 'is the start of a', 'sound'),
  rel('syncopation', 'puts accents off the', 'beat'),
  rel('subdivision', 'splits the', 'beat'),
  rel('swing', 'makes uneven the', 'subdivision'),
  rel('tempo-grid', 'marks the', 'beat'),
  rel('power', 'is not the same as', 'loudness'),
  rel('loudness', 'also depends on', 'frequency'),
  rel('sound-wave', 'is made of', 'compression-and-rarefaction'),
  rel('sound', 'travels as a', 'sound-wave'),
  rel('wavelength', 'is the length of one', 'sound-wave'),
  rel('speed-of-sound', 'is the speed of a', 'sound-wave'),
];

const LABELS = {
  'infrasound-and-ultrasound': 'Infra- and ultrasound',
  'strings-per-note': 'Strings per note',
  spectrum: 'Spectrum',
  spectrogram: 'Spectrogram',
  trails: 'Trails',
  'pitch-detection': 'Pitch detection',
};

export const mapLabel = (term) => LABELS[term.id] ?? term.term;

const NODE_H = 26;
const CHAR_W = 6.6;
export const nodeWidth = (label) => Math.round(label.length * CHAR_W + 24);

export function buildGraph(terms = TERMS, relations = RELATIONS) {
  const nodes = terms.filter((t) => DOMAIN_OF[t.id]).map((t) => {
    const label = mapLabel(t);
    return { id: t.id, term: t.term, aliases: t.aliases ?? [], label, domain: DOMAIN_OF[t.id], w: nodeWidth(label), h: NODE_H, x: 0, y: 0 };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = relations.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r, i) => ({ ...r, i }));
  return { nodes, edges };
}

export function neighbourMap(edges) {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return adj;
}

export function relationsOf(id, edges) {
  return edges.filter((e) => e.from === id || e.to === id).map((e) => ({ edge: e, out: e.from === id, other: e.from === id ? e.to : e.from }));
}

export function matchSet(terms, query) {
  const q = String(query ?? '').trim();
  return q ? new Set(filterTerms(terms, q).map((t) => t.id)) : null;
}

const WIDE_START = {
  instruments: { x: -440, y: -130 },
  physics: { x: -60, y: -150 },
  analysis: { x: 380, y: -130 },
  perception: { x: -300, y: 160 },
  music: { x: 120, y: 170 },
  theory: { x: 520, y: 200 },
};

const TALL_ORDER = ['analysis', 'physics', 'instruments', 'music', 'theory', 'perception'];

export const BOX = {
  pad: 14,
  head: 30,
  colGap: 12,
  rowGap: 8,
  gap: 28,
  maxCols: 3,
  tallCols: 2,
  goal: 1.15,
  lo: 0.9,
  hi: 1.5,
  min: 0.8,
  max: 1.6,
};

export function domainGrid(sizes, maxCols = BOX.maxCols, lo = BOX.lo) {
  const n = sizes.w.length;
  const colW = Math.max(...sizes.w);
  let best = null;
  for (let cols = 1; cols <= Math.min(maxCols, n); cols++) {
    const rows = Math.ceil(n / cols);
    const w = cols * colW + (cols - 1) * BOX.colGap + 2 * BOX.pad;
    const h = BOX.head + rows * sizes.h + (rows - 1) * BOX.rowGap + BOX.pad;
    const score = Math.abs(Math.log(w / h / BOX.goal));
    if (!best || score < best.score - 1e-9) best = { cols, rows, w, h, score };
  }
  let { cols, rows, w, h } = best;
  let rowGap = BOX.rowGap;
  let top = BOX.head;
  let side = BOX.pad;
  if (w / h > BOX.hi) {
    const extra = w / BOX.hi - h;
    const inGaps = rows > 1 ? Math.min(extra / (rows - 1), 12) : 0;
    rowGap += inGaps;
    const left = extra - inGaps * (rows - 1);
    top += left / 2;
    h += extra;
  } else if (w / h < lo) {
    const extra = h * lo - w;
    side += extra / 2;
    w += extra;
  }
  return { cols, rows, colW, rowGap, top, side, w: Math.ceil(w), h: Math.ceil(h) };
}

function placeBoxes(boxes, shape, edges, domainOf) {
  const weight = new Map();
  for (const e of edges) {
    const a = domainOf.get(e.from);
    const b = domainOf.get(e.to);
    if (!a || !b || a === b) continue;
    const k = [a, b].sort().join('|');
    weight.set(k, (weight.get(k) ?? 0) + 1);
  }
  const byId = new Map(boxes.map((b) => [b.id, b]));
  if (shape === 'tall') {
    const order = TALL_ORDER.filter((id) => byId.has(id));
    let y = 0;
    for (const id of order) {
      const b = byId.get(id);
      b.cx = 0;
      b.cy = y + b.h / 2;
      y += b.h + BOX.gap;
    }
    return;
  }
  for (const b of boxes) {
    const s = WIDE_START[b.id] ?? { x: 0, y: 0 };
    b.cx = s.x;
    b.cy = s.y;
  }
  const separate = () => {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i];
        const q = boxes[j];
        const dx = q.cx - p.cx;
        const dy = q.cy - p.cy;
        const ox = (p.w + q.w) / 2 + BOX.gap - Math.abs(dx);
        const oy = (p.h + q.h) / 2 + BOX.gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (oy < ox) {
          const s = ((dy >= 0 ? 1 : -1) * oy) / 2;
          p.cy -= s;
          q.cy += s;
        } else {
          const s = ((dx >= 0 ? 1 : -1) * ox) / 2;
          p.cx -= s;
          q.cx += s;
        }
      }
    }
  };
  const iterations = 400;
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    for (const b of boxes) {
      b.cx -= b.cx * 0.002;
      b.cy -= b.cy * 0.03;
    }
    for (const [k, wgt] of weight) {
      const [a, c] = k.split('|').map((id) => byId.get(id));
      if (!a || !c) continue;
      const dx = c.cx - a.cx;
      const dy = c.cy - a.cy;
      const f = 0.012 * wgt * alpha;
      a.cx += dx * f * 0.5;
      a.cy += dy * f;
      c.cx -= dx * f * 0.5;
      c.cy -= dy * f;
    }
    separate();
  }
  for (let it = 0; it < 200; it++) separate();
}

export function layoutDomains(nodes, edges, shape = 'wide') {
  const members = {};
  for (const n of nodes) (members[n.domain] ??= []).push(n);
  const boxes = [];
  for (const d of DOMAINS) {
    const list = members[d.id];
    if (!list) continue;
    const flow = MEMBERS[d.id];
    list.sort((a, b) => flow.indexOf(a.id) - flow.indexOf(b.id));
    for (const n of list) n.w = nodeWidth(n.label);
    const grid = domainGrid({ w: list.map((n) => n.w), h: NODE_H }, shape === 'tall' ? BOX.tallCols : BOX.maxCols, shape === 'tall' ? BOX.min : BOX.lo);
    boxes.push({ id: d.id, label: d.label, count: list.length, ...grid, cx: 0, cy: 0 });
  }
  const boxOf = new Map(boxes.map((b) => [b.id, b]));
  placeBoxes(boxes, shape, edges, new Map(nodes.map((n) => [n.id, n.domain])));
  for (const b of boxes) {
    const list = members[b.id];
    const x0 = b.cx - b.w / 2;
    const y0 = b.cy - b.h / 2;
    list.forEach((n, k) => {
      n.w = b.colW;
      n.x = x0 + b.side + (k % b.cols) * (b.colW + BOX.colGap) + b.colW / 2;
      n.y = y0 + b.top + Math.floor(k / b.cols) * (NODE_H + b.rowGap) + NODE_H / 2;
    });
    b.x0 = x0;
    b.y0 = y0;
    b.x1 = x0 + b.w;
    b.y1 = y0 + b.h;
    b.aspect = b.w / b.h;
  }
  return { nodes, boxes: [...boxOf.values()] };
}

export function layoutGraph(nodes, edges, shape = 'wide') {
  return layoutDomains(nodes, edges, shape).nodes;
}

export function boxBounds(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

export function contentBounds(nodes, boxes) {
  const b = boxBounds(boxes);
  const n = boundsOf(nodes);
  return { x0: Math.max(b.x0, n.x0 - BOX.pad), x1: Math.min(b.x1, n.x1 + BOX.pad), y0: b.y0, y1: b.y1 };
}

export function boundsOf(nodes) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - n.w / 2);
    x1 = Math.max(x1, n.x + n.w / 2);
    y0 = Math.min(y0, n.y - n.h / 2);
    y1 = Math.max(y1, n.y + n.h / 2);
  }
  return { x0, y0, x1, y1 };
}

export function fitView(b, W, H, { pad = 20, minK = 0.1, maxK = 1.6 } = {}) {
  const bw = Math.max(b.x1 - b.x0, 40);
  const bh = Math.max(b.y1 - b.y0, 40);
  const k = Math.min(maxK, Math.max(minK, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh)));
  return { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: H / 2 - ((b.y0 + b.y1) / 2) * k };
}

export const READ_K = 0.7;

export function initialView(b, W, H, { pad = 20, readK = READ_K } = {}) {
  const all = fitView(b, W, H, { pad });
  const widthK = Math.min(1.6, (W - 2 * pad) / Math.max(b.x1 - b.x0, 40));
  const k = Math.max(all.k, Math.min(readK, widthK));
  if (k <= all.k + 1e-9) return all;
  return { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: pad - b.y0 * k };
}

export function zoomAbout(tf, px, py, f, minK, maxK) {
  const k = Math.min(maxK, Math.max(minK, tf.k * f));
  const wx = (px - tf.x) / tf.k;
  const wy = (py - tf.y) / tf.k;
  return { k, x: px - wx * k, y: py - wy * k };
}

export function edgeEnds(a, b, gap = 1) {
  const clip = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const hw = from.w / 2 + gap;
    const hh = from.h / 2 + gap;
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity, 1);
    return { x: from.x + dx * t, y: from.y + dy * t };
  };
  const p = clip(a, b);
  const q = clip(b, a);
  return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
}

export const PILL_K = 1;
export const LABEL_PAD = 8;
export const LABEL_H = 14;

export const pillScale = (k) => Math.min(1, k / PILL_K);

export function placeLabels(cands, obstacles, { pad = LABEL_PAD, h = LABEL_H } = {}) {
  const rectOf = (c) => ({ x0: c.x - c.w / 2, x1: c.x + c.w / 2, y0: c.y - h + 4, y1: c.y + 4 });
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const solid = obstacles.map((o) => ({ x0: o.x - o.w / 2, x1: o.x + o.w / 2, y0: o.y - o.h / 2, y1: o.y + o.h / 2 }));
  const placed = [];
  const shown = new Set();
  const forced = cands.filter((c) => c.force);
  for (const c of forced) {
    placed.push(rectOf(c));
    shown.add(c.i);
  }
  const rest = cands.filter((c) => !c.force && c.len >= c.w + pad).sort((a, b) => b.len - a.len || a.i - b.i);
  for (const c of rest) {
    const r = rectOf(c);
    if (solid.some((s) => hit(r, s)) || placed.some((s) => hit(r, s))) continue;
    placed.push(r);
    shown.add(c.i);
  }
  return shown;
}

export function neighbourInDirection(from, others, dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  let best = null;
  let bestScore = Infinity;
  for (const o of others) {
    const vx = o.x - from.x;
    const vy = o.y - from.y;
    const dot = (vx * dx + vy * dy) / len;
    if (dot <= 0) continue;
    const dist = Math.hypot(vx, vy) || 1;
    const score = Math.abs(Math.atan2((vx * dy - vy * dx) / len, dot)) * 1000 + dist / 1000;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export const shapeFor = (W, H) => (W / Math.max(H, 1) >= 1.15 ? 'wide' : 'tall');
