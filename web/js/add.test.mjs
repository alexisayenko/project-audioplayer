import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { openAdd } = await import('./add.js');

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const PREVIEW = { id: 'dQw4w9WgXcQ', title: 'Rick - Never Gonna (Official Video)', title_raw: 'Rick - Never Gonna (Official Video)', artist: 'Rick', source: 'youtube', source_url: YT, thumbnail: 'https://i/t.jpg', duration: 212, tags: ['genre:pop'], in_library: false };
const dlg = () => document.getElementById('add-dialog');
const urlInput = () => dlg().querySelector('input');
const submitFetch = () => dlg().querySelector('form.well').dispatchEvent(makeEvent('submit'));
const typeUrl = (v) => { urlInput().value = v; urlInput().dispatchEvent(makeEvent('input', { inputType: 'insertText', data: v.slice(-1) })); };
const STAGES = [{ id: 'link', label: 'Reading the link' }, { id: 'details', label: 'Getting title and artist' }, { id: 'wiki', label: 'Checking Wikipedia and Wikidata' }];
const lines = (...evs) => `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`;
const streamOf = (body, status = 200) => lines({ event: 'stages', stages: STAGES },
  ...(status === 200 ? [{ event: 'result', data: body }] : [{ event: 'stage', id: 'link', state: 'start' }, { event: 'error', stage: 'link', status, ...body }]));
const preview = (body, status = 200) => (url, o) => {
  if (url === '/preview/stream') return { body: streamOf(body, status) };
  if (url === '/library') return { body: { songs: store.songs } };
  if (url === '/songs' && o.method === 'POST') return { body: { id: 'dQw4w9WgXcQ', song: { id: 'dQw4w9WgXcQ', title: 'Rick - Never Gonna', tags: ['genre:pop'] } } };
  return { body: {} };
};
const close = () => { dlg().close(); };

test('opens a modal with the URL field focused, Fetch, and a Cancel that closes it', async () => {
  store.loaded = true;
  store.songs = [];
  stubFetch(preview(PREVIEW));
  openAdd();
  assert.equal(dlg().open, true);
  assert.equal(document.activeElement, urlInput());
  assert.equal(dlg().querySelector('h2').textContent, 'Add from YouTube or SoundCloud');
  dlg().querySelector('.dlg-head button').click();
  assert.equal(dlg().open, false);
  assert.equal(dlg().children.length, 0, 'closing clears the dialog');
});

test('pasting a messy link is cleaned; an empty field does nothing', async () => {
  const calls = stubFetch(preview(PREVIEW));
  openAdd();
  submitFetch();
  await flush();
  assert.equal(calls.filter((c) => c.url === '/preview/stream').length, 0);
  urlInput().value = `${YT}&utm_source=x&list=PL1`;
  urlInput().dispatchEvent(makeEvent('input', { inputType: 'insertFromPaste' }));
  assert.equal(urlInput().value, YT);
  close();
});

test('Fetch shows the preview form (title cleaned) and saves with the right payload', async () => {
  store.songs = [];
  const calls = stubFetch(preview(PREVIEW));
  openAdd();
  typeUrl(YT);
  submitFetch();
  assert.equal(dlg().querySelector('button[type=submit]').textContent, 'Fetching...');
  await flush();
  assert.equal(dlg().querySelector('form.well').hidden, true);
  assert.equal(dlg().querySelector('.preview-meta .t-headline').textContent, 'Rick - Never Gonna');
  assert.match(dlg().textContent, /3:32/);
  assert.match(dlg().textContent, /YouTube/);
  const save = dlg().querySelectorAll('button').find((b) => b.textContent === 'Save to library');
  assert.equal(save.disabled, false);
  dlg().querySelector('form.add-card').dispatchEvent(makeEvent('submit'));
  await flush();
  const post = calls.find((c) => c.url === '/songs' && c.opts.method === 'POST');
  const body = JSON.parse(post.opts.body);
  assert.equal(body.url, YT);
  assert.equal(body.metadata.title, 'Rick - Never Gonna');
  assert.deepEqual(body.tags, ['genre:pop']);
  assert.equal(body.audio, false);
  assert.equal(dlg().open, false);
  assert.equal(document.getElementById('toast').textContent, 'Saved to library');
  assert.equal(calls.filter((c) => c.url === '/library').length, 0, 'the saved song is patched into the store, not reloaded');
  assert.equal(store.get('dQw4w9WgXcQ').title, 'Rick - Never Gonna');
});

test('Fetch error is shown and the form stays usable', async () => {
  store.songs = [];
  stubFetch(preview({ detail: 'Video unavailable' }, 502));
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  assert.match(dlg().textContent, /Video unavailable/);
  assert.equal(dlg().querySelector('form.well').hidden, false);
  assert.equal(dlg().querySelector('button[type=submit]').disabled, false);
  assert.equal(dlg().querySelector('button[type=submit]').textContent, 'Fetch');
  close();
});

test('preview_only (SoundCloud Go+) gets the friendly explanation', async () => {
  stubFetch(preview({ error: 'preview_only', detail: 'x' }, 422));
  openAdd();
  typeUrl('https://soundcloud.com/a/b');
  submitFetch();
  await flush();
  assert.match(dlg().textContent, /Preview only/);
  close();
});

test('an already-saved song disables Fetch and links to it', async () => {
  store.loaded = true;
  store.songs = [{ id: 'dQw4w9WgXcQ', title: 'Have it', artist: 'Me', sources: [{ url: YT }] }];
  stubFetch(preview(PREVIEW));
  openAdd();
  typeUrl(YT);
  assert.equal(dlg().querySelector('button[type=submit]').disabled, true);
  assert.match(dlg().textContent, /Already in your library: Me - Have it/);
  const calls = stubFetch(preview(PREVIEW));
  submitFetch();
  await flush();
  assert.equal(calls.length, 0, 'no preview request for a known song');
  dlg().querySelectorAll('button').find((b) => b.textContent === 'Show in library').click();
  assert.equal(dlg().open, false);
  assert.match(document.getElementById('toast').textContent, /Clear the search or filters/);
});

test('server says in_library: warns and disables saving', async () => {
  store.loaded = true;
  store.songs = [];
  stubFetch(preview({ ...PREVIEW, in_library: true }));
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  assert.match(dlg().textContent, /already in your library/);
  assert.equal(dlg().querySelectorAll('button').find((b) => b.textContent === 'Save to library').disabled, true);
  close();
});

test('save failure keeps the dialog open, shows the message and re-enables Save', async () => {
  store.songs = [];
  stubFetch((url, o) => {
    if (url === '/preview/stream') return { body: streamOf(PREVIEW) };
    if (url === '/songs' && o.method === 'POST') return { status: 429, body: { error: 'hourly_limit', retry_after_minutes: 12 } };
    return { body: { songs: [] } };
  });
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  dlg().querySelector('form.add-card').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.equal(dlg().open, true);
  assert.match(dlg().textContent, /Hourly limit reached\. Try again in 12 minutes/);
  assert.equal(dlg().querySelectorAll('button').find((b) => b.textContent === 'Save to library').disabled, false);
  close();
});

test('closing while a preview is in flight ignores the late answer', async () => {
  let release;
  stubFetch((url) => (url === '/preview/stream' ? new Promise((r) => { release = () => r({ body: streamOf(PREVIEW) }); }) : { body: { songs: [] } }));
  openAdd();
  typeUrl(YT);
  submitFetch();
  close();
  release();
  await flush();
  assert.equal(dlg().children.length, 0);
});

test('with auto-download on, the saved song is queued for download at the front', async () => {
  localStorage.setItem('ap2.autodl', '1');
  store.songs = [];
  const calls = stubFetch((url, o) => {
    if (url === '/preview/stream') return { body: streamOf(PREVIEW) };
    if (url === '/songs' && o.method === 'POST') return { body: { id: 'dQw4w9WgXcQ', song: { id: 'dQw4w9WgXcQ', title: 'Rick - Never Gonna', tags: ['genre:pop'] } } };
    if (url.endsWith('/audio')) return { body: { status: 'done' } };
    return { body: { songs: [] } };
  });
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  dlg().querySelector('form.add-card').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.ok(calls.some((c) => c.url === '/songs/dQw4w9WgXcQ/audio'));
  localStorage.setItem('ap2.autodl', '0');
});

test('save sends structure keys, no legacy keys, and the preview raw strings as source_raw', async () => {
  store.loaded = true;
  store.songs = [];
  const raw = { title: 'Rick - Never Gonna (Official Video)', artist: 'Rick', remixer: null };
  const calls = stubFetch(preview({ ...PREVIEW, raw, year: 1987 }));
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  assert.match(dlg().querySelector('.preview-meta .t-subhead').textContent, /Rick.*1987/);
  dlg().querySelector('form.add-card').dispatchEvent(makeEvent('submit'));
  await flush();
  const body = JSON.parse(calls.find((c) => c.url === '/songs' && c.opts.method === 'POST').opts.body);
  assert.deepEqual(body.source_raw, raw);
  assert.deepEqual(body.metadata.mainArtists, ['Rick']);
  assert.deepEqual(body.metadata.featuredArtists, []);
  assert.equal(body.metadata.releaseYear, 1987);
  assert.ok(!('version' in body.metadata));
  for (const k of ['artist', 'remixer', 'year', 'remix_year']) assert.ok(!(k in body.metadata), k);
});

test('a structured library song is shown as its display line in the Already-in-library hint', () => {
  store.loaded = true;
  store.songs = [{ id: 'dQw4w9WgXcQ', title: 'Have it', mainArtists: ['A', 'B'], featuredArtists: [], sources: [{ url: YT }] }];
  stubFetch(preview(PREVIEW));
  openAdd();
  typeUrl(YT);
  assert.match(dlg().textContent, /Already in your library: A & B - Have it/);
  close();
});

test('preview card: title, then "Artists · Year", then the album on its own line (omitted when empty)', async () => {
  store.loaded = true;
  store.songs = [];
  stubFetch(preview({ ...PREVIEW, title: 'ODIUM', title_raw: 'ODIUM', artist: 'LXST CXNTURY', album: 'Universe of the Past', year: 2019 }));
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  const subs = () => [...dlg().querySelectorAll('.preview-meta .t-subhead')].filter((n) => !n.hidden).map((n) => n.textContent);
  assert.equal(dlg().querySelector('.preview-meta .t-headline').textContent, 'ODIUM');
  assert.deepEqual(subs(), ['LXST CXNTURY · 2019', 'Universe of the Past']);
  close();
  stubFetch(preview({ ...PREVIEW, album: null, year: null }));
  openAdd();
  typeUrl(YT);
  submitFetch();
  await flush();
  assert.deepEqual(subs(), ['Rick']);
  close();
});
