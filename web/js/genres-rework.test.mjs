import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
globalThis.localStorage.setItem('electrophone.genresDrill', '0');
const { VOCAB, SONGS } = await import('./genre-levels-fixture.mjs');
let mode = 'ok';
const calls = stubFetch((u) => {
  if (mode === 'fail') return { status: 500, body: { error: 'x' } };
  if (u.includes('vocabulary')) {
    if (mode === 'vocab-fail') return { status: 500, body: { error: 'x' } };
    if (mode === 'hostile') return { body: { levels: { x: null }, families: ['F'] } };
    if (mode === 'old') return { body: { families: ['Electronic'], genres: [] } };
    return { body: VOCAB };
  }
  if (mode === 'lib-fail') return { status: 500, body: { error: 'x' } };
  if (mode === 'breakbeat') return { body: { songs: [...SONGS, { id: 's7', tags: ['genre:breakbeat'] }] } };
  if (mode === 'rock-heavy') return { body: { songs: [...SONGS, ...[1, 2, 3, 4].map((i) => ({ id: `r${i}`, tags: ['genre:rock and roll'] }))] } };
  if (mode === 'no-genres') return { body: { songs: [{ id: 'x', tags: ['mood:calm'] }, { id: 'y', tags: ['genre:unknown thing'] }] } };
  return { body: { songs: SONGS } };
});
const { renderGenresRework } = await import('./genres-rework.js');
const { ICONS } = await import('./icons.js');
const { player } = await import('./player.js');
let current = null;
Object.defineProperty(player, 'current', { get: () => current, configurable: true });

async function mount(opts = { view: 'radial' }) {
  try { globalThis.localStorage.setItem('electrophone.genresDrill', '0'); } catch { /* storage is intentionally blocked in one test */ }
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresRework(root, opts);
  await flush();
  return { root, cleanup };
}
const rowsOf = (root) => root.querySelectorAll('[role="treeitem"]');
const names = (root) => rowsOf(root).map((r) => r.querySelector('.gmr-name').textContent);
const row = (root, name) => rowsOf(root).find((r) => r.querySelector('.gmr-name').textContent === name);
const btn = (root, text) => root.querySelectorAll('button').find((b) => b.textContent === text);
const outlineBtn = (root, text) => root.querySelectorAll('.gmr-tools button').find((b) => b.textContent === text);
const noInfobox = (root) => root.querySelector('.gmr-details') === null && root.querySelector('#gmr-info') === null;
const pick = (root, text) => {
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
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'drum and bass', 'house', 'Rock']);
  assert.equal(row(root, 'Electronic').getAttribute('aria-expanded'), 'true');
  assert.equal(row(root, 'house').getAttribute('aria-expanded'), 'false');
  assert.equal(row(root, 'drum and bass').getAttribute('aria-expanded'), 'false');
  assert.equal(row(root, 'house').getAttribute('aria-level'), '2');
  assert.equal(root.querySelector('[role="status"]').textContent, '5 genres in Electronic', 'the Electronic circle, which has songs of its own, is counted');
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
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle', 'house', 'afro house', 'deep house', 'Rock', 'rock and roll']);
  assert.equal(rowsOf(root).filter((r) => r.querySelector('.gmr-name').textContent === 'jungle').length, 2, 'a genre with two parents is listed under each');
  assert.equal(btn(root, 'Only with songs'), undefined);
  assert.equal(btn(root, 'Show whole vocabulary'), undefined);
  assert.equal(row(root, 'drum and bass').querySelector('.gmr-count').textContent, '1');
  const jungles = rowsOf(root).filter((r) => r.querySelector('.gmr-name').textContent === 'jungle');
  assert.equal(jungles[0].querySelector('.gmr-also').textContent, 'parent drum and bass', 'under breakbeat it offers a jump to its other parent');
  assert.equal(jungles[1].querySelector('.gmr-also').textContent, 'parent breakbeat');
  cleanup();
});

test('expand all and collapse all', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  assert.equal(rowsOf(root).length, 10);
  const afro = row(root, 'afro house');
  assert.equal(afro.getAttribute('aria-level'), '3');
  assert.ok(afro.textContent.includes('not in Discogs'));
  assert.equal(afro.querySelector('.nodisc').getAttribute('aria-label'), 'Not in Discogs');
  assert.ok(row(root, 'rock and roll').textContent.includes('provisional'));
  assert.equal(row(root, 'deep house').querySelector('.nodisc'), null);
  assert.equal(names(root).includes('breakbeat'), true);
  outlineBtn(root, 'Collapse all').click();
  assert.deepEqual(names(root), ['Electronic', 'Rock']);
});

test('search finds a synonym, expands to it and clears with Escape', async () => {
  mode = 'ok';
  const { root } = await mount();
  outlineBtn(root, 'Collapse all').click();
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
  input.value = 'zzz';
  fire(input, 'input');
  assert.equal(rowsOf(root).length, 0);
  assert.ok(root.textContent.includes('No genre or synonym matches "zzz"'));
  input.value = 'jungle';
  fire(input, 'input');
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle']);
  input.value = 'house';
  fire(input, 'input');
  assert.deepEqual(names(root), ['Electronic', 'house', 'afro house', 'deep house']);
  cleanup();
});

test('Enter in the search selects the first match and shows no infobox', async () => {
  mode = 'ok';
  const { root } = await mount();
  const input = root.querySelector('input');
  input.value = 'dnb';
  fire(input, 'input');
  fire(input, 'keydown', { key: 'Enter' });
  assert.ok(noInfobox(root));
  assert.equal(row(root, 'drum and bass').getAttribute('aria-selected'), 'true');
});

test('clicking a row selects the genre and there is no infobox', async () => {
  mode = 'ok';
  const { root } = await mount();
  row(root, 'house').click();
  assert.equal(row(root, 'house').getAttribute('aria-selected'), 'true', 'an outline click selects the genre on the map');
  assert.ok(noInfobox(root));
  assert.equal(row(root, 'afro house').getAttribute('aria-level'), '3');
});

test('also under chip jumps to the other parent when it has songs', async () => {
  mode = 'breakbeat';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  const chip = row(root, 'jungle').querySelector('.gmr-also');
  assert.equal(chip.textContent, 'parent drum and bass');
  assert.equal(chip.getAttribute('aria-label'), 'Parent drum and bass: jump to drum and bass');
  chip.click();
  assert.equal(row(root, 'drum and bass').getAttribute('aria-selected'), 'true');
  assert.ok(noInfobox(root));
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
  assert.equal(active(), 'breakbeat');
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

test('status badges show in the list and the status filter narrows the list', async () => {
  mode = 'ok';
  const { root } = await mount();
  btn(root, 'Expand all').click();
  assert.equal(row(root, 'afro house').querySelector('.ok'), null);
  assert.ok(!row(root, 'afro house').textContent.includes('approved'));
  assert.equal(row(root, 'deep house').querySelector('.q').getAttribute('aria-label'), 'Under question');
  assert.ok(row(root, 'afro house').querySelector('.nodisc'));
  assert.equal(root.querySelectorAll('[data-status]').map((b) => b.getAttribute('data-status')).join(), 'all,question,unreviewed');
  btn(root, 'question').click();
  assert.equal(btn(root, 'question').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(root), ['Electronic', 'house', 'deep house']);
  btn(root, 'unreviewed').click();
  assert.ok(!names(root).includes('deep house') && !names(root).includes('afro house') && names(root).includes('jungle'));
  btn(root, 'all').click();
  assert.equal(names(root).includes('deep house'), true);
});

test('modifier chips have counts in their label and filter the list; clear resets', async () => {
  mode = 'ok';
  const { root } = await mount();
  const chip = (k) => root.querySelectorAll('[data-modifier]').find((b) => b.getAttribute('data-modifier') === k);
  assert.equal(chip('club').getAttribute('aria-label'), 'Club, 2 songs');
  assert.ok(chip('dark').getAttribute('title').includes('Menacing'));
  assert.deepEqual(root.querySelectorAll('.gmr-mod-group').map((g) => g.getAttribute('aria-label')), ['Mood modifiers', 'Scene modifiers']);
  chip('dark').click();
  assert.equal(chip('dark').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle', 'house', 'afro house']);
  btn(root, 'question').click();
  assert.deepEqual(names(root), []);
  btn(root, 'all').click();
  assert.ok(row(root, 'house'));
  btn(root, 'Clear modifiers').click();
  assert.equal(chip('dark').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(names(root), ['Electronic', 'breakbeat', 'drum and bass', 'house', 'Rock']);
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

test('there is no infobox: the outline is the only side panel and Escape does not need one', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const outline = root.querySelector('#gmr-outline');
  assert.equal(root.querySelectorAll('section').length, 1);
  assert.equal(root.querySelector('.gmr-panel'), null);
  assert.equal(root.querySelector('.gmr-side h2').textContent, 'Outline');
  assert.ok(outline.contains(root.querySelector('[role="tree"]')));
  pick(root, 'house');
  assert.ok(noInfobox(root));
  assert.equal(row(root, 'house').getAttribute('aria-selected'), 'true');
  fire(root.querySelector('.gm'), 'keydown', { key: 'Escape' });
  assert.ok(noInfobox(root));
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
  pick(root, 'deep house');
  const text = root.textContent + root.querySelectorAll('[aria-label],[title]').map((n) => `${n.getAttribute('aria-label')} ${n.getAttribute('title')}`).join(' ');
  assert.equal(/\bstyles?\b/i.test(text), false);
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

test('Now playing selects the deepest matching genre without an infobox and flashes its row', async () => {
  mode = 'ok';
  current = { id: 's4', tags: ['genre:afro house', 'genre:house', 'genre:electronic', 'mood:calm'] };
  const { root, cleanup } = await mount();
  outlineBtn(root, 'Collapse all').click();
  btn(root, 'Now playing').click();
  assert.equal(row(root, 'afro house').getAttribute('aria-selected'), 'true');
  assert.ok(row(root, 'afro house').classList.contains('flash'));
  assert.ok(noInfobox(root));
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

