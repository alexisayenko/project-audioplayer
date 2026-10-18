import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { playlistImport } = await import('./playlist-import.js');
const { openAdd } = await import('./add.js');

const LINK = { kind: 'playlist', id: 'PLabc', video: null, url: 'https://www.youtube.com/playlist?list=PLabc' };
const id = (n) => `v${String(n).padStart(10, '0')}`;
const entry = (n, extra = {}) => ({
  id: id(n), url: `https://www.youtube.com/watch?v=${id(n)}`, state: 'ok', reason: null, title: `Song ${n}`, mainArtists: [`Artist ${n}`], featuredArtists: [],
  version: null, releaseYear: null, publishedYear: null, tags: [], duration: 200, long: false, thumbnail: null, raw: { title: `Song ${n}`, artist: `Artist ${n}`, remixer: null },
  duplicate: null, detailed: false, ...extra,
});
const playlist = (extra = {}) => ({ id: 'PLabc', url: LINK.url, title: 'Road trip', uploader: 'Alex', total: 5, shown: 5, limit: 200, truncated: false, ...extra });
const ENTRIES = [
  entry(1),
  entry(2, { long: true, duration: 301 }),
  entry(3, { duplicate: 'id' }),
  entry(4, { state: 'unavailable', reason: 'Private', title: '[Private video]', mainArtists: [], duration: null }),
  entry(5, { version: { type: 'remix', name: 'Foo Remix', artists: [], releaseYear: null } }),
];

function server({ entries = ENTRIES, list = playlist(), add, usage = { songs: 3, max_songs: null }, details } = {}) {
  const calls = stubFetch(async (url, o) => {
    if (url === '/import/youtube-playlist') return list.status ? { status: list.status, body: list.body } : { body: { playlist: list, entries } };
    if (url === '/import/youtube-playlist/details') {
      const ids = JSON.parse(o.body).ids;
      return details ? details(ids) : { body: { entries: ids.map((i) => entries.find((e) => e.id === i)).filter(Boolean).map((e) => ({ ...e, detailed: true })), failed: [] } };
    }
    if (url === '/me/usage') return { body: usage };
    if (url === '/library') return { body: { songs: [] } };
    if (url === '/songs' && o.method === 'POST') return add ? add(JSON.parse(o.body)) : { status: 201, body: { id: JSON.parse(o.body).url.slice(-11), song: { id: JSON.parse(o.body).url.slice(-11) } } };
    return { body: {} };
  });
  return calls;
}

async function mount(opts, extra = {}) {
  store.loaded = true;
  store.songs = [];
  const calls = server(opts);
  const imp = playlistImport({ link: LINK, ...extra });
  document.body.append(imp.node);
  await imp.ready();
  await flush();
  return { imp, calls };
}
const rows = (imp) => imp.node.querySelectorAll('li.imp-row');
const boxes = (imp) => imp.node.querySelectorAll('input');
const row = (imp, n) => rows(imp).find((r) => r.getAttribute('data-id') === id(n));
const box = (imp, n) => row(imp, n).querySelector('input');
const tick = (imp, n, on) => { const b = box(imp, n); b.checked = on; b.dispatchEvent(makeEvent('change')); };
const counter = (imp) => imp.node.querySelector('.imp-count').textContent;
const addBtn = (imp) => imp.node.querySelectorAll('button').find((b) => /^Add \d+ songs?$/.test(b.textContent));
const posts = (calls) => calls.filter((c) => c.url === '/songs' && c.opts.method === 'POST').map((c) => JSON.parse(c.opts.body));
const done = async (imp) => { for (let i = 0; i < 20; i += 1) await flush(); return imp; };

test('lists one row per video with the Library title span, artists, version, length and status marks', async () => {
  const { imp } = await mount();
  assert.equal(imp.node.querySelector('h3').textContent, 'Road trip');
  assert.equal(rows(imp).length, 5);
  assert.equal(row(imp, 5).querySelector('.rmx').textContent, '(Foo Remix)');
  assert.equal(row(imp, 5).querySelector('.imp-version').textContent, 'Remix');
  assert.equal(row(imp, 1).querySelector('.imp-artists').textContent, 'Artist 1');
  assert.equal(row(imp, 1).querySelector('.imp-dur').textContent, '3:20');
  assert.match(row(imp, 2).textContent, /Over 5 min/);
  assert.match(row(imp, 3).textContent, /In library/);
  assert.match(row(imp, 4).textContent, /Unavailable/);
  assert.match(row(imp, 4).querySelector('.sub').textContent, /Private video/);
  assert.equal(row(imp, 1).querySelector('.imp-mark'), null);
  imp.destroy();
});

test('default selection: short, new songs only; counter and button follow it', async () => {
  const { imp } = await mount();
  assert.deepEqual(boxes(imp).map((b) => b.checked), [true, false, false, false, true]);
  assert.equal(box(imp, 4).disabled, true);
  assert.equal(box(imp, 3).disabled, false, 'a duplicate can still be ticked');
  assert.equal(counter(imp), '2 of 4 selected');
  assert.equal(addBtn(imp).textContent, 'Add 2 songs');
  tick(imp, 2, true);
  tick(imp, 3, true);
  assert.equal(counter(imp), '4 of 4 selected');
  assert.equal(addBtn(imp).textContent, 'Add 4 songs');
  tick(imp, 1, false);
  tick(imp, 2, false);
  tick(imp, 3, false);
  tick(imp, 5, false);
  assert.equal(addBtn(imp).disabled, true);
  assert.equal(addBtn(imp).textContent, 'Add 0 songs');
  imp.destroy();
});

test('select all ticks every listed video (not the unavailable one), select none clears', async () => {
  const { imp } = await mount();
  const [all, none] = imp.node.querySelectorAll('button').filter((b) => /^Select (all|none)$/.test(b.textContent));
  all.click();
  assert.deepEqual(boxes(imp).map((b) => b.checked), [true, true, true, false, true]);
  assert.equal(counter(imp), '4 of 4 selected');
  none.click();
  assert.deepEqual(boxes(imp).map((b) => b.checked), [false, false, false, false, false]);
  assert.equal(counter(imp), '0 of 4 selected');
  imp.destroy();
});

test('rows and checkboxes are labelled for assistive technology', async () => {
  const { imp } = await mount();
  assert.equal(box(imp, 1).getAttribute('aria-label'), 'Select Song 1 by Artist 1');
  assert.equal(box(imp, 5).getAttribute('aria-label'), 'Select Song 5 (Foo Remix) by Artist 5');
  assert.equal(imp.node.querySelector('.imp-count').getAttribute('aria-live'), 'polite');
  assert.equal(imp.node.querySelector('.imp-cols').getAttribute('aria-hidden'), 'true');
  imp.destroy();
});

test('"first 200 of N" is said when the playlist is longer', async () => {
  const { imp } = await mount({ list: playlist({ total: 350, shown: 200, truncated: true }) });
  assert.match(imp.node.textContent, /350 videos\. Showing the first 200 of 350\./);
  imp.destroy();
});

test('details arrive in batches of 10 and fill year and genres', async () => {
  const many = Array.from({ length: 30 }, (_, i) => entry(i + 1));
  const calls = server({
    entries: many,
    list: playlist({ total: 30, shown: 30 }),
    details: (ids) => ({ body: { entries: ids.map((i) => ({ ...many.find((e) => e.id === i), detailed: true, tags: ['genre:house'], version: { type: 'remix', name: 'X Remix', artists: [], releaseYear: 2021 } })), failed: [] } }),
  });
  store.loaded = true;
  const imp = playlistImport({ link: LINK });
  document.body.append(imp.node);
  await imp.ready();
  await done(imp);
  const detailCalls = calls.filter((c) => c.url === '/import/youtube-playlist/details').map((c) => JSON.parse(c.opts.body).ids.length);
  assert.deepEqual(detailCalls, [10, 10, 10]);
  assert.equal(row(imp, 1).querySelector('.imp-year').textContent, '2021');
  assert.equal(row(imp, 1).querySelector('.imp-genres').textContent, 'house');
  imp.destroy();
});

test('details can flag a duplicate the listing missed; a row the user already touched keeps its tick', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  server({ details: async (ids) => {
    await gate;
    return { body: { entries: ids.map((i) => ({ ...ENTRIES.find((e) => e.id === i), detailed: true, duplicate: i === id(1) || i === id(5) ? 'match' : null })), failed: [] } };
  } });
  store.loaded = true;
  const imp = playlistImport({ link: LINK });
  document.body.append(imp.node);
  for (let i = 0; i < 5; i += 1) await flush();
  tick(imp, 5, true);
  tick(imp, 2, true);
  release();
  await imp.ready();
  await done(imp);
  assert.equal(box(imp, 1).checked, false, 'untouched row follows the new default');
  assert.match(row(imp, 1).textContent, /In library/);
  assert.equal(box(imp, 5).checked, true, 'touched row keeps the user choice');
  assert.equal(box(imp, 2).checked, true);
  imp.destroy();
});

test('a video whose details YouTube refuses becomes an Unavailable row, unticked and disabled', async () => {
  const { imp } = await mount({ details: (ids) => ({ body: { entries: ids.filter((i) => i !== id(1)).map((i) => ({ ...ENTRIES.find((e) => e.id === i), detailed: true })), failed: [id(1)], unavailable: [id(1)] } }) });
  await done(imp);
  assert.match(row(imp, 1).textContent, /Unavailable/);
  assert.match(row(imp, 1).querySelector('.sub').textContent, /Unavailable video/);
  assert.equal(box(imp, 1).checked, false);
  assert.equal(box(imp, 1).disabled, true);
  assert.equal(counter(imp), '1 of 3 selected');
  imp.destroy();
});

test('a video that merely timed out keeps its row and tick', async () => {
  const { imp } = await mount({ details: (ids) => ({ body: { entries: ids.filter((i) => i !== id(1)).map((i) => ({ ...ENTRIES.find((e) => e.id === i), detailed: true })), failed: [id(1)], unavailable: [] } }) });
  await done(imp);
  assert.equal(box(imp, 1).checked, true);
  assert.equal(box(imp, 1).disabled, false);
  assert.doesNotMatch(row(imp, 1).textContent, /Unavailable/);
  imp.destroy();
});

test('a rate-limited details batch stops the loading, keeps what arrived and says so', async () => {
  const many = Array.from({ length: 30 }, (_, i) => entry(i + 1));
  let calls = 0;
  const seen = server({
    entries: many,
    list: playlist({ total: 30, shown: 30 }),
    details: (ids) => {
      calls += 1;
      const got = calls === 1 ? ids : ids.slice(0, 2);
      return { body: { entries: got.map((i) => ({ ...many.find((e) => e.id === i), detailed: true, tags: ['genre:house'] })), failed: ids.filter((i) => !got.includes(i)), unavailable: [], rate_limited: calls === 2 } };
    },
  });
  store.loaded = true;
  const imp = playlistImport({ link: LINK });
  document.body.append(imp.node);
  await imp.ready();
  await done(imp);
  assert.equal(seen.filter((c) => c.url === '/import/youtube-playlist/details').length, 2);
  assert.equal(row(imp, 1).querySelector('.imp-genres').textContent, 'house');
  assert.equal(row(imp, 25).querySelector('.imp-genres').textContent, '');
  assert.equal(box(imp, 25).disabled, false);
  assert.match(imp.node.querySelector('.imp-status').textContent, /^YouTube is rate-limiting this server, try again later/);
  imp.destroy();
});

test('details failing keeps the flat rows and says so', async () => {
  const { imp } = await mount({ details: () => ({ status: 429, body: { error: 'import_limit', detail: 'x', retry_after_minutes: 5 } }) });
  assert.match(imp.node.querySelector('.imp-status').textContent, /Year and genre details are missing.*Playlist import limit reached/);
  assert.equal(rows(imp).length, 5);
  imp.destroy();
});

test('Add sends one catalog save per ticked song, in order, then marks them Added and refreshes the library', async () => {
  const { imp, calls } = await mount();
  tick(imp, 3, true);
  addBtn(imp).click();
  await done(imp);
  const sent = posts(calls);
  assert.deepEqual(sent.map((b) => b.url.slice(-11)), [id(1), id(3), id(5)]);
  assert.equal(sent[0].audio, false);
  assert.equal(sent[0].metadata.title, 'Song 1');
  assert.deepEqual(sent[0].metadata.mainArtists, ['Artist 1']);
  assert.deepEqual(sent[2].metadata.version, { type: 'remix', name: 'Foo Remix', artists: [], releaseYear: null });
  assert.deepEqual(sent[0].source_raw, { title: 'Song 1', artist: 'Artist 1', remixer: null });
  assert.match(row(imp, 1).textContent, /Added/);
  assert.equal(box(imp, 1).disabled, true);
  assert.equal(box(imp, 1).checked, false);
  assert.equal(counter(imp), '0 of 1 selected');
  assert.equal(calls.filter((c) => c.url === '/library').length, 1);
  assert.equal(document.getElementById('toast').textContent, 'Added 3 songs');
  assert.match(imp.node.querySelector('.imp-msg').textContent, /Added 3 songs/);
  assert.equal(imp.node.querySelector('progress').hidden, true);
  assert.equal(imp.node.isConnected, true, 'the view stays open');
  imp.destroy();
});

test('a failed song is reported, marked Failed and stays ticked for a retry; the others are added', async () => {
  const { imp } = await mount({ add: (b) => (b.url.endsWith(id(5)) ? { status: 422, body: { detail: 'genre is not in the list' } } : { status: 201, body: { id: b.url.slice(-11), song: { id: b.url.slice(-11) } } }) });
  addBtn(imp).click();
  await done(imp);
  assert.match(row(imp, 1).textContent, /Added/);
  assert.match(row(imp, 5).textContent, /Failed/);
  assert.equal(row(imp, 5).querySelector('.imp-mark').getAttribute('title'), 'genre is not in the list');
  assert.equal(box(imp, 5).checked, true);
  assert.equal(document.getElementById('toast').textContent, 'Added 1 song (1 failed)');
  assert.equal(counter(imp), '1 of 3 selected');
  imp.destroy();
});

test('quota: only what fits is added and the rest is reported', async () => {
  const { imp, calls } = await mount({ usage: { songs: 499, max_songs: 500 } });
  tick(imp, 3, true);
  addBtn(imp).click();
  await done(imp);
  assert.deepEqual(posts(calls).map((b) => b.url.slice(-11)), [id(1)]);
  assert.equal(document.getElementById('toast').textContent, 'Added 1 song (2 over your library limit)');
  imp.destroy();
});

test('quota: a full library adds nothing and says why', async () => {
  const { imp, calls } = await mount({ usage: { songs: 500, max_songs: 500 } });
  addBtn(imp).click();
  await done(imp);
  assert.equal(posts(calls).length, 0);
  assert.match(imp.node.querySelector('.imp-msg').textContent, /library is full \(500 songs\)/);
  assert.equal(addBtn(imp).disabled, false);
  imp.destroy();
});

test('the server refusing mid-run (library full) stops the run and reports how many were not added', async () => {
  let n = 0;
  const { imp, calls } = await mount({ add: () => {
    n += 1;
    return n === 2 ? { status: 403, body: { error: 'library_full_songs', detail: 'full' } } : { status: 201, body: { id: 'x', song: { id: 'x' } } };
  } });
  tick(imp, 2, true);
  addBtn(imp).click();
  await done(imp);
  assert.equal(posts(calls).length, 2);
  assert.match(document.getElementById('toast').textContent, /^Added 1 song \(stopped: Your library is full\. Delete some songs to add more\., 2 not added\)$/);
  imp.destroy();
});

test('a failed playlist lookup shows the message and Try again reloads it', async () => {
  const { imp, calls } = await mount({ list: Object.assign(playlist(), { status: 404, body: { error: 'not_found', detail: 'playlist lookup failed: The playlist does not exist.' } }) });
  assert.match(imp.node.textContent, /playlist does not exist/);
  const retry = imp.node.querySelectorAll('button').find((b) => b.textContent === 'Try again');
  retry.click();
  await flush();
  assert.equal(calls.filter((c) => c.url === '/import/youtube-playlist').length, 2);
  imp.destroy();
});

test('Change link and Add just this video call back', async () => {
  let back = 0;
  let single = 0;
  const { imp } = await mount({}, { onBack: () => { back += 1; }, onSingle: () => { single += 1; } });
  imp.node.querySelectorAll('button').find((b) => b.textContent === 'Change link').click();
  imp.node.querySelectorAll('button').find((b) => b.textContent === 'Add just this video').click();
  assert.deepEqual([back, single], [1, 1]);
  imp.destroy();
});

const dlg = () => document.getElementById('add-dialog');
const submitFetch = () => dlg().querySelector('form.well').dispatchEvent(makeEvent('submit'));
const typeUrl = (v) => { const i = dlg().querySelector('input'); i.value = v; i.dispatchEvent(makeEvent('input', { inputType: 'insertFromPaste' })); };

test('Add: a pasted playlist link opens the import view instead of the single-song form', async () => {
  const calls = server();
  store.loaded = true;
  openAdd();
  typeUrl(`https://www.youtube.com/playlist?list=PLabc&si=track`);
  assert.equal(dlg().querySelector('input').value, 'https://www.youtube.com/playlist?list=PLabc');
  submitFetch();
  await flush();
  await flush();
  assert.equal(dlg().classList.contains('import'), true);
  assert.equal(dlg().querySelector('form.well').hidden, true);
  assert.equal(calls.filter((c) => c.url === '/preview/stream').length, 0);
  assert.equal(calls.find((c) => c.url === '/import/youtube-playlist').opts.body, JSON.stringify({ url: LINK.url }));
  assert.equal(dlg().querySelectorAll('li.imp-row').length, 5);
  dlg().close();
  assert.equal(dlg().classList.contains('import'), false);
});

test('Add: a Mix link gets a clear message and no request; a video taken from a Mix is still a single video', async () => {
  const calls = server();
  openAdd();
  typeUrl('https://www.youtube.com/playlist?list=RDCLAK5uy_abc');
  submitFetch();
  await flush();
  assert.match(dlg().querySelector('.msg.error').textContent, /Mix/);
  assert.equal(calls.length, 0);
  typeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ');
  assert.equal(dlg().querySelector('input').value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  dlg().close();
});

test('Add: a video link inside a playlist offers "Add just this video"', async () => {
  const calls = server();
  openAdd();
  typeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc');
  assert.equal(dlg().querySelector('input').value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc');
  submitFetch();
  await flush();
  await flush();
  const only = dlg().querySelectorAll('button').find((b) => b.textContent === 'Add just this video');
  assert.ok(only);
  only.click();
  await flush();
  assert.equal(dlg().classList.contains('import'), false);
  assert.equal(dlg().querySelector('input').value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(calls.filter((c) => c.url === '/preview/stream').length, 1);
  dlg().close();
});
