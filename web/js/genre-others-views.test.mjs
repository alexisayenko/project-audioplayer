import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { layoutRadial } from './genre-radial.js';
import { OTHERS_VOCAB, OTHERS_SONGS } from './genre-others-fixture.mjs';

let frames = [];
let dashes = [];
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456', fontFamily: 'sans-serif' });
globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
globalThis.cancelAnimationFrame = () => { frames = []; };

function makeCanvas() {
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'setLineDash' ? (a) => { if (a?.length) dashes.push(a); } : k === 'measureText' ? () => ({ width: 30 }) : k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return {
    clientWidth: 800, clientHeight: 600, width: 0, height: 0, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener() {},
  };
}

const settle = () => { for (let i = 0; i < 400 && frames.length; i++) frames.splice(0).forEach((fn) => fn(i * 16)); };
const treeWith = (songs) => { const t = buildTree(OTHERS_VOCAB); applyCounts(t, songs); return t; };
const noEmpty = OTHERS_SONGS.filter((s) => !s.tags.every((t) => t === 'genre:electronic'));

test('Radial: the Others group circle gets a dashed outline, a plain family does not', async () => {
  const { createRadialView } = await import('./genre-radial-view.js');
  const draw = (rootName) => {
    dashes = [];
    frames = [];
    const tree = treeWith(noEmpty);
    const view = createRadialView(makeCanvas(), { onSelect() {}, onHover() {} });
    view.setLayout(layoutRadial(tree, rootName, { hidden: false }), tree);
    settle();
    view.destroy();
    return dashes.length;
  };
  assert.ok(draw('Others') > 0, 'dashed ring around the group');
  assert.equal(draw('Rock'), 0);
});

test('Graph: the Others group circle gets a dashed outline and the graph draws without errors', async () => {
  const { createForceView } = await import('./genre-force-view.js');
  dashes = [];
  frames = [];
  const tree = treeWith(noEmpty);
  const graph = buildMapGraph(tree);
  graph.nodes = graph.nodes.filter((n) => n.id !== 's:edm');
  graph.links = graph.links.filter((l) => l.target !== 's:edm' && l.source !== 's:edm');
  graph.byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const view = createForceView(makeCanvas(), { onSelect() {}, onHover() {}, reducedMotion: true });
  view.setGraph(graph);
  view.resize();
  settle();
  const group = dashes.length;
  view.destroy();
  assert.ok(group > 0, 'dashed ring around the group');
  const plain = buildMapGraph(treeWith(noEmpty));
  plain.nodes = plain.nodes.filter((n) => n.id !== 'g:Others' && n.id !== 's:edm');
  plain.links = plain.links.filter((l) => ![l.source, l.target].some((id) => id === 'g:Others' || id === 's:edm'));
  dashes = [];
  frames = [];
  const v2 = createForceView(makeCanvas(), { onSelect() {}, onHover() {}, reducedMotion: true });
  v2.setGraph({ ...plain, byId: new Map(plain.nodes.map((n) => [n.id, n])) });
  v2.resize();
  settle();
  v2.destroy();
  assert.equal(dashes.length, 0, 'no group, no dashed ring');
});
