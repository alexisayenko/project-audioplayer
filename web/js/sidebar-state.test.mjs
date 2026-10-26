import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCollapsed, saveCollapsed, loadExpanded, saveExpanded, navNameOfHash, resolveExpanded, EXPANDED_KEY } from './sidebar-state.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('defaults to expanded', () => assert.equal(loadCollapsed(mem()), false));
test('round-trips', () => {
  const s = mem();
  assert.equal(saveCollapsed(s, true), true);
  assert.equal(loadCollapsed(s), true);
  saveCollapsed(s, false);
  assert.equal(loadCollapsed(s), false);
});
test('failing storage is tolerated', () => {
  assert.equal(loadCollapsed(broken), false);
  assert.equal(saveCollapsed(broken, true), false);
});

test('navNameOfHash maps a URL hash to the menu item', () => {
  assert.equal(navNameOfHash(''), 'library');
  assert.equal(navNameOfHash('#/library'), 'library');
  assert.equal(navNameOfHash('#/library/albums'), 'library/albums');
  assert.equal(navNameOfHash('#/library/albums/abc'), 'library/albums');
  assert.equal(navNameOfHash('#/library/drafts'), 'library/drafts');
  assert.equal(navNameOfHash('#/add'), 'library');
  assert.equal(navNameOfHash('#/playlists/xyz'), 'playlists');
  assert.equal(navNameOfHash('#/about'), 'about');
  assert.equal(navNameOfHash(undefined), 'library');
});

test('loadExpanded reads only booleans and survives bad or blocked storage', () => {
  const s = mem();
  assert.deepEqual(loadExpanded(s), {});
  s.setItem(EXPANDED_KEY, '{"library":true,"help":"yes","x":false}');
  assert.deepEqual(loadExpanded(s), { library: true, x: false });
  s.setItem(EXPANDED_KEY, 'not json');
  assert.deepEqual(loadExpanded(s), {});
  s.setItem(EXPANDED_KEY, '[true]');
  assert.deepEqual(loadExpanded(s), {});
  assert.deepEqual(loadExpanded(broken), {});
  assert.deepEqual(loadExpanded(null), {});
});

test('saveExpanded keeps the other groups', () => {
  const s = mem();
  assert.equal(saveExpanded(s, 'library', true), true);
  assert.equal(saveExpanded(s, 'help', false), true);
  assert.deepEqual(loadExpanded(s), { library: true, help: false });
  saveExpanded(s, 'library', false);
  assert.deepEqual(loadExpanded(s), { library: false, help: false });
  assert.equal(saveExpanded(broken, 'library', true), false);
});

test('resolveExpanded: the active route group is forced open, the others follow the remembered state', () => {
  assert.equal(resolveExpanded({ ownsActive: true, remembered: false, inline: true }), true);
  assert.equal(resolveExpanded({ ownsActive: true, remembered: undefined, inline: true }), true);
  assert.equal(resolveExpanded({ ownsActive: false, remembered: true, inline: true }), true);
  assert.equal(resolveExpanded({ ownsActive: false, remembered: false, inline: true }), false);
  assert.equal(resolveExpanded({ ownsActive: false, remembered: undefined, inline: true }), false);
  assert.equal(resolveExpanded({ ownsActive: true, remembered: true, inline: false }), false, 'flyout and sheet start closed');
});
