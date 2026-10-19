import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch, flush } from './test-dom.mjs';

installDom();
const VOCAB = { genres: ['ambient', 'dub', 'rock'].map((name) => ({ name, family: 'Electronic', level: 'genre', parents: ['Electronic'], extra: false })), aliases: {} };
stubFetch((url) => ({ body: url === '/genres/vocabulary' ? VOCAB : {} }));
const { songForm } = await import('./song-form.js');
const { loadVocabulary } = await import('./genre-vocab.js');
const { ApiError } = await import('./api.js');
await loadVocabulary();

const inputs = (f) => f.node.querySelectorAll('input');
const pillsOf = (f, label) => f.node.querySelector(`[aria-label="${label}"]`).querySelectorAll('.token-text').map((n) => n.textContent);
const btn = (f, text) => f.node.querySelectorAll('button').find((b) => b.textContent === text);

test('add mode cleans the pasted title and offers Restore', () => {
  const f = songForm({ mode: 'add', song: { title_raw: 'Artist - Song (Official Video) [HD]', tags: [] } });
  assert.equal(f.values().title, 'Artist - Song');
  assert.match(f.node.textContent, /Cleaned: removed \(Official Video\) \[HD\]/);
  btn(f, 'Restore').click();
  const v = f.values();
  assert.equal(v.title, 'Artist - Song (Official Video) [HD]');
  assert.equal(v.keep_title, true, 'the server is told not to clean it again');
});

test('edit mode keeps the title untouched and shows BPM with a Re-detect button', () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'Song (Live)', mainArtists: ['Band'], featuredArtists: [], bpm: 127.6, tags: ['rock'], releaseYear: 1999, albums: ['LP'], file: 'x.mp3' } });
  const v = f.values();
  assert.equal(v.title, 'Song (Live)');
  assert.deepEqual(v.mainArtists, ['Band']);
  assert.deepEqual(v.albums, ['LP']);
  assert.equal(String(v.releaseYear), '1999');
  assert.deepEqual(v.tags, ['rock'], 'the year adds no decade tag');
  assert.match(f.node.textContent, /128 BPM/);
  assert.ok(btn(f, 'Re-detect'));
});

test('add mode says BPM is detected after saving', () => {
  const f = songForm({ mode: 'add', song: {} });
  assert.match(f.node.textContent, /BPM is detected after saving/);
  assert.equal(btn(f, 'Re-detect'), undefined);
});

test('Re-detect calls the API, shows the new BPM and refreshes the store', async () => {
  const calls = stubFetch((url) => (url.endsWith('/bpm/detect') ? { body: { bpm: 90 } } : { body: { songs: [] } }));
  const f = songForm({ mode: 'edit', song: { id: 's2', title: 'T', tags: [], bpm: null, file: 'x' } });
  assert.match(f.node.textContent, /Not detected yet/);
  btn(f, 'Re-detect').click();
  await flush();
  assert.ok(calls.some((c) => c.url === '/songs/s2/bpm/detect'));
  assert.match(f.node.textContent, /90 BPM/);
  assert.ok(calls.some((c) => c.url === '/library'));
});

test('Re-detect failure surfaces the message and re-enables the button', async () => {
  stubFetch(() => ({ status: 422, body: { detail: 'No audio' } }));
  const f = songForm({ mode: 'edit', song: { id: 's3', title: 'T', tags: [], file: 'x' } });
  btn(f, 'Re-detect').click();
  await flush();
  assert.match(f.node.textContent, /No audio/);
  assert.equal(btn(f, 'Re-detect').disabled, false);
});

test('Get metadata fills only empty fields, never overwrites, and paints service icons', async () => {
  const calls = stubFetch(() => ({ body: { album: 'Found LP', year: 2001, tags: ['genre:rock', 'country:gb'], services: { musicbrainz: { found: true, url: 'https://mb/1' } }, suggest: { artist: 'Real Artist' } } }));
  const f = songForm({ mode: 'edit', song: { id: 's4', title: 'Song', mainArtists: ['Typed'], featuredArtists: [], albums: ['Mine'], tags: [], file: 'x' }, source: { url: 'https://y/1' } });
  btn(f, 'Get metadata').click();
  assert.equal(btn(f, 'Getting metadata...') !== undefined || f.node.textContent.includes('Getting metadata'), true);
  await flush();
  const body = JSON.parse(calls.find((c) => c.url === '/metadata').opts.body);
  assert.equal(body.title, 'Song');
  assert.deepEqual(body.sources, [{ url: 'https://y/1' }]);
  const v = f.values();
  assert.deepEqual(v.albums, ['Mine'], 'existing album kept');
  assert.equal(String(v.releaseYear), '2001');
  assert.equal(body.artist, 'Typed');
  assert.ok(!('version_kind' in body));
  assert.ok(v.tags.includes('genre:rock') && v.tags.includes('country:gb'));
  assert.equal(v.musicbrainz_url, 'https://mb/1');
  assert.ok(f.node.querySelector('a.svc-musicbrainz'));
  assert.match(f.node.textContent, /Wikipedia says: Real Artist/);
  btn(f, 'Get metadata').disabled === false;
  f.node.querySelector('.wiki-hint').click();
  assert.deepEqual(f.values().mainArtists, ['Real Artist']);
});

const DC = 'https://www.discogs.com/master/101179';
const dcInput = (f) => inputs(f).find((i) => i.getAttribute('aria-label') === 'Discogs link');
const metaSong = { id: 'sd', title: 'Mrs. Moon', mainArtists: ['Kermesse'], featuredArtists: [], albums: [], tags: [], file: 'x' };

test('Get metadata applies the Discogs result: link, year, genres, and keeps typed values', async () => {
  stubFetch(() => ({ body: { year: 1983, tags: ['genre:italo disco'], services: { discogs: { found: true, url: DC } } } }));
  const f = songForm({ mode: 'edit', song: metaSong });
  btn(f, 'Get metadata').click();
  await flush();
  const v = f.values();
  assert.equal(v.discogs_url, DC);
  assert.equal(String(v.releaseYear), '1983');
  assert.ok(v.tags.includes('genre:italo disco'));
  assert.ok(f.node.querySelector('a.svc-discogs'));
  assert.equal(dcInput(f).value, DC);
});

test('Get metadata keeps a typed Discogs link and a typed year', async () => {
  stubFetch(() => ({ body: { year: 1983, services: { discogs: { found: true, url: DC } } } }));
  const f = songForm({ mode: 'edit', song: { ...metaSong, releaseYear: 1990, discogs_url: 'https://www.discogs.com/release/5' } });
  btn(f, 'Get metadata').click();
  await flush();
  assert.equal(f.values().discogs_url, 'https://www.discogs.com/release/5');
  assert.equal(String(f.values().releaseYear), '1990');
});

test('Get metadata says why Discogs was skipped', async () => {
  for (const [reason, text] of [['not_configured', /Discogs: not configured on the server/], ['no_match', /Discogs: no match/], ['error', /Discogs: lookup failed/]]) {
    stubFetch(() => ({ body: { services: { discogs: { found: false, url: null, skipped: reason } } } }));
    const f = songForm({ mode: 'edit', song: metaSong });
    btn(f, 'Get metadata').click();
    await flush();
    assert.match(f.node.textContent, text);
    assert.equal(f.values().discogs_url, null);
  }
});

test('a pasted Discogs link is sent with Get metadata and the result is labelled from link', async () => {
  const calls = stubFetch(() => ({ body: { year: 1983, services: { discogs: { found: true, url: DC, from_link: true } } } }));
  const f = songForm({ mode: 'edit', song: metaSong });
  const typed = 'https://www.discogs.com/master/101179-Kermesse-Mrs-Moon';
  dcInput(f).value = typed;
  dcInput(f).dispatchEvent(makeEvent('input'));
  btn(f, 'Get metadata').click();
  await flush();
  assert.equal(JSON.parse(calls.find((c) => c.url === '/metadata').opts.body).discogs_url, typed);
  assert.match(f.node.textContent, /Discogs: from link/);
  assert.equal(f.values().discogs_url, typed);
});

test('a pasted Discogs link in the Add form is sent too', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  const f = songForm({ mode: 'add', song: { title: 'Mrs. Moon', mainArtists: ['Kermesse'], tags: [] }, source: { url: 'https://y/1' } });
  dcInput(f).value = DC;
  dcInput(f).dispatchEvent(makeEvent('input'));
  btn(f, 'Get metadata').click();
  await flush();
  assert.equal(JSON.parse(calls.find((c) => c.url === '/metadata').opts.body).discogs_url, DC);
});

test('Get metadata failure shows a message and keeps the form usable', async () => {
  stubFetch(() => ({ status: 500, body: {} }));
  const f = songForm({ mode: 'edit', song: { id: 's5', title: 'Song', tags: [], file: 'x' } });
  btn(f, 'Get metadata').click();
  await flush();
  assert.match(f.node.textContent, /Couldn't load metadata/);
  assert.equal(btn(f, 'Get metadata').disabled, false);
});

test('reset() aborts an in-flight lookup and restores the initial values', async () => {
  let release;
  stubFetch(() => new Promise((r) => { release = () => r({ body: { album: 'Late' } }); }));
  const f = songForm({ mode: 'edit', song: { id: 's6', title: 'Orig', albums: [], tags: [], file: 'x' } });
  f.setValues({ title: 'Changed' });
  btn(f, 'Get metadata').click();
  f.reset();
  release();
  await flush();
  assert.equal(f.values().title, 'Orig');
  assert.deepEqual(f.values().albums, [], 'late response after reset is ignored');
  f.destroy();
});

test('values() flushes half-typed chips and commits genres/countries', () => {
  const f = songForm({ mode: 'add', song: {} });
  const genre = f.node.querySelector('[aria-label="Genres"]');
  genre.value = 'ambient';
  const country = f.node.querySelector('[aria-label="Countries"]');
  country.value = 'France';
  assert.deepEqual(f.values().tags.sort(), ['country:fr', 'genre:ambient']);
  f.node.querySelector('[aria-label="Genres"]').value = 'dub';
  assert.ok(!f.values({ commit: false }).tags.includes('genre:dub'));
});

test('onChange fires on input from any field', () => {
  let n = 0;
  const f = songForm({ mode: 'add', song: {}, onChange: () => { n += 1; } });
  const album = inputs(f).find((i) => i.getAttribute('type') === 'text' && !i.classList.contains('token-entry') && i.getAttribute('aria-label') === null && i.getAttribute('placeholder') === null);
  album.dispatchEvent(makeEvent('input', { bubbles: true }));
  assert.ok(n >= 1);
});

test('a title with a leading artist offers to move it to Artists', () => {
  const f = songForm({ mode: 'edit', song: { id: 's7', title: 'Band X - Great Song', mainArtists: [], featuredArtists: [], tags: [], file: 'x' } });
  const hint = f.node.querySelectorAll('button').find((b) => /^Move ".*" to Artists\?$/.test(b.textContent));
  assert.ok(hint && !hint.hidden);
  hint.click();
  assert.equal(f.values().title, 'Great Song');
  assert.deepEqual(f.values().mainArtists, ['Band X']);
});

test('setValues updates fields and wiki links; focus targets the title entry', () => {
  const f = songForm({ mode: 'edit', song: { id: 's8', title: 'A', tags: [], file: 'x' } });
  f.setValues({ title: 'B', mainArtists: ['C', 'D'], releaseYear: 1984, wikipedia_song: 'https://en.wikipedia.org/wiki/B' });
  const v = f.values();
  assert.equal(v.title, 'B');
  assert.deepEqual(v.mainArtists, ['C', 'D']);
  assert.equal(String(v.releaseYear), '1984');
  assert.equal(v.wikipedia_song, 'https://en.wikipedia.org/wiki/B');
  assert.equal(v.wikipedia_artist, null);
  f.focus();
});

test('the icon row is seeded from every stored link, as real links', () => {
  const f = songForm({ mode: 'edit', song: {
    id: 'i1', title: 'S', tags: [], file: 'x', source_url: 'https://youtu.be/jNQXAC9IVRw',
    sources: [{ url: 'https://soundcloud.com/a/b' }], wikipedia_artist: 'https://en.wikipedia.org/wiki/Band', discogs_url: 'https://www.discogs.com/release/1',
  } });
  const yt = f.node.querySelector('a.svc-youtube');
  assert.equal(yt.getAttribute('href'), 'https://youtu.be/jNQXAC9IVRw');
  assert.equal(yt.getAttribute('target'), '_blank');
  assert.equal(yt.getAttribute('rel'), 'noopener');
  assert.ok(f.node.querySelector('a.svc-soundcloud'));
  assert.equal(f.node.querySelector('a.svc-wikipedia').getAttribute('aria-label'), 'Wikipedia (artist)');
  assert.ok(f.node.querySelector('a.svc-discogs'));
  assert.equal(f.node.querySelector('a.svc-spotify'), null);
  assert.equal(f.node.querySelector('a.svc-musicbrainz'), null);
});

test('the Add preview seeds the YouTube icon from its source link, and a lookup keeps stored links', async () => {
  stubFetch(() => ({ body: { services: { youtube: { found: true, url: null }, spotify: { found: true, url: 'https://open.spotify.com/track/1' } } } }));
  const f = songForm({ mode: 'add', song: { title: 'S', source_url: 'https://youtu.be/jNQXAC9IVRw', tags: [] }, source: 'https://youtu.be/jNQXAC9IVRw' });
  assert.equal(f.node.querySelector('a.svc-youtube').getAttribute('href'), 'https://youtu.be/jNQXAC9IVRw');
  btn(f, 'Get metadata').click();
  await flush();
  assert.equal(f.node.querySelector('a.svc-youtube').getAttribute('href'), 'https://youtu.be/jNQXAC9IVRw', 'a lookup without a URL keeps the stored link');
});

test('version year and first released inputs have a year range and round-trip', () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', mainArtists: ['A'], featuredArtists: [], releaseYear: 2003, version: { type: 'remix', name: 'R', artists: ['R'], releaseYear: 2024 }, tags: [] } });
  const row = f.node.querySelector('.remix-row.version-row');
  assert.ok(row, 'row exists');
  assert.match(row.textContent, /Remix by/);
  assert.match(row.textContent, /Remix year/);
  const nextYear = new Date().getFullYear() + 1;
  const years = f.node.querySelectorAll('input').filter((x) => x.type === 'number' && String(x.min) === '1900');
  assert.equal(years.length, 2);
  for (const i of years) assert.equal(String(i.max), String(nextYear));
  const v = f.values();
  assert.equal(String(v.version.releaseYear), '2024');
  assert.equal(String(v.releaseYear), '2003', 'original year untouched');
  f.setValues({ version: { type: 'remix', name: 'R', artists: [], releaseYear: '' } });
  assert.equal(f.values().version.releaseYear, '');
  f.setValues({ version: { type: 'remix', name: 'R', artists: [], releaseYear: 2011 } });
  assert.equal(String(f.values().version.releaseYear), '2011');
  f.setValues({ version: null });
  assert.equal(f.values().version, null);
  assert.equal(songForm({ mode: 'add', song: { title: 'T', tags: [] } }).values().version, null);
});

test('values() returns structure keys only', () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', artist: 'A', remixer: 'B Remix', year: 2000, remix_year: 2010, tags: [] } });
  const v = f.values();
  for (const k of ['artist', 'remixer', 'year', 'remix_year']) assert.ok(!(k in v), k);
  assert.deepEqual(v.mainArtists, ['A']);
  assert.deepEqual(v.featuredArtists, []);
  assert.equal(String(v.releaseYear), '2000');
  assert.deepEqual(v.version, { type: 'remix', name: 'B Remix', artists: [], releaseYear: '2010' });
});

test('an untouched edit form returns the stored structure', () => {
  const song = { id: 's1', title: 'T', mainArtists: ['A', 'B'], featuredArtists: ['C'], releaseYear: 1999, version: { type: 'cover', name: null, artists: [], releaseYear: null, originalArtists: 'Z' }, tags: [] };
  const v = songForm({ mode: 'edit', song }).values();
  assert.deepEqual(v.mainArtists, ['A', 'B']);
  assert.deepEqual(v.featuredArtists, ['C']);
  assert.equal(String(v.releaseYear), '1999');
  assert.deepEqual(v.version, { type: 'cover', name: '', artists: [], releaseYear: '', originalArtists: ['Z'] });
});

test('Get metadata for a version song sends version_kind and never takes a MusicBrainz or Discogs link', async () => {
  const calls = stubFetch(() => ({ body: { album: 'Orig LP', year: 1993, services: { musicbrainz: { found: true, url: 'https://mb/1' }, discogs: { found: true, url: 'https://dc/1' } } } }));
  const f = songForm({ mode: 'edit', song: { id: 's9', title: 'T', mainArtists: ['A', 'B'], featuredArtists: [], version: { type: 'live', name: 'Live', artists: [], releaseYear: null }, albums: [], tags: [], file: 'x' } });
  btn(f, 'Get metadata').click();
  await flush();
  const body = JSON.parse(calls.find((c) => c.url === '/metadata').opts.body);
  assert.equal(body.artist, 'A & B');
  assert.equal(body.version_kind, 'live');
  const v = f.values();
  assert.equal(v.musicbrainz_url, null);
  assert.equal(v.discogs_url, null);
  assert.deepEqual(v.albums, [], 'no album of the original recording');
  assert.equal(String(v.releaseYear), '1993');
});

test('Links region: collapsed by default, one labelled field per source, filled rows are new-tab links', () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', artist: 'A', source_url: 'https://youtu.be/abcdefghijk', wikipedia_album: 'https://en.wikipedia.org/wiki/LP', musicbrainz_url: 'https://musicbrainz.org/recording/x', tags: [] } });
  const head = f.node.querySelectorAll('button').find((b) => b.textContent.includes('Links'));
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  head.click();
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  for (const l of ['YouTube link', 'SoundCloud link', 'Wikipedia: song', 'Wikipedia: band', 'Wikipedia: album', 'Spotify link', 'MusicBrainz link', 'Discogs link']) {
    assert.ok(inputs(f).find((i) => i.getAttribute('aria-label') === l), l);
  }
  const rows = f.node.querySelectorAll('.lk-row');
  const yt = rows[0].querySelector('a');
  assert.equal(yt.getAttribute('href'), 'https://youtu.be/abcdefghijk');
  assert.equal(yt.getAttribute('rel'), 'noopener');
  assert.equal(rows[1].querySelector('a'), null);
  const v = f.values();
  assert.equal(v.wikipedia_album, 'https://en.wikipedia.org/wiki/LP');
  const mb = inputs(f).find((i) => i.getAttribute('aria-label') === 'MusicBrainz link');
  mb.value = 'https://musicbrainz.org/recording/y';
  mb.dispatchEvent(makeEvent('input'));
  assert.equal(f.values().musicbrainz_url, 'https://musicbrainz.org/recording/y');
});

test('saveError turns a 422 unknown_genre into an inline message with suggestions and keeps the form', () => {
  const f = songForm({ mode: 'edit', song: { id: 'a', title: 'T', tags: [] } });
  const e = new ApiError(422, 'Unknown genre: rok. Did you mean: rock?', 'unknown_genre');
  e.data = { error: 'unknown_genre', value: 'rok', suggestions: ['rock'] };
  const msg = f.saveError(e);
  assert.match(msg, /"rok" is not in the genre list/);
  const hint = f.node.querySelector('.genre-hint');
  assert.equal(hint.hidden, false);
  hint.querySelectorAll('button')[0].click();
  assert.deepEqual(f.values({ commit: false }).tags, ['genre:rock']);
  assert.equal(f.saveError(new ApiError(500, 'boom')), null);
});

test('typing in the Tags field accumulates letters; a chip appears only on Enter, comma or blur', () => {
  const f = songForm({ mode: 'add', song: {} });
  const tags = f.node.querySelector('.tag-editor');
  const input = tags.querySelector('input');
  const chips = () => tags.querySelector('.chips').children.map((c) => c.textContent.replace(/\s+/g, ''));
  const type = (s) => { for (const ch of s) { input.value += ch; f.node.dispatchEvent(makeEvent('input')); f.values({ commit: false }); } };
  type('asdf');
  assert.equal(input.value, 'asdf');
  assert.deepEqual(chips(), []);
  input.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  assert.equal(input.value, '');
  assert.equal(chips().length, 1);
  assert.ok(chips()[0].startsWith('asdf'));
  type('foo');
  input.dispatchEvent(makeEvent('keydown', { key: ',' }));
  assert.equal(chips().length, 2);
  type('country:fi');
  assert.equal(chips().length, 2);
  input.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  assert.ok(f.values({ commit: false }).tags.includes('country:fi'));
  assert.equal(input.value, '');
});

test('values() with the default commit still flushes pending Tags text', () => {
  const f = songForm({ mode: 'add', song: {} });
  f.node.querySelector('.tag-editor input').value = 'pending';
  assert.ok(f.values().tags.includes('pending'));
});

test('typing letters into Artists and Genres keeps them in the input', () => {
  const f = songForm({ mode: 'add', song: {} });
  for (const label of ['Artists', 'Genres']) {
    const input = f.node.querySelector(`[aria-label="${label}"]`);
    for (const ch of 'asdf') { input.value += ch; input.dispatchEvent(makeEvent('input', { bubbles: true })); }
    assert.equal(input.value, 'asdf', label);
  }
});
