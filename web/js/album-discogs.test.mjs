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
