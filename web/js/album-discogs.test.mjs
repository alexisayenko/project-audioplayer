import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { discogsFinder, mergeGenres, candidateMeta } = await import('./album-discogs.js');
const { albumFields } = await import('./album-form.js');

const C = { id: 35142581, url: 'https://www.discogs.com/release/35142581-Astral-Projection-For-All-Mankind', title: 'For All Mankind', artist: 'Astral Projection', year: 2025, label: 'TIP World', trackCount: 9, cover: 'https://i.discogs.com/t.jpg', genres: ['Psytrance', 'Goa Trance'], type: 'EP' };

function setup(search) {
  let tags = ['Ambient'];
  const editor = { commit() {}, get: () => tags.map((t) => t.replace(/^genre:/, '')), addTags(add) { tags = [...new Set([...tags, ...add.map((t) => t.replace(/^genre:/, ''))])]; }, node: document.createElement('div') };
  const form = albumFields({ title: 'For All Mankind', artist: 'Astral Projection', year: '', type: 'album', genres: editor, links: {}, linksId: 'x' });
  const seen = [];
  const finder = discogsFinder({ form, editor, search: async (body) => { seen.push(body); return search; } });
  return { form, editor, finder, seen };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('mergeGenres keeps current ones, dedupes and caps at four', () => {
  assert.deepEqual(mergeGenres(['Ambient', 'Psytrance'], ['psytrance', 'Goa Trance', 'Techno', 'House']), ['Ambient', 'Psytrance', 'Goa Trance', 'Techno']);
  assert.equal(candidateMeta(C), '2025 · TIP World · 9 tracks');
});

test('Find on Discogs lists candidates and picking one fills link, year, genres and type', async () => {
  const { form, editor, finder, seen } = setup({ candidates: [C], searchError: null });
  finder.btn.click();
  await tick();
  assert.deepEqual(seen, [{ artist: 'Astral Projection', title: 'For All Mankind', year: null }]);
  assert.equal(finder.list.children.length, 1);
  assert.match(finder.list.textContent, /Astral Projection - For All Mankind/);
  finder.list.querySelector('button').click();
  assert.equal(form.links.inputs.discogs.value, C.url);
  assert.deepEqual([form.yearIn.value, form.typeSel.value, form.title(), form.artist()], ['2025', 'EP', 'For All Mankind', 'Astral Projection']);
  assert.deepEqual(editor.get(), ['Ambient', 'Psytrance', 'Goa Trance']);
  assert.equal(finder.list.children.length, 0);
});

test('an unavailable Discogs shows a clear message and no list', async () => {
  const { finder } = setup({ candidates: [], searchError: 'discogs_unavailable' });
  finder.btn.click();
  await tick();
  assert.equal(finder.list.children.length, 0);
  assert.match(finder.status.textContent, /not set up/);
  assert.equal(finder.btn.disabled, false);
});

const M = { id: 3001, kind: 'master', url: 'https://www.discogs.com/master/3001', title: 'Total Eclipse', artist: 'Delta Aquarids', year: 1995, label: null, trackCount: 11, cover: 'https://i.discogs.com/m.jpg', genres: ['Psy-Trance'], type: null, mainRelease: 7001 };
const R = { id: 9001, kind: 'release', url: 'https://www.discogs.com/release/9001', title: 'Total Eclipse', artist: 'Delta Aquarids', year: 1995, label: 'Blue Room Released', trackCount: 11, cover: null, genres: [], type: 'album' };

function setupMaster(responses, resolved) {
  let tags = [];
  const editor = { commit() {}, get: () => tags, addTags(add) { tags = add.map((t) => t.replace(/^genre:/, '')); }, node: document.createElement('div') };
  const form = albumFields({ title: 'Total Eclipse', artist: 'Delta Aquarids', year: '', type: 'album', genres: editor, links: {}, linksId: 'x' });
  const seen = [];
  const asked = [];
  const picked = [];
  const finder = discogsFinder({
    form, editor, onPick: (c) => picked.push(c),
    search: async (body) => { seen.push(body); return responses[body.all ? 'all' : 'albums']; },
    resolve: async (body) => { asked.push(body); return resolved; },
  });
  return { form, finder, seen, asked, picked };
}

test('the list has one row per master and a Show all releases link; picking a master reads its type first', async () => {
  const { form, finder, seen, asked, picked } = setupMaster({ albums: { candidates: [M], searchError: null } }, { candidate: { ...M, type: 'EP' }, searchError: null });
  assert.equal(finder.showAll.hidden, true);
  finder.btn.click();
  await tick();
  assert.deepEqual(seen, [{ artist: 'Delta Aquarids', title: 'Total Eclipse', year: null }]);
  assert.equal(finder.list.children.length, 1);
  assert.match(finder.status.textContent, /Pick the album/);
  assert.equal(finder.list.textContent.includes('1995 · 11 tracks'), true);
  assert.equal(finder.showAll.hidden, false);
  finder.list.querySelector('button').click();
  await tick();
  assert.deepEqual(asked, [{ kind: 'master', id: 3001 }]);
  assert.deepEqual([form.links.inputs.discogs.value, form.yearIn.value, form.typeSel.value], [M.url, '1995', 'EP']);
  assert.equal(picked[0].cover, M.cover);
  assert.equal(finder.list.children.length, 0);
  assert.equal(finder.showAll.hidden, true);
});

test('a failed master lookup still fills the link, year and genres', async () => {
  const { form, finder, asked } = setupMaster({ albums: { candidates: [M], searchError: null } }, { candidate: null, searchError: 'discogs_failed' });
  finder.btn.click();
  await tick();
  finder.list.querySelector('button').click();
  await tick();
  assert.equal(asked.length, 1);
  assert.deepEqual([form.links.inputs.discogs.value, form.yearIn.value], [M.url, '1995']);
});

test('Show all releases asks for every release and picking a release makes no lookup', async () => {
  const { form, finder, seen, asked } = setupMaster({ albums: { candidates: [M], searchError: null }, all: { candidates: [R, { ...R, id: 9002, year: 1996 }], searchError: null } }, null);
  finder.btn.click();
  await tick();
  finder.showAll.click();
  await tick();
  assert.deepEqual(seen[1], { artist: 'Delta Aquarids', title: 'Total Eclipse', year: null, all: true });
  assert.equal(finder.list.children.length, 2);
  assert.equal(finder.showAll.hidden, true);
  assert.match(finder.status.textContent, /Pick the release/);
  finder.list.querySelector('button').click();
  assert.deepEqual(asked, []);
  assert.equal(form.links.inputs.discogs.value, R.url);
  assert.equal(form.typeSel.value, 'album');
});
