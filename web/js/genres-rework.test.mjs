import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { VOCAB, SONGS } = await import('./genre-levels-fixture.mjs');
const TIP_VOCAB = {
  ...VOCAB,
  levels: {
    ...VOCAB.levels,
    'full tip': { parents: ['Electronic', 'Rock'], discogs: false, synonyms: ['tipsy', 'tip tip'], provisional: false, status: 'question' },
  },
};
let mode = 'ok';
const calls = stubFetch((u) => {
  if (mode === 'fail') return { status: 500, body: { error: 'x' } };
  if (u.includes('vocabulary')) {
    if (mode === 'vocab-fail') return { status: 500, body: { error: 'x' } };
    if (mode === 'hostile') return { body: { levels: { x: null }, families: ['F'] } };
    if (mode === 'old') return { body: { families: ['Electronic'], genres: [] } };
    if (mode === 'tips') return { body: TIP_VOCAB };
    return { body: VOCAB };
  }
  if (mode === 'lib-fail') return { status: 500, body: { error: 'x' } };
  if (mode === 'tips') return { body: { songs: [{ id: 't1', tags: ['genre:afro house'] }, { id: 't2', tags: ['genre:full tip', 'genre:house'] }, { id: 't3', tags: ['genre:house'] }] } };
  if (mode === 'breakbeat') return { body: { songs: [...SONGS, { id: 's7', tags: ['genre:breakbeat'] }] } };
  if (mode === 'rock-heavy') return { body: { songs: [...SONGS, ...[1, 2, 3, 4].map((i) => ({ id: `r${i}`, tags: ['genre:rock and roll'] }))] } };
  if (mode === 'no-genres') return { body: { songs: [{ id: 'x', tags: ['mood:calm'] }, { id: 'y', tags: ['genre:unknown thing'] }] } };
  return { body: { songs: SONGS } };
});
const { renderGenresRework } = await import('./genres-rework.js');
const { ICONS } = await import('./icons.js');
const { prefs } = await import('./library-data.js');
const { player } = await import('./player.js');
let current = null;
Object.defineProperty(player, 'current', { get: () => current, configurable: true });

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresRework(root);
  await flush();
  return { root, cleanup };
}
const rowsOf = (root) => root.querySelectorAll('[role="treeitem"]');
const names = (root) => rowsOf(root).map((r) => r.querySelector('.gmr-name').textContent);
const row = (root, name) => rowsOf(root).find((r) => r.querySelector('.gmr-name').textContent === name);
const btn = (root, text) => root.querySelectorAll('button').find((b) => b.textContent === text);
const panelOf = (root) => root.querySelector('.gmr-details');
const openInfo = (root, text) => {
  const input = root.querySelector('input');
  input.value = text;
  fire(input, 'input');
  fire(input, 'keydown', { key: 'Enter' });
  input.value = '';
  fire(input, 'input');
};

test('page loads vocabulary and library, shows the map canvas, legend and the tree with Electronic open', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  assert.equal(root.querySelector('h1').textContent, 'Genres map');
  assert.ok(calls.some((c) => c.url.includes('/genres/vocabulary')) && calls.some((c) => c.url.endsWith('/library')));
  const canvas = root.querySelector('canvas');
  assert.equal(canvas.getAttribute('role'), 'img');
  assert.ok(canvas.getAttribute('aria-label').includes('Electronic'));
  assert.ok(root.querySelector('#gmr-legend').textContent.includes('Dashed ring: not in Discogs'));
  assert.ok(!root.querySelector('#gmr-legend').textContent.includes('approved'));
  assert.equal(root.querySelector('[role="tree"]').getAttribute('aria-label'), 'Genre hierarchy');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'house', 'Rock']);
  assert.equal(row(root, 'Electronic').getAttribute('aria-expanded'), 'true');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  assert.equal(row(root, 'drum and bass').getAttribute('aria-expanded'), 'false');
  assert.equal(row(root, 'house').getAttribute('aria-level'), '2');
  assert.equal(root.querySelector('[role="status"]').textContent, '5 genres in Electronic');
  assert.equal(row(root, 'Electronic').querySelector('.gmr-count').textContent, '4');
  assert.equal(row(root, 'Rock').querySelector('.gmr-count').textContent, '1');
  assert.equal(row(root, 'drum and bass').querySelector('.gmr-count').textContent, '1');
  cleanup();
});

test('zoom controls exist and the outline toggle reports its state', async () => {
  mode = 'ok';
  const { root } = await mount();
  for (const l of ['Zoom in', 'Zoom out', 'Reset view']) assert.ok(root.querySelectorAll('button').some((b) => b.getAttribute('aria-label') === l), l);
  const toggle = btn(root, 'Outline');
  const close = root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close outline');
  for (const b of [toggle, close]) assert.equal(b.getAttribute('aria-controls'), 'gmr-panel');
  assert.equal(root.querySelector('#gmr-panel'), root.querySelector('.gmr-side'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.hidden, false);
  assert.equal(root.querySelector('#gmr-panel').hidden, true);
  toggle.click();
  assert.equal(root.querySelector('#gmr-panel').hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(close.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.hidden, true);
  close.click();
  assert.equal(root.querySelector('#gmr-panel').hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(close.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.hidden, false);
});

test('the outline lists only genres with library songs and the ancestors that nest them', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  btn(root, 'Expand all').click();
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'jungle', 'house', 'afro house', 'deep house', 'Rock', 'rock and roll']);
  assert.equal(row(root, 'breakbeat'), undefined);
  assert.equal(btn(root, 'Only with songs'), undefined);
  assert.equal(btn(root, 'Show whole vocabulary'), undefined);
  assert.equal(row(root, 'drum and bass').querySelector('.gmr-count').textContent, '1');
  assert.equal(row(root, 'jungle').querySelector('.gmr-also'), null, 'a jump to a genre without songs is not offered');
  cleanup();
});

test('expand all and collapse all', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  assert.equal(rowsOf(root).length, 8);
  const afro = row(root, 'afro house');
  assert.equal(afro.getAttribute('aria-level'), '3');
  assert.ok(afro.textContent.includes('not in Discogs'));
  assert.equal(afro.querySelector('.nodisc').getAttribute('aria-label'), 'Not in Discogs');
  assert.ok(row(root, 'rock and roll').textContent.includes('provisional'));
  assert.equal(row(root, 'deep house').querySelector('.nodisc'), null);
  assert.equal(names(root).includes('breakbeat'), false);
  btn(root, 'Collapse all').click();
  assert.deepEqual(names(root), ['Electronic', 'Rock']);
});

test('search finds a synonym, expands to it and clears with Escape', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Collapse all').click();
  const input = root.querySelector('input');
  input.value = 'dnb';
  fire(input, 'input');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass']);
  assert.ok(row(root, 'drum and bass').textContent.includes('also called dnb'));
  input.value = 'qqq';
  fire(input, 'input');
  assert.equal(rowsOf(root).length, 0);
  assert.ok(root.textContent.includes('No genre or synonym matches'));
  fire(input, 'keydown', { key: 'Escape' });
  assert.deepEqual(names(root), ['Electronic', 'Rock']);
});

test('outline search only finds genres that have library songs', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const input = root.querySelector('input');
  input.value = 'breakbeat';
  fire(input, 'input');
  assert.equal(rowsOf(root).length, 0);
  assert.ok(root.textContent.includes('No genre or synonym matches "breakbeat"'));
  input.value = 'jungle';
  fire(input, 'input');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'jungle']);
  input.value = 'house';
  fire(input, 'input');
  assert.deepEqual(names(root), ['Electronic', 'house', 'afro house', 'deep house']);
  cleanup();
});

test('Enter in the search selects the first match and opens its details', async () => {
  mode = 'ok';
  const { root } = await mount();
  const input = root.querySelector('input');
  input.value = 'dnb';
  fire(input, 'input');
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(panelOf(root).querySelector('h3').textContent, 'drum and bass');
  assert.equal(row(root, 'drum and bass').getAttribute('aria-selected'), 'true');
});

test('clicking a row opens the detail panel with chain, synonyms, flags and counts', async () => {
  mode = 'ok';
  const { root } = await mount();
  row(root, 'house').click();
  assert.equal(row(root, 'house').getAttribute('aria-selected'), 'true', 'an outline click selects the genre on the map');
  assert.equal(panelOf(root).hidden, true, 'but it does not open the infobox');
  assert.equal(row(root, 'afro house').getAttribute('aria-level'), '3');
  openInfo(root, 'house');
  assert.equal(panelOf(root).hidden, false);
  assert.equal(panelOf(root).querySelector('h3').textContent, 'house');
  assert.ok(panelOf(root).textContent.includes('Genre, level 2 (sub-genre)'));
  assert.ok(panelOf(root).textContent.includes('2 in your library (1 tagged exactly)'));
  openInfo(root, 'afro house');
  assert.ok(panelOf(root).textContent.includes('No, a name added to this library'));
  assert.deepEqual(panelOf(root).querySelectorAll('.gm-chip').map((c) => c.textContent), ['Electronic', 'house']);
  panelOf(root).querySelectorAll('.gm-chip').find((c) => c.textContent === 'Electronic').click();
  assert.ok(panelOf(root).textContent.includes('edm, dance music'));
  row(root, 'house').click();
  assert.equal(panelOf(root).hidden, true, 'selecting in the outline while the infobox is open closes it');
  openInfo(root, 'house');
  root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close details').click();
  assert.equal(root.querySelector('.gmr-details').hidden, true);
});

test('also under chip jumps to the other parent when it has songs; library button applies the genre filter', async () => {
  mode = 'breakbeat';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  const chip = row(root, 'jungle').querySelector('.gmr-also');
  assert.equal(chip.textContent, 'also under breakbeat');
  assert.equal(chip.getAttribute('aria-label'), 'Also under breakbeat: jump to breakbeat');
  chip.click();
  assert.equal(row(root, 'breakbeat').getAttribute('aria-selected'), 'true');
  assert.equal(panelOf(root).hidden, true, 'the also-under jump is an outline action: no infobox');
  openInfo(root, 'house');
  btn(root, 'Show 2 songs in Library').click();
  assert.equal(location.hash, '#/library');
  assert.ok(prefs.sel instanceof Set);
  openInfo(root, 'breakbeat');
  assert.equal(panelOf(root).querySelector('h3').textContent, 'breakbeat');
  assert.ok(btn(root, 'Show 1 song in Library'));
  mode = 'ok';
});

test('keyboard: arrows move, right expands, left collapses, Enter and Space toggle', async () => {
  mode = 'ok';
  const { root } = await mount();
  const tree = root.querySelector('[role="tree"]');
  const press = (key) => fire(tree, 'keydown', { key });
  const active = () => rowsOf(root).find((r) => r.getAttribute('tabindex') === '0').querySelector('.gmr-name').textContent;
  assert.equal(active(), 'Electronic');
  press('ArrowDown');
  assert.equal(active(), 'drum and bass');
  press('ArrowDown');
  assert.equal(active(), 'house');
  press('ArrowRight');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'true');
  press('ArrowRight');
  assert.equal(active(), 'afro house');
  press('ArrowLeft');
  assert.equal(active(), 'house');
  press('ArrowLeft');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  press('Enter');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'true');
  assert.equal(row(root, 'house').getAttribute('aria-selected'), 'true');
  press(' ');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  press('End');
  assert.equal(active(), 'Rock');
  press('Home');
  assert.equal(active(), 'Electronic');
});

test('failures: old server without levels, vocabulary down, library down', async () => {
  mode = 'old';
  let r = await mount();
  assert.ok(r.root.querySelector('[role="status"]').textContent.startsWith('Genre levels unavailable'));
  assert.equal(rowsOf(r.root).length, 0);
  mode = 'vocab-fail';
  r = await mount();
  assert.equal(r.root.querySelector('[role="status"]').textContent, 'Vocabulary unavailable');
  mode = 'lib-fail';
  r = await mount();
  assert.ok(r.root.querySelector('[role="status"]').textContent.startsWith('Library unavailable'));
  assert.equal(rowsOf(r.root).length, 0);
  assert.equal(r.root.querySelector('.gmr-family-row').hidden, true);
  mode = 'fail';
  r = await mount();
  assert.equal(r.root.querySelector('[role="status"]').textContent, 'Vocabulary unavailable');
});

test('status badges show in the list and details and the status filter narrows the list', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  assert.equal(row(root, 'afro house').querySelector('.ok'), null);
  assert.ok(!row(root, 'afro house').textContent.includes('approved'));
  assert.equal(row(root, 'deep house').querySelector('.q').getAttribute('aria-label'), 'Under question');
  assert.ok(row(root, 'afro house').querySelector('.nodisc'));
  openInfo(root, 'deep house');
  assert.ok(root.querySelector('.gmr-details').textContent.includes('Under question'));
  openInfo(root, 'afro house');
  assert.ok(!root.querySelector('.gmr-details').textContent.includes('Alex approved'));
  assert.equal(root.querySelectorAll('[data-status]').map((b) => b.getAttribute('data-status')).join(), 'all,question,unreviewed');
  btn(root, 'question').click();
  assert.equal(btn(root, 'question').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(root), ['Electronic', 'house', 'deep house']);
  btn(root, 'unreviewed').click();
  assert.ok(!names(root).includes('deep house') && !names(root).includes('afro house') && names(root).includes('jungle'));
  btn(root, 'all').click();
  assert.equal(names(root).includes('deep house'), true);
});

test('flavour chips have counts in their label and filter the list; clear resets', async () => {
  mode = 'ok';
  const { root } = await mount();
  const chip = (k) => root.querySelectorAll('[data-flavour]').find((b) => b.getAttribute('data-flavour') === k);
  assert.equal(chip('club').getAttribute('aria-label'), 'Club, 2 songs');
  assert.ok(chip('dark').getAttribute('title').includes('Menacing'));
  chip('dark').click();
  assert.equal(chip('dark').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'jungle', 'house', 'afro house']);
  btn(root, 'question').click();
  assert.deepEqual(names(root), []);
  btn(root, 'all').click();
  assert.ok(row(root, 'house'));
  btn(root, 'Clear flavours').click();
  assert.equal(chip('dark').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'house', 'Rock']);
});

test('there is no whole-vocabulary mode: no toggle, nothing stored', async () => {
  mode = 'ok';
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { root, cleanup } = await mount();
  assert.equal(btn(root, 'Show whole vocabulary'), undefined);
  assert.equal(root.textContent.includes('whole vocabulary'), false);
  assert.equal(store.has('electrophone.genresReworkAll'), false);
  cleanup();
  delete globalThis.localStorage;
});

test('Reload is a real button and the nav icon exists', async () => {
  mode = 'ok';
  const { root } = await mount();
  const b = btn(root, 'Reload');
  assert.ok(b && b.getAttribute('type') === 'button' && !b.disabled);
  assert.ok(ICONS.genresMapRework);
});

test('a vocabulary payload that breaks the tree builder shows Failed to load and re-enables Reload', async () => {
  mode = 'hostile';
  const { root, cleanup } = await mount();
  assert.equal(root.querySelector('[role="status"]').textContent, 'Failed to load');
  assert.equal(btn(root, 'Reload').disabled, false);
  cleanup();
});

test('Genres map shows one page title inside the standard page head and no small bar title', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const h1s = root.querySelectorAll('h1');
  assert.equal(h1s.length, 1);
  assert.equal(h1s[0].textContent, 'Genres map');
  assert.ok(h1s[0].className.includes('t-display'));
  const head = h1s[0].parentElement;
  assert.equal(head.tagName.toLowerCase(), 'header');
  assert.ok(head.className.includes('page-head'));
  assert.equal(head.querySelector('.t-eyebrow').textContent, 'ELECTROPHONE');
  assert.equal(root.querySelector('.gm-title'), null);
  assert.equal(root.querySelector('.gm').children[0], head);
  assert.equal(root.querySelector('.gm .gmr-side').closest('.gm-work').parentElement, root.querySelector('.gm'));
  assert.equal(root.querySelector('.gm-bar'), null);
  cleanup();
});

test('the header block and the outline are one panel that collapses and expands as a whole', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const side = root.querySelector('.gmr-side');
  const bar = side.querySelector('.gmr-bar');
  assert.equal(root.querySelectorAll('.gmr-side').length, 1);
  assert.equal(side.children[0].querySelector('h2').textContent, 'Outline');
  assert.equal(bar, side.children[1]);
  assert.equal(side.children[2], root.querySelector('#gmr-outline'));
  assert.ok(bar.querySelector('[role="status"]').textContent.includes('genres in Electronic'));
  for (const l of ['Show legend', 'Now playing', 'Reload']) assert.ok(bar.contains(btn(root, l)), l);
  assert.ok(bar.contains(root.querySelector('.gmr-family-row')));
  assert.equal(root.querySelectorAll('.gmr-bar').length, 1);
  const toggle = btn(root, 'Outline');
  assert.ok(!side.contains(toggle));
  toggle.click();
  assert.equal(toggle.hidden, true);
  const close = root.querySelectorAll('button').find((x) => x.getAttribute('aria-label') === 'Close outline');
  assert.ok(side.children[0].contains(close));
  assert.ok(!bar.contains(close));
  close.click();
  assert.equal(side.hidden, true);
  assert.equal(root.querySelector('#gmr-outline').hidden, true);
  assert.equal(toggle.hidden, false);
  assert.ok(!root.querySelector('.gm').classList.contains('outline-open'));
  toggle.click();
  assert.equal(side.hidden, false);
  assert.equal(root.querySelector('#gmr-outline').hidden, false);
  assert.equal(toggle.hidden, true);
  btn(root, 'Show legend').click();
  assert.equal(root.querySelector('#gmr-legend').hidden, false);
  cleanup();
});

test('the details live inside the one outline panel: heading structure, close button, no floating panel', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const outline = root.querySelector('#gmr-outline');
  assert.equal(root.querySelectorAll('section').length, 1);
  assert.equal(root.querySelector('.gmr-panel'), null);
  assert.ok(outline.contains(panelOf(root)));
  assert.equal(panelOf(root).hidden, true);
  assert.equal(root.querySelector('.gmr-side h2').textContent, 'Outline');
  openInfo(root, 'house');
  assert.equal(panelOf(root).hidden, false);
  assert.equal(panelOf(root).getAttribute('aria-label'), 'Genre details');
  assert.equal(panelOf(root).querySelector('h3').textContent, 'house');
  assert.ok(outline.classList.contains('has-details'));
  assert.ok(outline.contains(root.querySelector('[role="tree"]')));
  assert.ok(btn(root, 'Show 2 songs in Library'));
  panelOf(root).querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close details').click();
  assert.equal(panelOf(root).hidden, true);
  assert.equal(outline.classList.contains('has-details'), false);
  assert.equal(outline.hidden, false);
  cleanup();
});

test('the legend is hidden by default, has a visible title and a toggle that remembers the choice', async () => {
  mode = 'ok';
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { root, cleanup } = await mount();
  const legend = root.querySelector('#gmr-legend');
  const toggle = btn(root, 'Show legend');
  assert.equal(legend.hidden, true);
  assert.equal(toggle.getAttribute('aria-controls'), 'gmr-legend');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(legend.querySelector('h2').textContent, 'Legend');
  assert.equal(legend.getAttribute('aria-labelledby'), legend.querySelector('h2').id);
  assert.equal(legend.textContent.includes('Dashed line'), false);
  toggle.click();
  assert.equal(legend.hidden, false);
  assert.equal(toggle.textContent, 'Hide legend');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(store.get('electrophone.genresLegend'), '1');
  cleanup();
  const again = await mount();
  assert.equal(again.root.querySelector('#gmr-legend').hidden, false);
  assert.ok(btn(again.root, 'Hide legend'));
  btn(again.root, 'Hide legend').click();
  assert.equal(store.get('electrophone.genresLegend'), '0');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const blocked = await mount();
  assert.equal(blocked.root.querySelector('#gmr-legend').hidden, true);
  btn(blocked.root, 'Show legend').click();
  assert.equal(blocked.root.querySelector('#gmr-legend').hidden, false);
  delete globalThis.localStorage;
});

test('no user-visible text uses the word style for genres', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  btn(root, 'Show legend').click();
  btn(root, 'Expand all').click();
  openInfo(root, 'deep house');
  const text = root.textContent + root.querySelectorAll('[aria-label],[title]').map((n) => `${n.getAttribute('aria-label')} ${n.getAttribute('title')}`).join(' ');
  assert.equal(/\bstyles?\b/i.test(text), false);
  assert.ok(panelOf(root).textContent.includes('Genre, level 3 (sub-sub-genre)'));
  cleanup();
});

test('Now playing is hidden without a current song, follows player changes and unsubscribes on cleanup', async () => {
  mode = 'ok';
  const subs = new Set();
  const original = player.onChange;
  player.onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  current = null;
  const { root, cleanup } = await mount();
  const now = btn(root, 'Now playing');
  assert.equal(now.hidden, true);
  current = { id: 's1', tags: ['genre:deep house'] };
  for (const fn of subs) fn();
  assert.equal(now.hidden, false);
  current = null;
  for (const fn of subs) fn();
  assert.equal(now.hidden, true);
  cleanup();
  assert.equal(subs.size, 0);
  player.onChange = original;
});

test('Now playing selects the deepest matching genre without opening the details and flashes its row', async () => {
  mode = 'ok';
  current = { id: 's4', tags: ['genre:afro house', 'genre:house', 'genre:electronic', 'mood:calm'] };
  const { root, cleanup } = await mount();
  btn(root, 'Collapse all').click();
  btn(root, 'Now playing').click();
  assert.equal(row(root, 'afro house').getAttribute('aria-selected'), 'true');
  assert.ok(row(root, 'afro house').classList.contains('flash'));
  assert.equal(panelOf(root).hidden, true);
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'true');
  cleanup();
  current = null;
});

test('Now playing breaks a level tie by song count', async () => {
  mode = 'ok';
  current = { id: 's9', tags: ['genre:jungle', 'genre:deep house'] };
  const { root, cleanup } = await mount();
  btn(root, 'Now playing').click();
  assert.equal(row(root, 'deep house').getAttribute('aria-selected'), 'true', 'deep house has 2 songs against 1 for jungle');
  cleanup();
  current = null;
});

test('Now playing says so when the playing song has no genre inside the root', async () => {
  mode = 'ok';
  current = { id: 's5', tags: ['genre:rock and roll'] };
  const { root, cleanup } = await mount();
  btn(root, 'Now playing').click();
  assert.equal(document.getElementById('toast').textContent, 'The playing song has no Electronic genre');
  assert.equal(rowsOf(root).some((r) => r.getAttribute('aria-selected') === 'true'), false);
  current = { id: 's6', tags: ['decade:90s'] };
  btn(root, 'Now playing').click();
  assert.equal(document.getElementById('toast').textContent, 'The playing song has no Electronic genre');
  cleanup();
  current = null;
});

test('family chips list only families with library songs, most songs first, the first one pressed', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const chips = root.querySelectorAll('.gmr-family-row button');
  assert.deepEqual(chips.map((c) => c.textContent), ['Electronic', 'Rock']);
  assert.deepEqual(chips.map((c) => c.querySelector('.gm-dot').className), ['gm-dot f0', 'gm-dot f1']);
  assert.deepEqual(chips.map((c) => c.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(root.querySelector('.gmr-family-row').getAttribute('aria-label'), 'Genre family');
  cleanup();
});

test('the default family is the one with the most library songs', async () => {
  mode = 'rock-heavy';
  const { root, cleanup } = await mount();
  const chips = root.querySelectorAll('.gmr-family-row button');
  assert.deepEqual(chips.map((c) => c.textContent), ['Rock', 'Electronic']);
  assert.deepEqual(chips.map((c) => c.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(root.querySelector('[role="status"]').textContent, '1 genre in Rock');
  assert.ok(root.querySelector('canvas').getAttribute('aria-label').includes('Rock'));
  assert.equal(row(root, 'Rock').getAttribute('aria-expanded'), 'true');
  cleanup();
  mode = 'ok';
});

test('without genre-tagged songs there are no family chips and a calm empty state', async () => {
  mode = 'no-genres';
  const { root, cleanup } = await mount();
  assert.equal(root.querySelectorAll('.gmr-family-row button').length, 0);
  assert.equal(root.querySelector('.gmr-family-row').hidden, true);
  assert.equal(root.querySelector('[role="status"]').textContent, 'No genres yet. Add songs with genres to see them here.');
  assert.equal(rowsOf(root).length, 0);
  assert.equal(root.querySelector('.gmr-empty').hidden, false);
  assert.equal(root.querySelector('.gmr-empty').textContent, 'No genres yet. Add songs with genres to see them here.');
  assert.equal(root.querySelector('canvas').getAttribute('aria-label').startsWith('Map of genres.'), true);
  cleanup();
  mode = 'ok';
});

test('a family chip switches the map root, the status chip, the canvas label and Now playing', async () => {
  mode = 'ok';
  current = { id: 's5', tags: ['genre:rock and roll'] };
  const { root, cleanup } = await mount();
  const chip = (name) => root.querySelectorAll('.gmr-family-row button').find((c) => c.textContent === name);
  chip('Rock').click();
  assert.equal(chip('Rock').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('Electronic').getAttribute('aria-pressed'), 'false');
  assert.ok(root.querySelector('canvas').getAttribute('aria-label').includes('Rock'));
  assert.equal(root.querySelector('[role="status"]').textContent, '1 genre in Rock');
  assert.equal(row(root, 'Rock').getAttribute('aria-expanded'), 'true');
  btn(root, 'Now playing').click();
  assert.equal(row(root, 'rock and roll').getAttribute('aria-selected'), 'true');
  chip('Electronic').click();
  assert.equal(root.querySelector('[role="status"]').textContent, '5 genres in Electronic');
  btn(root, 'Now playing').click();
  assert.equal(document.getElementById('toast').textContent, 'The playing song has no Electronic genre');
  cleanup();
  current = null;
});

test('selecting an outline row of another map family switches the map to it', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  row(root, 'Rock').click();
  assert.equal(root.querySelectorAll('.gmr-family-row button').find((c) => c.textContent === 'Rock').getAttribute('aria-pressed'), 'true');
  assert.equal(root.querySelector('[role="status"]').textContent, '1 genre in Rock');
  cleanup();
});

const canvasProto = Object.getPrototypeOf(document.createElement('canvas'));
for (const [k, v] of [['clientWidth', 800], ['clientHeight', 600]]) Object.defineProperty(canvasProto, k, { get: () => v, configurable: true });
const drawn = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 30 }) : () => {}), set: () => true });
canvasProto.getContext = () => drawn;
const frames = [];
globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '#123456', fontFamily: 'sans-serif' });
const runFrames = () => { for (let i = 0; i < 20 && frames.length; i += 1) frames.splice(0).forEach((fn) => fn()); };

function hover(root, label) {
  runFrames();
  const canvas = root.querySelector('canvas');
  const tip = root.querySelector('.gmr-tip');
  for (let y = 0; y <= 600; y += 3) {
    for (let x = 0; x <= 800; x += 3) {
      fire(canvas, 'pointermove', { clientX: x, clientY: y, buttons: 0, pointerId: 1 });
      if (!tip.hidden && tip.querySelector('strong')?.textContent === label) return tip;
    }
  }
  return null;
}

test('the hover tooltip never prints the text null and has exactly the parts that apply', async () => {
  mode = 'tips';
  const { root, cleanup } = await mount();
  const plain = hover(root, 'afro house');
  assert.ok(plain, 'afro house can be hovered');
  assert.equal(plain.textContent, 'afro house 1 song | not in Discogs');
  assert.ok(!plain.textContent.includes('null'));
  const full = hover(root, 'full tip');
  assert.ok(full, 'full tip can be hovered');
  assert.equal(full.textContent, 'full tip 1 song | also: tipsy, tip tip | not in Discogs | also in Rock | Under question');
  assert.ok(!full.textContent.includes('null'));
  const house = hover(root, 'house');
  assert.ok(house, 'house can be hovered');
  assert.equal(house.textContent, 'house 3 songs');
  cleanup();
  mode = 'ok';
});
