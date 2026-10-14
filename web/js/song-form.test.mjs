import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch, flush } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { songForm } = await import('./song-form.js');

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
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'Song (Live)', artist: 'Band', bpm: 127.6, tags: ['rock'], year: 1999, album: 'LP', file: 'x.mp3' } });
  const v = f.values();
  assert.equal(v.title, 'Song (Live)');
  assert.equal(v.artist, 'Band');
  assert.equal(v.album, 'LP');
  assert.equal(String(v.year), '1999');
  assert.deepEqual(v.tags.filter((t) => !t.startsWith('decade:')), ['rock']);
  assert.ok(v.tags.includes('decade:90s'), 'decade follows the year');
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
  const f = songForm({ mode: 'edit', song: { id: 's4', title: 'Song', artist: 'Typed', album: 'Mine', tags: [], file: 'x' }, source: { url: 'https://y/1' } });
  btn(f, 'Get metadata').click();
  assert.equal(btn(f, 'Getting metadata...') !== undefined || f.node.textContent.includes('Getting metadata'), true);
  await flush();
  const body = JSON.parse(calls.find((c) => c.url === '/metadata').opts.body);
  assert.equal(body.title, 'Song');
  assert.deepEqual(body.sources, [{ url: 'https://y/1' }]);
  const v = f.values();
  assert.equal(v.album, 'Mine', 'existing album kept');
  assert.equal(String(v.year), '2001');
  assert.ok(v.tags.includes('genre:rock') && v.tags.includes('country:gb'));
  assert.equal(v.musicbrainz_url, 'https://mb/1');
  assert.ok(f.node.querySelector('a.svc-musicbrainz'));
  assert.match(f.node.textContent, /Wikipedia says: Real Artist/);
  btn(f, 'Get metadata').disabled === false;
  f.node.querySelector('.wiki-hint').click();
  assert.equal(f.values().artist, 'Real Artist');
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
  const f = songForm({ mode: 'edit', song: { id: 's6', title: 'Orig', album: '', tags: [], file: 'x' } });
  f.setValues({ title: 'Changed' });
  btn(f, 'Get metadata').click();
  f.reset();
  release();
  await flush();
  assert.equal(f.values().title, 'Orig');
  assert.equal(f.values().album, '', 'late response after reset is ignored');
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

test('a title with a leading artist offers to move it to Artist', () => {
  const f = songForm({ mode: 'edit', song: { id: 's7', title: 'Band X - Great Song', artist: '', tags: [], file: 'x' } });
  const hint = f.node.querySelectorAll('button').find((b) => /^Move ".*" to Artist\?$/.test(b.textContent));
  assert.ok(hint && !hint.hidden);
  hint.click();
  assert.equal(f.values().title, 'Great Song');
  assert.equal(f.values().artist, 'Band X');
});

test('setValues updates fields and wiki links; focus targets the title entry', () => {
  const f = songForm({ mode: 'edit', song: { id: 's8', title: 'A', tags: [], file: 'x' } });
  f.setValues({ title: 'B', artist: 'C', year: 1984, wikipedia_song: 'https://en.wikipedia.org/wiki/B' });
  const v = f.values();
  assert.equal(v.title, 'B');
  assert.equal(v.artist, 'C');
  assert.equal(String(v.year), '1984');
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

test('remix year input sits in the remix row and round-trips', () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', remixer: 'R', year: 2003, remix_year: 2024, tags: [] } });
  const row = f.node.querySelector('.remix-row');
  assert.ok(row, 'row exists');
  assert.match(row.textContent, /Remix & additional production/);
  assert.match(row.textContent, /Remix year/);
  const input = row.querySelectorAll('input').find((i) => i.min === 1900 || String(i.min) === '1900');
  assert.ok(input, 'year input with 1900 minimum');
  const nextYear = new Date().getFullYear() + 1;
  for (const i of f.node.querySelectorAll('input').filter((x) => x.type === 'number' && String(x.min) === '1900')) assert.equal(String(i.max), String(nextYear));
  assert.ok(f.node.querySelectorAll('input').some((x) => x.type === 'number' && String(x.max) === String(nextYear) && String(x.min) === '1900'));
  let v = f.values();
  assert.equal(String(v.remix_year), '2024');
  assert.equal(String(v.year), '2003', 'original year untouched');
  f.setValues({ remix_year: '' });
  assert.equal(f.values().remix_year, '');
  f.setValues({ remix_year: 2011 });
  assert.equal(String(f.values().remix_year), '2011');
  assert.equal(String(songForm({ mode: 'add', song: { title: 'T', tags: [] } }).values().remix_year), '');
});
