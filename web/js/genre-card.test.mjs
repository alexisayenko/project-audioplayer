import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch, flush } from './test-dom.mjs';
import { VOCAB } from './genre-levels-fixture.mjs';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
stubFetch(() => ({ body: {} }));
const { openGenreCard, NOT_FOUND, NO_DESCRIPTION, cardSections } = await import('./genre-card.js');
const { buildTree, resolveNode } = await import('./genre-levels.js');
const { resetGenreTree } = await import('./genre-tree.js');
const { takeGenreFocus, showGenreOnMap } = await import('./genre-focus.js');

const vocab = {
  ...VOCAB,
  levels: {
    ...VOCAB.levels,
    house: { ...VOCAB.levels.house, description: 'Four on the floor, born in Chicago.', related: ['breakbeat'], source_links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/House_music', kind: 'page' }] },
    jungle: { ...VOCAB.levels.jungle, fusion: true },
  },
};
const tree = buildTree(vocab);
resetGenreTree(tree);

const open = (name, opener = null) => openGenreCard(name, opener);
const chip = (dlg, name) => dlg.querySelectorAll('.gc-chip').find((c) => c.textContent === name);
const title = (dlg) => dlg.querySelector('#genre-card-title').textContent;

test('a known genre shows header, description, links, where it sits and actions', () => {
  const dlg = open('house');
  assert.equal(dlg.open, true);
  assert.equal(title(dlg), 'house');
  assert.equal(dlg.querySelector('.gc-level').textContent, 'Level 2');
  assert.equal(dlg.querySelector('.gc-desc').textContent, 'Four on the floor, born in Chicago.');
  assert.equal(dlg.querySelectorAll('.gc-links a').length, 1);
  const groups = dlg.querySelectorAll('.gc-chips').map((g) => g.getAttribute('aria-label'));
  assert.deepEqual(groups, ['Parents', 'Subgenres', 'Related']);
  assert.ok(chip(dlg, 'deep house') && chip(dlg, 'afro house') && chip(dlg, 'breakbeat'));
  assert.deepEqual(dlg.querySelectorAll('.gc-actions button').map((b) => b.textContent), ['View in Library', 'Show on map']);
  dlg.close();
});

test('a synonym resolves to the canonical genre and shows the muted synonyms line', () => {
  const dlg = open('dnb');
  assert.equal(title(dlg), 'drum and bass');
  assert.match(dlg.querySelector('.gc-synonyms').textContent, /dnb/);
  assert.equal(dlg.querySelector('.gc-desc').textContent, NO_DESCRIPTION);
  dlg.close();
});

test('the fusion marker shows only for a fusion genre', () => {
  const j = open('jungle');
  assert.equal(j.querySelector('.gc-fusion').textContent, 'Fusion');
  j.close();
  const h = open('house');
  assert.equal(h.querySelector('.gc-fusion'), null);
  h.close();
});

test('a chip swaps the card to that genre and the back arrow pops the stack', () => {
  const dlg = open('house');
  const back = () => dlg.querySelector('.card-back');
  assert.equal(back().hidden, true);
  chip(dlg, 'deep house').click();
  assert.equal(title(dlg), 'deep house');
  assert.equal(back().hidden, false);
  chip(dlg, 'house').click();
  assert.equal(title(dlg), 'house');
  back().click();
  assert.equal(title(dlg), 'deep house');
  back().click();
  assert.equal(title(dlg), 'house');
  assert.equal(back().hidden, true);
  dlg.close();
});

test('an unknown genre shows Genre not found', () => {
  const dlg = open('no such genre');
  assert.equal(title(dlg), NOT_FOUND);
  dlg.close();
});

test('Escape closes the card, removes it and returns focus to the opener', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  const dlg = open('house', opener);
  dlg.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
  assert.equal(dlg.open, false);
  assert.equal(dlg.isConnected, false);
  assert.equal(document.activeElement, opener);
});

test('Show on map stores the genre for the map and closes the card', async () => {
  const loc = { hash: '#/library' };
  globalThis.location = loc;
  const dlg = open('house');
  dlg.querySelectorAll('.gc-actions button')[1].click();
  await flush();
  assert.equal(dlg.open, false);
  assert.equal(loc.hash, '#/genres');
  assert.equal(takeGenreFocus(), 'house');
  assert.equal(takeGenreFocus(), null);
});

test('showGenreOnMap on the map route notifies instead of navigating', () => {
  const loc = { hash: '#/genres' };
  showGenreOnMap('jungle', loc);
  assert.equal(loc.hash, '#/genres');
  assert.equal(takeGenreFocus(), 'jungle');
});

test('cardSections splits parents, groups, subgenres and related', () => {
  const s = cardSections(resolveNode('jungle', tree), tree);
  assert.deepEqual(s.parents.map((p) => p.name).sort(), ['breakbeat', 'drum and bass']);
  assert.deepEqual(s.children, []);
  assert.deepEqual(s.groups, []);
});

test('showGenreOnMap on the old #/genres2 route notifies instead of navigating', () => {
  const loc = { hash: '#/genres2' };
  showGenreOnMap('jungle', loc);
  assert.equal(loc.hash, '#/genres2');
  assert.equal(takeGenreFocus(), 'jungle');
});

test('showGenreOnMap from another screen goes to the Genres screen', () => {
  const loc = { hash: '#/library' };
  showGenreOnMap('jungle', loc);
  assert.equal(loc.hash, '#/genres');
  assert.equal(takeGenreFocus(), 'jungle');
});
