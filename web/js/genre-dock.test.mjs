import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch, flush } from './test-dom.mjs';
import { VOCAB } from './genre-levels-fixture.mjs';

installDom({ ids: ['toast'] });
stubFetch(() => ({ body: {} }));
const { createGenreDock, loadDockCollapsed, saveDockCollapsed, DOCK_KEY, DOCK_SHEET_KEY, DOCK_EMPTY, DOCK_COLLAPSE, DOCK_EXPAND } = await import('./genre-dock.js');
const { buildTree } = await import('./genre-levels.js');
const { resetGenreTree } = await import('./genre-tree.js');

resetGenreTree(buildTree({
  ...VOCAB,
  levels: { ...VOCAB.levels, house: { ...VOCAB.levels.house, description: 'Four on the floor, born in Chicago.' } },
}));

const memory = (seed = {}) => {
  const data = { ...seed };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};
const make = (opts = {}) => createGenreDock({ storage: memory(), narrow: () => false, ...opts });
const chip = (dock, name) => dock.node.querySelectorAll('.gc-chip').find((c) => c.textContent === name);
const toggle = (dock) => dock.node.querySelector('.gmr-dock-toggle');

test('empty state until a genre is selected', () => {
  const dock = make();
  assert.equal(dock.node.querySelector('.gmr-dock-empty').textContent, DOCK_EMPTY);
  assert.equal(dock.node.querySelector('.gmr-dock-info').hidden, true);
  assert.equal(toggle(dock).title, DOCK_COLLAPSE);
});

test('a selected genre shows its info in the dock', async () => {
  const dock = make();
  await dock.show('house', 'house');
  assert.equal(dock.node.querySelector('.gmr-dock-empty').hidden, true);
  assert.equal(dock.node.querySelector('#gmr-dock-title').textContent, 'house');
  assert.equal(dock.node.querySelector('.gc-desc').textContent, 'Four on the floor, born in Chicago.');
  assert.deepEqual(dock.node.querySelectorAll('.gc-actions button').map((b) => b.textContent), ['View in Library']);
  await dock.show(null);
  assert.equal(dock.node.querySelector('.gmr-dock-empty').hidden, false);
});

test('collapsed state is saved and restored', () => {
  const storage = memory();
  const dock = createGenreDock({ storage, narrow: () => false });
  toggle(dock).onclick();
  assert.equal(storage.data[DOCK_KEY], '1');
  assert.equal(dock.isCollapsed(), true);
  assert.equal(toggle(dock).title, DOCK_EXPAND);
  assert.equal(toggle(dock).getAttribute('aria-expanded'), 'false');
  assert.equal(createGenreDock({ storage, narrow: () => false }).isCollapsed(), true);
  toggle(dock).onclick();
  assert.equal(storage.data[DOCK_KEY], '0');
});

test('phones start collapsed and keep their own saved state', () => {
  assert.equal(loadDockCollapsed(memory(), true), true);
  assert.equal(loadDockCollapsed(memory(), false), false);
  const storage = memory({ [DOCK_KEY]: '1' });
  assert.equal(loadDockCollapsed(storage, true), true);
  saveDockCollapsed(storage, true, false);
  assert.equal(storage.data[DOCK_SHEET_KEY], '0');
  assert.equal(loadDockCollapsed(storage, true), false);
  assert.equal(loadDockCollapsed(storage, false), true);
});

test('storage that throws falls back to the default', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadDockCollapsed(broken, false), false);
  assert.doesNotThrow(() => saveDockCollapsed(broken, false, true));
});

test('selecting while collapsed stays collapsed and shows the badge', async () => {
  const dock = make();
  toggle(dock).onclick();
  const dot = dock.node.querySelector('.gmr-dock-dot');
  assert.equal(dot.hidden, true);
  await dock.show('house', 'House');
  assert.equal(dock.isCollapsed(), true);
  assert.equal(dock.node.querySelector('.gmr-dock-body').hidden, true);
  assert.equal(dot.hidden, false);
  assert.equal(dock.node.querySelector('.gmr-dock-title').textContent, 'House');
  assert.match(toggle(dock).getAttribute('aria-label'), /House is selected/);
  toggle(dock).onclick();
  await flush();
  assert.equal(dock.node.querySelector('.gmr-dock-body').hidden, false);
  assert.equal(dot.hidden, true);
  assert.equal(dock.node.querySelector('#gmr-dock-title').textContent, 'house');
});

test('a chip selects that genre through the host and the back arrow returns', async () => {
  const asked = [];
  let dock;
  dock = make({ onNavigate: (name) => { asked.push(name); dock.show(name, name); } });
  await dock.show('house', 'house');
  const back = dock.node.querySelector('.gmr-dock-back');
  assert.equal(back.hidden, true);
  chip(dock, 'deep house').onclick();
  await flush();
  assert.deepEqual(asked, ['deep house']);
  assert.equal(dock.node.querySelector('#gmr-dock-title').textContent, 'deep house');
  assert.equal(back.hidden, false);
  back.onclick();
  await flush();
  assert.deepEqual(asked, ['deep house', 'house']);
  assert.equal(dock.node.querySelector('#gmr-dock-title').textContent, 'house');
  assert.equal(back.hidden, true);
});

test('a selection made on the map resets the back stack', async () => {
  let dock;
  dock = make({ onNavigate: (name) => dock.show(name, name) });
  await dock.show('house', 'house');
  chip(dock, 'deep house').onclick();
  await flush();
  await dock.show('breakbeat', 'breakbeat');
  assert.equal(dock.node.querySelector('.gmr-dock-back').hidden, true);
});

test('a chip the host cannot select leaves the stack alone', async () => {
  const dock = make({ onNavigate: () => {} });
  await dock.show('house', 'house');
  chip(dock, 'deep house').onclick();
  await flush();
  assert.equal(dock.current(), 'house');
  assert.equal(dock.node.querySelector('.gmr-dock-back').hidden, true);
});
