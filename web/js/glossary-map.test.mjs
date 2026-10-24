import { test } from 'node:test';
import assert from 'node:assert/strict';

const { TERMS, termById } = await import('./glossary-terms.js');
const {
  DOMAINS, DOMAIN_OF, RELATIONS, buildGraph, neighbourMap, relationsOf, layoutGraph, boundsOf, fitView, zoomAbout, edgeEnds, neighbourInDirection, matchSet, shapeFor, mapLabel,
} = await import('./glossary-map.js');
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
  assert.equal(RELATIONS.length, 76);
  assert.equal(TERMS.length, 54);
});

test('STU-037: every term is in exactly one domain, every domain is non-empty and every term has a relation', () => {
  const ids = new Set(DOMAINS.map((d) => d.id));
  assert.equal(DOMAINS.length, 5);
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
  for (const id of ['harmony', 'octave', 'interval']) assert.equal(DOMAIN_OF[id], 'music', id);
  assert.match(termById('speed-of-sound').text, /343 m\/s in air at 20 °C/);
  assert.match(termById('loudness').text, /follows the amplitude/);
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
  assert.equal(nodes.length, 54);
  assert.equal(edges.length, 76);
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
