import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch, flush } from './test-dom.mjs';

installDom();
const VOCAB = { genres: ['ambient', 'dub', 'rock', 'pop', 'hi-nrg', 'soul'].map((name) => ({ name, family: 'Electronic', level: 'genre', parents: ['Electronic'], extra: false })), aliases: {} };
stubFetch((url) => ({ body: url === '/genres/vocabulary' ? VOCAB : {} }));
const { suggestedGenres, suggestedBox, badgeFor } = await import('./suggested-genres.js');
const { planMetadata } = await import('./metadata-apply.js');
const { songForm } = await import('./song-form.js');
const { loadVocabulary } = await import('./genre-vocab.js');
await loadVocabulary();

const SUG = [
  { genre: 'soul', sources: ['wikipedia_artist'], reason: 'single_source' },
  { genre: 'freestyle', sources: ['wikipedia_song', 'wikipedia_artist'], reason: 'ambiguous_name' },
  { genre: 'downtempo', sources: ['musicbrainz'], reason: 'single_source' },
];

test('suggestedGenres reads genre_suggestions, drops chosen and repeated genres, ignores junk', () => {
  const resp = { genre_suggestions: [...SUG, { genre: 'Soul', sources: [], reason: '' }, { genre: '' }, null, { genre: 'pop', sources: ['x', 3] }] };
  const out = suggestedGenres(resp, ['genre:downtempo']);
  assert.deepEqual(out.map((s) => s.genre), ['soul', 'freestyle', 'pop']);
  assert.deepEqual(out[2].sources, ['x']);
  assert.deepEqual(suggestedGenres({}, []), []);
  assert.deepEqual(suggestedGenres({ genre_suggestions: 'x' }, []), []);
});

test('an older response with only original_genres still gives original suggestions', () => {
  const out = suggestedGenres({ original_genres: ['genre:art pop', 'genre:Art Pop', 'genre:synthpop', 'country:gb', 'x', 'genre:'] }, ['genre:synthpop']);
  assert.deepEqual(out, [{ genre: 'art pop', sources: ['original'], reason: 'original' }]);
});

test('with genre_suggestions present original_genres is not read twice', () => {
  const out = suggestedGenres({ genre_suggestions: [{ genre: 'techno', sources: ['original', 'musicbrainz'], reason: 'original' }], original_genres: ['genre:techno', 'genre:hardcore'] }, []);
  assert.deepEqual(out.map((s) => s.genre), ['techno']);
});

test('badges name the source; the two Wikipedia pages share one badge', () => {
  assert.equal(badgeFor('musicbrainz').text, 'MusicBrainz');
  assert.equal(badgeFor('wikipedia_song').text, 'Wikipedia');
  assert.equal(badgeFor('wikipedia_artist').text, 'Wikipedia');
  assert.equal(badgeFor('youtube').text, 'YouTube');
  assert.equal(badgeFor('original').text, 'original');
  const box = suggestedBox({ onPick() {} });
  box.set(suggestedGenres({ genre_suggestions: [SUG[1]] }));
  const badges = box.node.querySelectorAll('.sg-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, 'Wikipedia');
  assert.match(badges[0].getAttribute('title'), /song page, Wikipedia artist page/);
});

test('suggested box: hidden when empty, a click picks one genre and removes its chip', () => {
  const picked = [];
  const box = suggestedBox({ onPick: (t) => picked.push(t) });
  assert.equal(box.node.hidden, true);
  box.set(suggestedGenres({ genre_suggestions: SUG }));
  assert.equal(box.node.hidden, false);
  assert.match(box.node.textContent, /Suggested genres/);
  const adds = box.node.querySelectorAll('.sg-add');
  assert.deepEqual(adds.map((b) => b.textContent), ['soul', 'freestyle', 'downtempo']);
  assert.match(adds[1].getAttribute('title'), /Ambiguous name/);
  adds[0].click();
  assert.deepEqual(picked, ['genre:soul']);
  assert.deepEqual(box.node.querySelectorAll('.sg-add').map((b) => b.textContent), ['freestyle', 'downtempo']);
  box.clear();
  assert.equal(box.node.hidden, true);
});

test('dismiss hides a genre for the session, also after a new set; forget brings it back', () => {
  const picked = [];
  const box = suggestedBox({ onPick: (t) => picked.push(t) });
  box.set(suggestedGenres({ genre_suggestions: SUG }));
  box.node.querySelectorAll('.sg-dismiss')[1].click();
  assert.deepEqual(box.node.querySelectorAll('.sg-add').map((b) => b.textContent), ['soul', 'downtempo']);
  assert.deepEqual(picked, []);
  box.set(suggestedGenres({ genre_suggestions: SUG }));
  assert.deepEqual(box.node.querySelectorAll('.sg-add').map((b) => b.textContent), ['soul', 'downtempo']);
  box.forget();
  box.set(suggestedGenres({ genre_suggestions: SUG }));
  assert.equal(box.node.querySelectorAll('.sg-add').length, 3);
});

test('dismiss and add are real buttons (keyboard reachable) with a label', () => {
  const box = suggestedBox({ onPick() {} });
  box.set(suggestedGenres({ genre_suggestions: [SUG[0]] }));
  const [add, dismiss] = box.node.querySelectorAll('button');
  assert.equal(add.getAttribute('type'), 'button');
  assert.equal(dismiss.getAttribute('type'), 'button');
  assert.equal(dismiss.getAttribute('aria-label'), 'Dismiss soul');
});

test('refresh hides a genre the user chose another way', () => {
  let have = [];
  const box = suggestedBox({ have: () => have, onPick() {} });
  box.set(suggestedGenres({ genre_suggestions: SUG }));
  have = ['genre:Soul'];
  box.refresh();
  assert.deepEqual(box.node.querySelectorAll('.sg-add').map((b) => b.textContent), ['freestyle', 'downtempo']);
});

test('planMetadata adds only the applied tags, never a suggestion or an original genre', () => {
  const resp = { tags: ['genre:pop'], genre_suggestions: SUG, original_genres: ['genre:techno'] };
  const p = planMetadata(resp, { album: '', released: '', tags: [] });
  assert.deepEqual(p.tags, ['genre:pop']);
  const none = planMetadata({ tags: [], genre_suggestions: SUG }, { album: '', released: '', tags: [] });
  assert.deepEqual(none.tags, []);
});

const btn = (f, text) => f.node.querySelectorAll('button').find((b) => b.textContent === text);
const song = { id: 'sg', title: 'Tell It to My Heart', mainArtists: ['Taylor Dayne'], featuredArtists: [], albums: [], tags: [], file: 'x' };
const adds = (f) => f.node.querySelectorAll('.sg-add').map((b) => b.textContent);

test('Get metadata applies only the applied genres and shows the others in the suggested row', async () => {
  stubFetch(() => ({ body: { tags: ['genre:pop', 'genre:hi-nrg'], genre_suggestions: [{ genre: 'soul', sources: ['wikipedia_artist'], reason: 'single_source' }, { genre: 'pop', sources: ['musicbrainz'], reason: 'x' }] } }));
  const f = songForm({ mode: 'edit', song });
  btn(f, 'Get metadata').click();
  await flush();
  assert.deepEqual(f.values().tags.sort(), ['genre:hi-nrg', 'genre:pop']);
  assert.deepEqual(adds(f), ['soul'], 'an applied genre is not suggested again');
  assert.match(f.node.textContent, /1 suggested genre(?!s)/);
  assert.ok(!f.values().tags.includes('genre:soul'));
});

test('clicking a suggestion adds a genre chip; Get metadata again does not re-add it or a dismissed one', async () => {
  const body = { tags: [], genre_suggestions: [{ genre: 'soul', sources: ['wikipedia_artist'], reason: 'single_source' }, { genre: 'rock', sources: ['discogs'], reason: 'single_source' }] };
  stubFetch(() => ({ body }));
  const f = songForm({ mode: 'edit', song });
  btn(f, 'Get metadata').click();
  await flush();
  assert.deepEqual(adds(f), ['soul', 'rock']);
  f.node.querySelectorAll('.sg-add')[0].click();
  assert.ok(f.values({ commit: false }).tags.includes('genre:soul'));
  assert.deepEqual(adds(f), ['rock']);
  f.node.querySelectorAll('.sg-dismiss')[0].click();
  assert.deepEqual(adds(f), []);
  btn(f, 'Get metadata').click();
  await flush();
  assert.deepEqual(adds(f), [], 'soul is chosen, rock was dismissed');
  assert.deepEqual(f.values({ commit: false }).tags, ['genre:soul']);
});

test('a version shows the original suggestions with an original badge and applies nothing', async () => {
  stubFetch(() => ({ body: { tags: [], original_genres: ['genre:rock'], genre_suggestions: [{ genre: 'rock', sources: ['original', 'musicbrainz'], reason: 'original' }] } }));
  const f = songForm({ mode: 'edit', song });
  btn(f, 'Get metadata').click();
  await flush();
  assert.deepEqual(f.values().tags, []);
  assert.deepEqual(f.node.querySelectorAll('.sg-badge').map((b) => b.textContent), ['original', 'MusicBrainz']);
});

test('the Add form shows the preview suggestions at once', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', tags: ['genre:pop'], genre_suggestions: SUG } });
  assert.deepEqual(adds(f), ['soul', 'freestyle', 'downtempo']);
  f.reset();
  assert.deepEqual(adds(f), []);
});
