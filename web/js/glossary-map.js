import { TERMS, filterTerms } from './glossary-terms.js';

export const DOMAINS = [
  { id: 'physics', label: 'Physics of sound', token: '--chart-6' },
  { id: 'perception', label: 'Perception', token: '--chart-3' },
  { id: 'music', label: 'Music', token: '--chart-7' },
  { id: 'instruments', label: 'Instruments', token: '--chart-5' },
  { id: 'analysis', label: 'Analysis tools', token: '--chart-0' },
];

const MEMBERS = {
  physics: ['sound', 'oscillation', 'vibration', 'cycle-and-period', 'frequency', 'wavelength', 'amplitude', 'power', 'speed-of-sound', 'sine-wave', 'infrasound-and-ultrasound', 'soundboard', 'bridge', 'length'],
  perception: ['pitch', 'timbre', 'missing-fundamental', 'cent', 'loudness'],
  music: ['note', 'tone', 'fundamental', 'harmonic-1', 'harmonics', 'overtone', 'partial', 'inharmonicity', 'beating', 'hammer-strike-position', 'strings-per-note', 'decay-across-harmonics', 'harmony', 'octave', 'interval'],
  instruments: ['chordophones', 'aerophones', 'membranophones', 'idiophones', 'electrophones', 'primitive'],
  analysis: ['waveform', 'oscilloscope', 'spectrum', 'spectrogram', 'beat-bands', 'tempo-grid', 'bpm', 'trails', 'harmonic-markers', 'pitch-detection', 'octave-error', 'dbfs', 'db-spl', 'time-window'],
};

export const DOMAIN_OF = Object.fromEntries(Object.entries(MEMBERS).flatMap(([domain, ids]) => ids.map((id) => [id, domain])));

const rel = (from, label, to) => ({ from, label, to });

export const RELATIONS = [
  rel('sound', 'is a kind of', 'oscillation'),
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
  rel('pitch-detection', 'finds the', 'fundamental'),
  rel('pitch-detection', 'still works with a', 'missing-fundamental'),
  rel('octave-error', 'is a typical mistake of', 'pitch-detection'),
  rel('db-spl', 'measures in the room the', 'loudness'),
  rel('dbfs', 'is a digital level, unlike', 'db-spl'),
  rel('dbfs', 'is 20 x log10 of the', 'amplitude'),
  rel('waveform', 'shows over time the', 'amplitude'),
  rel('oscilloscope', 'draws the', 'waveform'),
  rel('oscilloscope', 'shows one', 'cycle-and-period'),
  rel('oscilloscope', 'maps one cycle to one', 'wavelength'),
  rel('time-window', 'sets how much time is shown across the', 'oscilloscope'),
  rel('spectrum', 'shows level across', 'frequency'),
  rel('spectrogram', 'shows over time the', 'spectrum'),
  rel('beat-bands', 'split the sound into ranges of', 'frequency'),
  rel('beat-bands', 'show the beat behind the', 'bpm'),
  rel('tempo-grid', 'draws the detected', 'bpm'),
  rel('tempo-grid', 'is drawn over the', 'beat-bands'),
  rel('trails', 'keep a fading ghost on the', 'spectrum'),
  rel('harmonic-markers', 'are ticks on the', 'spectrum'),
  rel('harmonic-markers', 'sit at multiples found by', 'pitch-detection'),
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

const RING_ANGLE = { instruments: -90, analysis: -18, music: 54, perception: 126, physics: 198 };

export const WIDE_RING = { rx: 380, ry: 215 };

const TALL_CENTERS = {
  physics: { x: -105, y: -300 },
  analysis: { x: 105, y: -310 },
  perception: { x: -105, y: 80 },
  music: { x: 105, y: 100 },
  instruments: { x: -105, y: 330 },
};

export function clusterCenters(shape) {
  if (shape === 'tall') return TALL_CENTERS;
  const { rx, ry } = WIDE_RING;
  return Object.fromEntries(Object.entries(RING_ANGLE).map(([d, deg]) => [d, { x: rx * Math.cos((deg * Math.PI) / 180), y: ry * Math.sin((deg * Math.PI) / 180) }]));
}

const GOLDEN = 2.399963;

export function layoutGraph(nodes, edges, shape = 'wide', { iterations = 360 } = {}) {
  const centers = clusterCenters(shape);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = {};
  for (const n of nodes) {
    const c = centers[n.domain];
    const i = seen[n.domain] = (seen[n.domain] ?? -1) + 1;
    const a = i * GOLDEN;
    const r = 30 * Math.sqrt(i + 1);
    n.x = c.x + r * Math.cos(a);
    n.y = c.y + r * Math.sin(a) * 0.7;
  }
  const pairs = edges.map((e) => [byId.get(e.from), byId.get(e.to)]);
  const MX = 12;
  const MY = 8;
  const separate = () => {
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const p = nodes[a];
        const q = nodes[b];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const ox = (p.w + q.w) / 2 + MX - Math.abs(dx);
        const oy = (p.h + q.h) / 2 + MY - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (oy < ox) {
          const s = (dy >= 0 ? 1 : -1) * oy / 2;
          p.y -= s;
          q.y += s;
        } else {
          const s = (dx >= 0 ? 1 : -1) * ox / 2;
          p.x -= s;
          q.x += s;
        }
      }
    }
  };
  const [gx, gy] = shape === 'tall' ? [0.3, 0.03] : [0.05, 0.05];
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    for (const n of nodes) {
      const c = centers[n.domain];
      n.x += (c.x - n.x) * gx;
      n.y += (c.y - n.y) * gy;
    }
    for (const [p, q] of pairs) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const same = p.domain === q.domain;
      const rest = same ? 120 : 0;
      const f = (same ? 0.08 : 0.012) * alpha * (d - rest) / d;
      if (f <= 0) continue;
      p.x += dx * f;
      p.y += dy * f;
      q.x -= dx * f;
      q.y -= dy * f;
    }
    separate();
  }
  for (let it = 0; it < 80; it++) separate();
  return nodes;
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
