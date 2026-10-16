import test from 'node:test';
import assert from 'node:assert/strict';
import { indexGraph, outlineRows, pathKeys, hasStyles } from './genre-data.js';

const n = (id, label, family, style, parents = [], count = 0, ownCount = count, tags = [label]) => ({ id, label, qid: null, family, style, count, ownCount, parents, tags });
const nodes = [
  n('electronic', 'electronic music', 'Electronic', null, [], 12, 0, []),
  n('trance', 'trance', 'Electronic', 'trance', ['electronic'], 6, 2),
  n('prog-trance', 'progressive trance', 'Electronic', 'progressive trance', ['trance'], 3, 3),
  n('mid', 'trance subgenre', 'Electronic', 'trance', ['trance'], 1, 0, []),
  n('festival', 'festival trance', 'Electronic', 'trance', ['mid'], 1, 1),
  n('house', 'house', 'Electronic', 'house', ['electronic'], 4, 1),
  n('synthpop', 'synth-pop', 'Pop', 'synth-pop', [], 3, 2),
  n('both', 'electro swing pop', 'Electronic', 'house', ['house', 'synthpop'], 1, 1),
  n('empty', 'ambient house', 'Electronic', 'ambient house', [], 0, 0),
  n('rock', 'rock music', 'Rock', null, [], 5, 4, ['rock']),
  n('asia', 'music of Asia', 'Other', null, [], 1, 0, []),
  n('kpop', 'k-pop band', 'Other', null, ['asia'], 1, 1),
];
const g = indexGraph({ nodes, edges: [], ontology: true });
const all = (rows) => new Set(rows.filter((r) => r.hasChildren).map((r) => r.key));
const open = (rows0 = outlineRows(g, new Set())) => {
  let ex = new Set();
  for (let i = 0; i < 6; i += 1) ex = new Set([...ex, ...all(outlineRows(g, ex)), ...rows0.map((r) => r.key)]);
  return ex;
};
const shape = (rows) => rows.map((r) => `${'  '.repeat(r.depth)}${r.label}`);

test('hasStyles tells a hybrid graph from an old one', () => {
  assert.equal(hasStyles(g), true);
  assert.equal(hasStyles(indexGraph({ nodes: [n('a', 'a', 'Other', null)] })), false);
});

test('family order is stable and families with nothing to show are left out', () => {
  const rows = outlineRows(g, new Set());
  assert.deepEqual(rows.map((r) => r.label), ['Electronic', 'Pop', 'Rock', 'Other']);
  assert.deepEqual(rows.map((r) => r.size), [3, 1, 1, 1]);
  assert.equal(rows[0].unit, 'style');
  assert.equal(rows[2].unit, 'root');
});

test('family > style > subgenre, the umbrella chain skipped, styles flat at level two', () => {
  const rows = outlineRows(g, open());
  assert.deepEqual(shape(rows).slice(0, 8), [
    'Electronic', '  trance', '    festival trance', '  house', '    electro swing pop', '  progressive trance', 'Pop', '  synth-pop',
  ]);
  assert.ok(!rows.some((r) => r.label === 'electronic music' || r.label === 'trance subgenre'));
  assert.equal(rows.find((r) => r.id === 'trance').kind, 'style');
  assert.equal(rows.find((r) => r.id === 'festival').depth, 2);
});

test('a style row counts its own songs and everything below it, once', () => {
  const rows = outlineRows(g, new Set());
  assert.equal(outlineRows(g, new Set(['f:Electronic'])).find((r) => r.id === 'trance').count, 6);
  assert.deepEqual(rows.find((r) => r.kind === 'family' && r.label === 'Electronic').count, null);
});

test('a style with no songs and nothing below it is hidden', () => {
  assert.ok(!outlineRows(g, open()).some((r) => r.id === 'empty'));
});

test('a node with two styles appears under each, in each family, with also-under notes', () => {
  const rows = outlineRows(g, open()).filter((r) => r.id === 'both');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.key), ['f:Electronic>house>both', 'f:Pop>synthpop>both']);
  assert.deepEqual(rows.map((r) => r.alsoUnder), [['synth-pop'], ['house']]);
});

test('a node without a style falls back to the skip logic in its own family', () => {
  const rows = outlineRows(g, open());
  const rock = rows.find((r) => r.id === 'rock');
  assert.deepEqual([rock.depth, rock.family, rock.count], [1, 'Rock', 5]);
  assert.ok(!rows.some((r) => r.id === 'asia'), 'classification umbrella is skipped');
  const k = rows.find((r) => r.id === 'kpop');
  assert.deepEqual([k.depth, k.key], [1, 'f:Other>kpop']);
});

test('an umbrella with no songs of its own and nothing shown below it is not a row', () => {
  assert.ok(!outlineRows(g, open()).some((r) => r.id === 'electronic'));
});

test('collapsed style rows hide their subgenres; expanded state is by key', () => {
  const rows = outlineRows(g, new Set(['f:Electronic']));
  assert.deepEqual(shape(rows).slice(0, 4), ['Electronic', '  trance', '  house', '  progressive trance']);
  assert.equal(rows[1].hasChildren, true);
  assert.equal(rows[1].expanded, false);
});

test('pathKeys: style, subgenre under its style, hidden umbrella, fallback node', () => {
  assert.deepEqual(pathKeys(g, 'trance'), ['f:Electronic', 'f:Electronic>trance']);
  assert.deepEqual(pathKeys(g, 'festival'), ['f:Electronic', 'f:Electronic>trance', 'f:Electronic>trance>festival']);
  assert.deepEqual(pathKeys(g, 'mid'), ['f:Electronic', 'f:Electronic>trance']);
  assert.deepEqual(pathKeys(g, 'rock'), ['f:Rock', 'f:Rock>rock']);
  assert.deepEqual(pathKeys(g, 'electronic'), []);
  assert.deepEqual(pathKeys(g, 'nope'), []);
});

test('every path key of a visible row is a row key', () => {
  const rows = outlineRows(g, open());
  const keys = new Set(rows.map((r) => r.key));
  for (const r of rows.filter((x) => x.id)) for (const k of pathKeys(g, r.id)) assert.ok(keys.has(k), `${r.id}: ${k}`);
});

test('a cycle in the parent edges does not hang the outline', () => {
  const c = indexGraph({ nodes: [n('s', 's', 'Rock', 's', [], 2, 1), n('a', 'a', 'Rock', 's', ['s', 'b'], 1, 1), n('b', 'b', 'Rock', 's', ['a'], 1, 1)] });
  const rows = outlineRows(c, new Set(['f:Rock', 'f:Rock>s', 'f:Rock>s>a', 'f:Rock>s>b']));
  assert.ok(rows.length < 20);
});
