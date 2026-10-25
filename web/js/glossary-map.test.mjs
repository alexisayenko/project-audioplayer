import { test } from 'node:test';
import assert from 'node:assert/strict';

const { TERMS, termById } = await import('./glossary-terms.js');
const {
  DOMAINS, DOMAIN_OF, RELATIONS, termsByDomain, buildGraph, neighbourMap, relationsOf, layoutGraph, layoutDomains, boxBounds, contentBounds, nodeWidth, initialView, boundsOf, fitView, zoomAbout, edgeEnds, neighbourInDirection, matchSet, shapeFor, mapLabel, pillScale, PILL_K, LABEL_PAD, placeLabels,
} =await import('./glossary-map.js');
const { glossaryViewFromHash, glossaryTermFromHash, glossaryMapTermFromHash, pageFromHash } = await import('../../studio/routes.js');

test('STU-037: every relation ends at an existing term, with a label, no self loop and no duplicate', () => {
  const seen = new Set();
  for (const r of RELATIONS) {
    assert.ok(termById(r.from), `from ${r.from}`);
    assert.ok(termById(r.to), `to ${r.to}`);
    assert.notEqual(r.from, r.to, r.from);
    assert.ok(r.label.trim().length > 0, `${r.from} -> ${r.to}`);
    const key = [r.from, r.to].sort().join('|');
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
  }
  assert.equal(RELATIONS.length, 156);
  assert.equal(TERMS.length, 105);
});

test('STU-037: every term is in exactly one domain, every domain is non-empty and every term has a relation', () => {
  const ids = new Set(DOMAINS.map((d) => d.id));
  assert.equal(DOMAINS.length, 6);
  for (const t of TERMS) assert.ok(ids.has(DOMAIN_OF[t.id]), `no domain for ${t.id}`);
  for (const id of Object.keys(DOMAIN_OF)) assert.ok(termById(id), `domain entry for unknown term ${id}`);
  for (const d of DOMAINS) {
    assert.match(d.token, /^--chart-\d+$/, d.id);
    assert.ok(TERMS.some((t) => DOMAIN_OF[t.id] === d.id), `empty domain ${d.id}`);
  }
  assert.equal(new Set(DOMAINS.map((d) => d.token)).size, DOMAINS.length);
  const linked = new Set(RELATIONS.flatMap((r) => [r.from, r.to]));
  for (const t of TERMS) assert.ok(linked.has(t.id), `${t.id} has no relation`);
});

test('STU-037: the relations asked for are present', () => {
  const has = (from, to, part) => RELATIONS.some((r) => r.from === from && r.to === to && r.label.includes(part));
  assert.ok(has('sound', 'oscillation', 'kind of'));
  assert.ok(has('frequency', 'cycle-and-period', 'inverse'));
  assert.ok(has('frequency', 'speed-of-sound', 'wavelength'));
  assert.ok(has('frequency', 'pitch', 'perceived'));
  assert.ok(has('amplitude', 'loudness', 'perceived'));
  assert.ok(has('power', 'amplitude', 'square'));
  assert.ok(has('harmonics', 'fundamental', 'multiples'));
  assert.ok(has('fundamental', 'pitch', 'sets'));
  assert.ok(has('octave-error', 'pitch-detection', 'mistake'));
  assert.ok(has('harmony', 'note', 'made of'));
  assert.ok(has('harmony', 'harmonics', 'not the same as'));
  assert.ok(has('octave', 'frequency', '2:1'));
  assert.ok(has('interval', 'cent', 'measured in'));
  assert.ok(has('interval', 'octave', 'includes'));
  assert.ok(has('harmony', 'interval', 'built from'));
  for (const id of ['harmony', 'octave', 'interval']) assert.equal(DOMAIN_OF[id], 'theory', id);
  assert.match(termById('speed-of-sound').text, /343 m\/s in air at 20 °C/);
  assert.match(termById('loudness').text, /follows the amplitude/);
});

test('STU-037: the waveform, noise, analysis and rhythm terms sit in their domains with their links', () => {
  const has = (from, to, part) => RELATIONS.some((r) => r.from === from && r.to === to && r.label.includes(part));
  for (const id of ['sawtooth-wave', 'square-wave', 'triangle-wave', 'pulse-wave', 'duty-cycle', 'white-noise', 'pink-noise']) assert.equal(DOMAIN_OF[id], 'physics', id);
  for (const id of ['spectrum-analyzer', 'fourier-transform']) assert.equal(DOMAIN_OF[id], 'analysis', id);
  for (const id of ['rhythm', 'beat', 'tempo', 'meter', 'bar', 'downbeat', 'onset', 'syncopation', 'subdivision', 'swing']) assert.equal(DOMAIN_OF[id], 'music', id);
  assert.ok(has('sawtooth-wave', 'harmonics', 'all'));
  assert.ok(has('square-wave', 'harmonics', 'only odd'));
  assert.ok(has('triangle-wave', 'harmonics', 'only odd'));
  assert.ok(has('pulse-wave', 'duty-cycle', 'width'));
  assert.ok(has('square-wave', 'duty-cycle', '50 percent'));
  assert.ok(has('pink-noise', 'white-noise', 'filtered'));
  assert.ok(has('spectrum-analyzer', 'spectrum', 'shows'));
  assert.ok(has('fourier-transform', 'spectrum-analyzer', 'used by'));
  assert.ok(has('beat', 'tempo', 'repeats'));
  assert.ok(has('tempo', 'bpm', 'measured in'));
  assert.ok(has('meter', 'beat', 'sets how many') && has('meter', 'bar', 'groups'));
  assert.ok(has('bar', 'downbeat', 'starts'));
  assert.ok(has('onset', 'beat-bands', 'detected'));
  assert.ok(has('swing', 'subdivision', 'uneven'));
  assert.ok(has('tempo-grid', 'beat', 'marks'));
  assert.ok(has('power', 'loudness', 'not the same'));
  assert.ok(has('amplitude', 'loudness', 'perceived'));
});

test('STU-037: the music theory domain holds 32 terms with its links, and Temperament is an alias of Tuning', () => {
  const has = (from, to, part) => RELATIONS.some((r) => r.from === from && r.to === to && r.label.includes(part));
  const theory = DOMAINS.find((d) => d.id === 'theory');
  assert.equal(theory.label, 'Music theory');
  assert.match(theory.token, /^--chart-\d+$/);
  assert.equal(TERMS.filter((t) => DOMAIN_OF[t.id] === 'theory').length, 32);
  for (const id of ['scale', 'major-scale', 'minor-scale', 'mode', 'key', 'tonic', 'semitone', 'whole-tone', 'tuning', 'equal-temperament', 'just-intonation', 'pythagorean-tuning', 'third', 'fourth', 'fifth', 'triad', 'chord', 'root', 'inversion', 'seventh-chord', 'chord-progression', 'cadence', 'consonance', 'dissonance', 'melody', 'circle-of-fifths', 'chromatic-scale', 'pentatonic-scale', 'reference-pitch']) assert.equal(DOMAIN_OF[id], 'theory', id);
  for (const id of ['note', 'tone', 'fundamental', 'harmonics', 'rhythm', 'beat']) assert.equal(DOMAIN_OF[id], 'music', id);
  assert.equal(termById('temperament'), undefined);
  assert.ok(has('scale', 'semitone', 'built from') && has('scale', 'whole-tone', 'built from'));
  for (const id of ['major-scale', 'minor-scale', 'chromatic-scale', 'pentatonic-scale']) assert.ok(has(id, 'scale', 'kind of'), id);
  for (const id of ['equal-temperament', 'just-intonation', 'pythagorean-tuning']) assert.ok(has(id, 'tuning', 'kind of'), id);
  for (const id of ['third', 'fourth', 'fifth']) assert.ok(has(id, 'interval', 'kind of'), id);
  assert.ok(has('mode', 'scale', 'rotation'));
  assert.ok(has('key', 'tonic', 'named by'));
  assert.ok(has('fifth', 'just-intonation', '3:2'));
  assert.ok(has('semitone', 'equal-temperament', '100 cents'));
  assert.ok(has('whole-tone', 'semitone', 'two'));
  assert.ok(has('triad', 'root', 'stacks thirds'));
  assert.ok(has('seventh-chord', 'triad', 'adds a seventh'));
  assert.ok(has('inversion', 'chord', 'rearranges'));
  assert.ok(has('chord', 'harmony', 'makes'));
  assert.ok(has('chord-progression', 'chord', 'sequence'));
  assert.ok(has('cadence', 'chord-progression', 'ends'));
  assert.ok(has('melody', 'harmony', 'supported'));
  assert.ok(has('key', 'circle-of-fifths', 'point'));
  assert.ok(has('circle-of-fifths', 'fifth', 'orders keys'));
  assert.ok(has('equal-temperament', 'octave', 'divides'));
  assert.ok(matchSet(TERMS, 'квинта').has('fifth'));
});

test('STU-044: Sound wave is a Physics of sound term with its four links, and the six categories list 23, 5, 22, 32, 6 and 17 terms', () => {
  const has = (from, to, label) => RELATIONS.some((r) => r.from === from && r.to === to && r.label === label);
  assert.equal(DOMAIN_OF['sound-wave'], 'physics');
  assert.ok(has('sound-wave', 'compression-and-rarefaction', 'is made of'));
  assert.ok(has('sound', 'sound-wave', 'travels as a'));
  assert.ok(has('wavelength', 'sound-wave', 'is the length of one'));
  assert.ok(has('speed-of-sound', 'sound-wave', 'is the speed of a'));
  const groups = termsByDomain();
  assert.deepEqual(groups.map((g) => g.label), ['Physics of sound', 'Perception', 'Music', 'Music theory', 'Instruments', 'Analysis tools']);
  assert.deepEqual(groups.map((g) => g.terms.length), [23, 5, 22, 32, 6, 17]);
  for (const g of groups) assert.deepEqual(g.terms.map((t) => t.term), [...g.terms.map((t) => t.term)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  assert.equal(groups.reduce((n, g) => n + g.terms.length, 0), TERMS.length);
});

test('STU-037: buildGraph gives one node per mapped term and keeps only edges between them', () => {
  const { nodes, edges } = buildGraph();
  assert.equal(nodes.length, TERMS.length);
  assert.equal(edges.length, RELATIONS.length);
  const sub = buildGraph(TERMS.filter((t) => t.id !== 'frequency'));
  assert.equal(sub.nodes.length, TERMS.length - 1);
  assert.ok(sub.edges.every((e) => e.from !== 'frequency' && e.to !== 'frequency'));
  assert.equal(mapLabel(termById('spectrum')), 'Spectrum');
  assert.equal(mapLabel(termById('frequency')), 'Frequency');
  assert.equal(nodes.length, 105);
  assert.equal(edges.length, 156);
  assert.deepEqual(nodes.find((n) => n.id === 'timbre').aliases, termById('timbre').aliases);
  assert.deepEqual(nodes.find((n) => n.id === 'bpm').aliases, termById('bpm').aliases);
  assert.deepEqual(nodes.find((n) => n.id === 'sound').aliases, []);
});

test('STU-037: neighbours and relations of a term, both directions', () => {
  const { edges } = buildGraph();
  const adj = neighbourMap(edges);
  for (const id of ['cycle-and-period', 'wavelength', 'pitch']) assert.ok(adj.get('frequency').has(id), id);
  const rels = relationsOf('frequency', edges);
  assert.ok(rels.some((r) => r.out && r.other === 'pitch'));
  assert.ok(rels.some((r) => !r.out && r.other === 'oscillation'));
  assert.equal(rels.length, adj.get('frequency').size);
});

test('STU-038: the layout is deterministic, finite and leaves no two nodes overlapping, in both shapes', () => {
  for (const shape of ['wide', 'tall']) {
    const a = buildGraph();
    const b = buildGraph();
    layoutGraph(a.nodes, a.edges, shape);
    layoutGraph(b.nodes, b.edges, shape);
    assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]));
    for (const n of a.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), n.id);
    for (let i = 0; i < a.nodes.length; i++) {
      for (let j = i + 1; j < a.nodes.length; j++) {
        const p = a.nodes[i];
        const q = a.nodes[j];
        const apart = Math.abs(p.x - q.x) >= (p.w + q.w) / 2 || Math.abs(p.y - q.y) >= (p.h + q.h) / 2;
        assert.ok(apart, `${shape}: ${p.id} overlaps ${q.id}`);
      }
    }
  }
});

test('STU-038: every domain box has an aspect ratio of 0.8 to 1.6, holds its nodes and overlaps no other box, in both shapes', () => {
  for (const shape of ['wide', 'tall']) {
    const g = buildGraph();
    const { nodes, boxes } = layoutDomains(g.nodes, g.edges, shape);
    assert.equal(boxes.length, DOMAINS.length);
    for (const b of boxes) {
      const ratio = (b.x1 - b.x0) / (b.y1 - b.y0);
      assert.ok(ratio >= 0.8 && ratio <= 1.6, `${shape}: ${b.id} aspect ${ratio.toFixed(2)}`);
      assert.ok(b.cols >= 1 && b.cols <= 3, `${shape}: ${b.id} columns ${b.cols}`);
      for (const n of nodes.filter((m) => m.domain === b.id)) {
        assert.ok(n.x - n.w / 2 >= b.x0 && n.x + n.w / 2 <= b.x1 && n.y - n.h / 2 >= b.y0 && n.y + n.h / 2 <= b.y1, `${shape}: ${n.id} outside ${b.id}`);
        assert.ok(n.w >= nodeWidth(n.label), `${shape}: ${n.id} narrower than its label`);
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i];
        const q = boxes[j];
        const apart = p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0;
        assert.ok(apart, `${shape}: box ${p.id} overlaps box ${q.id}`);
      }
    }
    const all = boxBounds(boxes);
    for (const n of nodes) assert.ok(n.x - n.w / 2 >= all.x0 && n.x + n.w / 2 <= all.x1 && n.y - n.h / 2 >= all.y0 && n.y + n.h / 2 <= all.y1, n.id);
  }
});

test('STU-038: the physics domain is laid out in two columns, row by row in concept order, and the big domains never use one', () => {
  const g = buildGraph();
  const { nodes, boxes } = layoutDomains(g.nodes, g.edges, 'wide');
  const physics = boxes.find((b) => b.id === 'physics');
  assert.equal(physics.cols, 2);
  const at = (id) => nodes.find((n) => n.id === id);
  assert.ok(Math.abs(at('sound').y - at('oscillation').y) < 1e-9 && at('sound').x < at('oscillation').x);
  assert.ok(at('vibration').y > at('sound').y && Math.abs(at('vibration').x - at('sound').x) < 1e-9);
  for (const b of boxes.filter((m) => m.count >= 10)) assert.ok(b.cols >= 2, b.id);
});

test('STU-038: the initial view is readable, shows everything when it can and Fit shows every box', () => {
  const g = buildGraph();
  const { boxes } = layoutDomains(g.nodes, g.edges, 'wide');
  const b = boxBounds(boxes);
  const desktop = initialView(b, 900, 620);
  assert.ok(desktop.k >= 0.7);
  const fitAll = fitView(b, 900, 620);
  assert.ok(fitAll.x + b.x0 * fitAll.k >= 0 && fitAll.x + b.x1 * fitAll.k <= 900 && fitAll.y + b.y0 * fitAll.k >= 0 && fitAll.y + b.y1 * fitAll.k <= 620);
  const t = buildGraph();
  const tall = layoutDomains(t.nodes, t.edges, 'tall');
  const tb = boxBounds(tall.boxes);
  const phone = initialView(tb, 303, 545);
  assert.ok(phone.k >= 0.55, `phone zoom ${phone.k}`);
  assert.ok(phone.x + tb.x0 * phone.k >= 0 && phone.x + tb.x1 * phone.k <= 303);
  assert.ok(fitView(tb, 303, 545).k < phone.k);
  const content = contentBounds(tall.nodes, tall.boxes);
  assert.ok(content.x1 - content.x0 < tb.x1 - tb.x0 && content.y0 === tb.y0 && content.y1 === tb.y1);
  const phoneRead = initialView(content, 303, 545);
  assert.ok(phoneRead.k >= 0.69, `phone reading zoom ${phoneRead.k}`);
});

test('STU-038: the wide layout is wide and the tall layout is tall', () => {
  const wide = buildGraph();
  layoutGraph(wide.nodes, wide.edges, 'wide');
  const tall = buildGraph();
  layoutGraph(tall.nodes, tall.edges, 'tall');
  const bw = boundsOf(wide.nodes);
  const bt = boundsOf(tall.nodes);
  assert.ok(bw.x1 - bw.x0 > bw.y1 - bw.y0);
  assert.ok(bt.y1 - bt.y0 > bt.x1 - bt.x0);
  assert.equal(shapeFor(900, 560), 'wide');
  assert.equal(shapeFor(300, 585), 'tall');
});

test('STU-038: fitView centres the bounds, zoomAbout keeps the point under the cursor and edgeEnds stop at the node borders', () => {
  const tf = fitView({ x0: -100, y0: -50, x1: 100, y1: 50 }, 400, 300, { pad: 20 });
  assert.ok(Math.abs(tf.k - 1.6) < 1e-9);
  assert.ok(Math.abs(tf.x - 200) < 1e-9 && Math.abs(tf.y - 150) < 1e-9);
  const z = zoomAbout({ k: 1, x: 10, y: 20 }, 150, 90, 2, 0.1, 3);
  assert.equal(z.k, 2);
  assert.equal((150 - z.x) / z.k, (150 - 10) / 1);
  assert.equal((90 - z.y) / z.k, (90 - 20) / 1);
  assert.equal(zoomAbout({ k: 2.5, x: 0, y: 0 }, 0, 0, 4, 0.1, 3).k, 3);
  assert.equal(zoomAbout({ k: 0.2, x: 0, y: 0 }, 0, 0, 0.1, 0.15, 3).k, 0.15);
  const e = edgeEnds({ x: 0, y: 0, w: 100, h: 20 }, { x: 200, y: 0, w: 60, h: 20 }, 0);
  assert.deepEqual([e.x1, e.y1, e.x2, e.y2], [50, 0, 170, 0]);
});

test('STU-038: semantic zoom keeps the pill at its natural size from 1x up and shrinks it only below 1x', () => {
  assert.equal(pillScale(3), 1);
  assert.equal(pillScale(1), 1);
  assert.equal(pillScale(1.6), 1);
  assert.equal(pillScale(0.5), 0.5);
  assert.equal(PILL_K, 1);
});

test('STU-038: link names are placed greedily, longest edge first, only when the edge is at least label width plus 8 px long and the label hits nothing', () => {
  const mk = (i, len, x, y, extra = {}) => ({ i, len, w: 60, x, y, force: false, ...extra });
  assert.equal(LABEL_PAD, 8);
  assert.deepEqual([...placeLabels([mk(0, 67, 0, 0), mk(1, 68, 100, 0)], [])].sort(), [1]);
  assert.deepEqual([...placeLabels([mk(0, 400, 0, 0), mk(1, 300, 20, 5), mk(2, 200, 200, 100)], [])].sort(), [0, 2]);
  assert.deepEqual([...placeLabels([mk(0, 90, 0, 0)], [{ x: 10, y: 0, w: 40, h: 26 }])], []);
  assert.deepEqual([...placeLabels([mk(0, 90, 0, 0)], [{ x: 200, y: 0, w: 40, h: 26 }])], [0]);
  assert.deepEqual([...placeLabels([mk(0, 10, 0, 0, { force: true }), mk(1, 400, 5, 0)], [{ x: 0, y: 0, w: 40, h: 26 }])].sort(), [0]);
});

test('STU-039: arrow keys pick the neighbour in that direction and the filter matches like the list', () => {
  const from = { x: 0, y: 0 };
  const others = [{ id: 'r', x: 100, y: 10 }, { id: 'l', x: -80, y: 0 }, { id: 'd', x: 5, y: 90 }];
  assert.equal(neighbourInDirection(from, others, 1, 0).id, 'r');
  assert.equal(neighbourInDirection(from, others, -1, 0).id, 'l');
  assert.equal(neighbourInDirection(from, others, 0, 1).id, 'd');
  assert.equal(neighbourInDirection(from, others, 0, -1), null);
  assert.equal(matchSet(TERMS, ''), null);
  assert.equal(matchSet(TERMS, '   '), null);
  const hits = matchSet(TERMS, 'wavelength');
  assert.ok(hits.has('wavelength') && hits.has('cycle-and-period') && !hits.has('bpm'));
  assert.ok(matchSet(TERMS, 'tone quality').has('timbre'));
  assert.ok(matchSet(TERMS, 'тембр').has('timbre'));
});

test('STU-036: #/glossary is the list, #/glossary/map the map, #/glossary/map/<id> a selected node and #/glossary/<id> a list term', () => {
  assert.equal(glossaryViewFromHash('#/glossary'), 'list');
  assert.equal(glossaryViewFromHash('#/glossary/frequency'), 'list');
  assert.equal(glossaryViewFromHash('#/glossary/map'), 'map');
  assert.equal(glossaryViewFromHash('#/glossary/map/'), 'map');
  assert.equal(glossaryViewFromHash('#/glossary/map/frequency'), 'map');
  assert.equal(glossaryViewFromHash('#/synthesize/simple'), 'list');
  assert.equal(glossaryTermFromHash('#/glossary/map'), '');
  assert.equal(glossaryTermFromHash('#/glossary/map/frequency'), '');
  assert.equal(glossaryTermFromHash('#/glossary/frequency'), 'frequency');
  assert.equal(glossaryMapTermFromHash('#/glossary/map/frequency'), 'frequency');
  assert.equal(glossaryMapTermFromHash('#/glossary/map'), '');
  assert.equal(glossaryMapTermFromHash('#/glossary/frequency'), '');
  for (const h of ['#/glossary/map', '#/glossary/map/frequency']) assert.equal(pageFromHash(h), 'glossary');
});

test('STU-037, STU-041: Analysis window is an Analysis tools term, linked from BPM and Tempo, with the relation BPM is estimated over it', () => {
  assert.equal(DOMAIN_OF['analysis-window'], 'analysis');
  assert.match(termById('analysis-window').text, /^The stretch of recent sound the detector looks at\. Short windows react fast but are noisy; long windows are stable\.$/);
  assert.ok(termById('bpm').see.includes('analysis-window'));
  assert.ok(termById('tempo').see.includes('analysis-window'));
  assert.ok(RELATIONS.some((r) => r.from === 'bpm' && r.label === 'is estimated over' && r.to === 'analysis-window'));
});
