import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { OTHERS_VOCAB, OTHERS_SONGS, promote } = await import('./genre-others-fixture.mjs');
let vocab = OTHERS_VOCAB;
stubFetch((u) => (u.includes('vocabulary') ? { body: vocab } : { body: { songs: OTHERS_SONGS } }));
const { renderGenresRework } = await import('./genres-rework.js');
const { player } = await import('./player.js');
Object.defineProperty(player, 'current', { get: () => null, configurable: true });

async function mount(opts = { view: 'radial' }) {
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresRework(root, opts);
  await flush();
  return { root, cleanup };
}
const rowsOf = (root) => root.querySelectorAll('[role="treeitem"]');
const row = (root, name) => rowsOf(root).find((r) => r.querySelector('.gmr-name').textContent === name);

test('Others is a grey, non-counted group row with a badge, its family chip is grey and the radial opens on it', async () => {
  vocab = OTHERS_VOCAB;
  const { root, cleanup } = await mount();
  const chips = root.querySelectorAll('.gmr-family-row button');
  assert.deepEqual(chips.map((c) => c.textContent), ['Others', 'Rock']);
  assert.equal(chips[0].querySelector('.gm-dot').className, 'gm-dot f15');
  assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
  const others = row(root, 'Others');
  assert.ok(others.querySelector('.gmr-badge.group'), 'a group badge');
  assert.equal(others.querySelector('.gmr-count'), null, 'no song count on a group');
  assert.equal(others.querySelector('.gmr-lib-btn'), null, 'no library button for a group');
  assert.ok(row(root, 'house').querySelector('.gmr-count'));
  assert.equal(root.querySelector('[role="status"]').textContent, '3 genres in Others');
  cleanup();
});

test('selecting the Others row shows the group note with the reason; another row hides it', async () => {
  vocab = OTHERS_VOCAB;
  const { root, cleanup } = await mount();
  const note = root.querySelector('.gmr-group-note');
  assert.equal(note.hidden, true);
  row(root, 'Others').click();
  assert.equal(note.hidden, false);
  assert.ok(note.textContent.startsWith('Others - a temporary group: organisational, never assigned to songs.'));
  assert.ok(note.textContent.length > 70, 'a reason follows');
  row(root, 'Rock').click();
  assert.equal(note.hidden, true);
  cleanup();
});

test('the graph view loads with Others, and the legend explains the dashed group circle', async () => {
  vocab = OTHERS_VOCAB;
  const { root, cleanup } = await mount({ view: 'graph' });
  assert.ok(root.textContent.includes('a temporary group (organisational, never assigned to a song)'));
  cleanup();
});

test('a promoted genre is a family chip and an outline row with its display label and the inherited colour', async () => {
  vocab = promote(OTHERS_VOCAB, 'house', { display: 'House' });
  const { root, cleanup } = await mount();
  const chips = root.querySelectorAll('.gmr-family-row button');
  assert.ok(chips.some((c) => c.textContent === 'House' && c.querySelector('.gm-dot').className === 'gm-dot f0'));
  assert.ok(row(root, 'House'));
  assert.ok(row(root, 'House').querySelector('.gmr-count'));
  cleanup();
  vocab = OTHERS_VOCAB;
});

test('the song card model: a song with house and trance has an Others line, and a stored electronic pill is kept as typed on its own line', async () => {
  const { buildTree } = await import('./genre-levels.js');
  const { resetGenreTree } = await import('./genre-tree.js');
  const { cardModel } = await import('./song-card.js');
  const v = { ...OTHERS_VOCAB, levels: { ...OTHERS_VOCAB.levels, trance: { parents: ['Others'], discogs: true, synonyms: [], provisional: false } } };
  resetGenreTree(buildTree(v));
  const m = cardModel({ id: 'x', title: 'T', tags: ['genre:house', 'genre:trance', 'genre:electronic'] });
  assert.deepEqual(m.genreLines, [{ family: 'Others', genres: ['Others', 'house', 'trance'] }, { family: null, genres: ['electronic'] }]);
  resetGenreTree(null);
});
