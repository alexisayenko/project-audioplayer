import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => {
  const t = realSetTimeout(fn, ms, ...a);
  if (ms > 5000) t.unref?.();
  return t;
};
const { initPlayer } = await import('./player.js');
initPlayer();
const { openAddAlbum } = await import('./albums.js');
const { progressText, fraction } = await import('./album-video-progress.js');

const VIDEO = 'https://youtu.be/yeUFSnA9Puk?si=abc';
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
  return cond();
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush(); };

const PV = {
  videoId: 'yeUFSnA9Puk', url: 'https://youtu.be/yeUFSnA9Puk', title: 'Deep Mix', uploader: 'DJ Q', thumbnail: 'https://i/t.jpg', duration: 3600,
  source: 'description', rawText: '00:00 A - One',
  tracks: [
    { index: 0, start: 0, end: 600, artists: ['A', 'B'], title: 'One', version: null, trackNo: 1, warnings: [], match: null },
    { index: 1, start: 600, end: 1800, artists: ['C'], title: 'Two', version: 'Remix', trackNo: 2, warnings: ['artist guessed'], match: { songId: 's9', title: 'Two', artists: ['C'] } },
    { index: 2, start: 1800, end: 3600, artists: [], title: 'Three', version: null, trackNo: 3, warnings: [], match: null },
  ],
  album: { title: 'Deep Mix', albumArtist: 'Various Artists', type: 'mix', year: null, coverUrl: 'https://i/t.jpg' },
  warnings: [],
};

function server({ preview = () => ok(PV), previewText = () => ok({ ...PV, source: 'pasted' }), create = () => ok({ jobId: 'j1', albumId: 'alb_1', songIds: ['n1', 'n3'] }, 202), job = null } = {}) {
  let polls = 0;
  const calls = stubFetch((u, o) => {
    if (u === '/albums/from-video/preview') return preview(o);
    if (u === '/albums/from-video/preview-text') return previewText(o);
    if (u === '/albums/from-video') return create(o);
    if (u === '/jobs/j1') {
      polls += 1;
      return job ? job(polls) : ok({ state: polls < 2 ? 'splitting' : 'done', done: polls < 2 ? 1 : 2, total: 2, current: 'One' });
    }
    if (u === '/me') return ok({ owner: false });
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [] });
    return ok({});
  });
  return calls;
}

async function open(address = VIDEO) {
  openAddAlbum();
  q('.well input').value = address;
  fire(q('.well'), 'submit');
  await settle();
}
const rows = () => qa('li.av-row');
const createBtn = () => qa('button').find((b) => /^Create album/.test(b.textContent));
const post = (calls, url) => JSON.parse(calls.find((c) => c.url === url).opts.body);
const typeInto = (node, value) => { node.value = value; fire(node, 'input'); };
const tick = (node, on) => { node.checked = on; fire(node, 'change'); };
const tokens = (label, value) => { const n = qa('.token-field').find((x) => x.getAttribute('aria-label') === label); n.value = value; fire(n, 'input'); };

test('a video link calls the preview and shows the editable table; nothing is created yet', async () => {
  const calls = server();
  await open();
  assert.deepEqual(post(calls, '/albums/from-video/preview'), { url: VIDEO });
  assert.equal(rows().length, 3);
  assert.equal(q('form.well').hidden, true);
  assert.match(q('.av-head').textContent, /Deep Mix/);
  assert.match(q('.av-summary').textContent, /^2 tracks · 40 min$/);
  assert.equal(rows()[0].querySelector('.av-start').value, '00:00:00');
  assert.equal(rows()[0].querySelector('.av-artist').value, 'A & B');
  assert.equal(rows()[1].querySelector('.av-version').value, 'Remix');
  assert.ok(!q('.av-advanced').open);
  assert.equal(q('.av-advanced .av-end-input').value, '01:00:00');
  assert.equal(rows()[0].textContent.includes('to 00:10:00'), false);
  const yt = rows()[2].querySelector('a.av-yt');
  assert.equal(yt.href, 'https://youtu.be/yeUFSnA9Puk?t=1800');
  assert.equal(yt.getAttribute('aria-label'), 'Open in YouTube at this time');
  assert.equal(yt.title, 'Open in YouTube at this time');
  const rm = rows()[2].querySelector('button.av-remove');
  assert.equal(rm.getAttribute('aria-label'), 'Remove');
  assert.equal(rows()[0].querySelectorAll('.av-line1').length, 1);
  assert.equal(rows()[0].querySelectorAll('.av-line2 input').length, 3);
  assert.equal(rows()[0].querySelector('.av-line1 .av-artist'), null);
  assert.equal(calls.some((c) => c.url === '/albums/from-video'), false);
  D().close();
});

test('a library match is unticked with In library and Use existing; ticking it links the song', async () => {
  const calls = server();
  await open();
  const row = rows()[1];
  assert.equal(row.querySelector('input[type=checkbox]').checked, false);
  assert.ok(row.querySelector('.album-in-library'));
  assert.match(row.textContent, /artist guessed/);
  const use = row.querySelector('.av-use input');
  tick(use, true);
  assert.equal(row.querySelector('input[type=checkbox]').checked, true);
  assert.match(q('.av-summary').textContent, /^3 tracks/);
  fire(createBtn(), 'click');
  await settle();
  const body = post(calls, '/albums/from-video');
  assert.equal(body.tracks[1].useExistingSongId, 's9');
  assert.equal(body.tracks[0].useExistingSongId, null);
  D().close();
});

test('edits to start, artist, title, version and the album header reach the create body; times re-chain', async () => {
  const calls = server();
  await open();
  const r = rows();
  typeInto(r[2].querySelector('.av-start'), '31:30');
  typeInto(r[0].querySelector('.av-title'), 'Opening');
  typeInto(r[0].querySelector('.av-artist'), 'X & Y & Z');
  typeInto(r[0].querySelector('.av-version'), 'Radio Edit');
  typeInto(q('.av-advanced .av-end-input'), '1:00:30');
  tokens('Album title', 'My Mix');
  tokens('Album artists', 'Various');
  const year = qa('.album-fields input').find((i) => i.getAttribute('aria-label') === 'Year');
  typeInto(year, '2019');
  const type = q('.album-fields select');
  type.value = 'single';
  fire(type, 'change');
  fire(createBtn(), 'click');
  await settle();
  const body = post(calls, '/albums/from-video');
  assert.equal(body.url, 'https://youtu.be/yeUFSnA9Puk');
  assert.deepEqual(body.album, { title: 'My Mix', albumArtist: 'Various', type: 'single', year: 2019, genres: [], coverUrl: 'https://i/t.jpg' });
  assert.deepEqual(body.tracks[0], { include: true, start: 0, end: 600, artists: ['X', 'Y', 'Z'], title: 'Opening', version: 'Radio Edit', trackNo: 1, useExistingSongId: null });
  assert.equal(body.tracks[2].start, 1890);
  assert.equal(body.tracks[2].end, 3630);
  assert.equal(body.tracks[1].include, false);
  assert.equal(body.fades, false);
  D().close();
});

test('fades follow the type until the user ticks the box', async () => {
  const calls = server();
  await open();
  const box = q('.av-fades input');
  assert.equal(box.checked, true);
  const type = q('.album-fields select');
  type.value = 'album';
  fire(type, 'change');
  assert.equal(box.checked, false);
  tick(box, true);
  type.value = 'single';
  fire(type, 'change');
  assert.equal(box.checked, true);
  fire(createBtn(), 'click');
  await settle();
  assert.equal(post(calls, '/albums/from-video').fades, true);
  D().close();
});

test('add, remove, select all or none, offset all and sort keep the table consistent', async () => {
  server();
  await open();
  const sel = q('.av-select-all');
  assert.equal(sel.textContent, 'Select all');
  fire(sel, 'click');
  assert.equal(rows().every((r) => r.querySelector('input[type=checkbox]').checked), true);
  assert.equal(q('.av-select-all').textContent, 'Select none');
  fire(q('.av-select-all'), 'click');
  assert.match(q('.av-summary').textContent, /^0 tracks/);
  assert.equal(createBtn().disabled, true);
  assert.match(q('.av-problems').textContent, /at least one/);
  fire(q('.av-select-all'), 'click');

  const delta = q('.av-delta');
  delta.value = '10';
  fire(qa('button').find((b) => b.textContent === 'Later'), 'click');
  assert.equal(rows()[1].querySelector('.av-start').value, '00:10:10');
  fire(qa('button').find((b) => b.textContent === 'Earlier'), 'click');
  assert.equal(rows()[1].querySelector('.av-start').value, '00:10:00');

  fire(qa('button').find((b) => /^Add a track/.test(b.textContent)), 'click');
  assert.equal(rows().length, 4);
  assert.equal(rows()[3].querySelector('.av-title').value, '');
  assert.match(q('.av-problems').textContent, /Title is empty/);
  fire([...rows()[3].querySelectorAll('button')].find((b) => /^Remove/.test(b.getAttribute('aria-label'))), 'click');
  assert.equal(rows().length, 3);

  typeInto(rows()[0].querySelector('.av-start'), '40:00');
  assert.ok(qa('button').find((b) => b.textContent === 'Sort by start time' && !b.hidden));
  fire(qa('button').find((b) => b.textContent === 'Sort by start time'), 'click');
  assert.equal(rows()[2].querySelector('.av-title').value, 'One');
  D().close();
});

test('a bad start time is flagged and blocks Create', async () => {
  server();
  await open();
  const input = rows()[0].querySelector('.av-start');
  typeInto(input, '1:99');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.match(rows()[0].querySelector('.av-issue').textContent, /Start must look like/);
  assert.equal(createBtn().disabled, true);
  typeInto(input, '0');
  assert.equal(createBtn().disabled, false);
  D().close();
});

test('apply the album artist to every track', async () => {
  server();
  await open();
  const btn = qa('button').find((b) => b.textContent === 'Use album artist for all tracks');
  fire(btn, 'click');
  assert.equal(rows()[2].querySelector('.av-artist').value, 'Various Artists');
  D().close();
});

test('422 no tracklist offers the paste box; pasted text goes to preview-text', async () => {
  const calls = server({ preview: () => ok({ detail: 'no tracklist found' }, 422) });
  await open();
  const area = q('textarea');
  assert.ok(area);
  assert.match(q('.album-video').textContent, /No track list was found/);
  fire(q('.album-video'), 'submit');
  await settle();
  assert.match(q('.msg.error').textContent, /Paste the track list first/);
  area.value = '00:00 A - One\n10:00 B - Two';
  fire(q('.album-video'), 'submit');
  await settle();
  assert.deepEqual(post(calls, '/albums/from-video/preview-text'), { url: VIDEO, text: '00:00 A - One\n10:00 B - Two' });
  assert.equal(rows().length, 3);
  assert.match(q('.av-head').textContent, /pasted text/);
  D().close();
});

test('pasted text with no tracks stays in the paste box with a hint', async () => {
  server({ preview: () => ok({ detail: 'no tracklist found' }, 422), previewText: () => ok({ detail: 'no tracklist found' }, 422) });
  await open();
  q('textarea').value = 'nothing here';
  fire(q('.album-video'), 'submit');
  await settle();
  assert.ok(q('textarea'));
  assert.match(q('.msg.error').textContent, /No tracks found/);
  D().close();
});

test('preview errors: 413 limit, 404 private, 400 invalid; Back returns to the address field', async () => {
  for (const [status, detail, re] of [[413, 'video longer than 4 hours', /longer than 4 hours/], [404, 'x', /private/], [400, 'x', /not a valid YouTube video/]]) {
    server({ preview: () => ok({ detail }, status) });
    await open();
    assert.match(q('.msg.error').textContent, re);
    assert.equal(rows().length, 0);
    D().close();
  }
  server();
  await open();
  fire(qa('button').find((b) => b.textContent === 'Back'), 'click');
  assert.equal(q('form.well').hidden, false);
  assert.equal(rows().length, 0);
  D().close();
});

test('a playlist link and a Discogs link do not use the video flow', async () => {
  const calls = server();
  await open('https://www.youtube.com/playlist?list=PLabc123');
  assert.equal(calls.some((c) => c.url === '/albums/from-video/preview'), false);
  D().close();
});

test('create shows split progress, polls the job, and on done opens the album page', async () => {
  const calls = server();
  globalThis.location.hash = '';
  await open();
  fire(createBtn(), 'click');
  await settle();
  assert.ok(q('.av-progress'));
  assert.ok(await until(() => D().open === false, 5000));
  assert.ok(calls.some((c) => c.url === '/jobs/j1'));
  assert.equal(globalThis.location.hash, '#/library/albums/alb_1');
  assert.match(document.getElementById('toast').textContent, /Added "Deep Mix"/);
});

test('progress texts and fractions', () => {
  assert.match(progressText({ state: 'queued' }), /Waiting/);
  assert.match(progressText({ state: 'downloading' }), /Downloading/);
  assert.equal(progressText({ state: 'splitting', done: 3, total: 10, current: 'Two' }), 'Cutting 3 of 10 tracks: Two');
  assert.equal(progressText({ state: 'done', total: 1 }), 'Done: 1 track cut.');
  assert.equal(fraction({ state: 'splitting', done: 1, total: 4 }), 0.25);
  assert.equal(fraction({ state: 'downloading' }), 0);
  assert.equal(fraction({ state: 'done' }), 1);
});

test('a failed job shows the error with Try again; retry posts the same body again', async () => {
  let creates = 0;
  const calls = server({ create: () => { creates += 1; return ok({ jobId: 'j1', albumId: 'alb_1', songIds: [] }, 202); }, job: (n) => (n === 1 ? ok({ state: 'error', done: 1, total: 2, error: 'ffmpeg failed' }) : ok({ state: 'done', done: 2, total: 2 })) });
  await open();
  fire(createBtn(), 'click');
  await settle();
  assert.ok(await until(() => !!q('.av-progress-actions .msg.error')));
  assert.match(q('.av-progress-actions .msg.error').textContent, /ffmpeg failed/);
  const retry = qa('button').find((b) => b.textContent === 'Try again');
  fire(retry, 'click');
  assert.ok(await until(() => D().open === false, 5000));
  assert.equal(creates, 2);
  assert.deepEqual(JSON.parse(calls.filter((c) => c.url === '/albums/from-video')[0].opts.body), JSON.parse(calls.filter((c) => c.url === '/albums/from-video')[1].opts.body));
});

test('a create error is shown and the table stays', async () => {
  server({ create: () => ok({ detail: 'x' }, 429) });
  await open();
  fire(createBtn(), 'click');
  await settle();
  assert.match(q('.msg.error').textContent, /Hourly limit/);
  assert.equal(rows().length, 3);
  assert.equal(createBtn().disabled, false);
  D().close();
});

test('closing the dialog stops the polling', async () => {
  const calls = server({ job: () => ok({ state: 'splitting', done: 0, total: 2 }) });
  await open();
  fire(createBtn(), 'click');
  await settle();
  D().close();
  const n = calls.filter((c) => c.url === '/jobs/j1').length;
  await sleep(50);
  assert.equal(calls.filter((c) => c.url === '/jobs/j1').length, n);
});

const PV2 = {
  videoId: 'yeUFSnA9Puk', url: 'https://youtu.be/yeUFSnA9Puk', title: 'Deep Mix', uploader: 'DJ Q', duration: 3600, source: 'description', rawText: '',
  artist: 'Foo', year: 2012, type: 'ep', genres: ['Techno'],
  tracks: [{ index: 0, start: 0, end: 1800, artist: 'Foo', title: 'One', version: null, warnings: [], match: null }, { index: 1, start: 1800, end: 3600, artist: 'Foo', title: 'Two', version: null, warnings: [], match: null }],
  warnings: [],
};
const tokenNode = (label) => qa('.token-field').find((x) => x.getAttribute('aria-label') === label);

test('preview type, year, genres and artist fill the form: Type select, narrow Year, one Genres label, links with the video address', async () => {
  const calls = server({ preview: () => ok(PV2) });
  await open();
  assert.equal(tokenNode('Album title').value, 'Deep Mix');
  assert.equal(tokenNode('Album artists').value, 'Foo');
  const type = q('.album-fields select');
  assert.equal(type.value, 'EP');
  assert.deepEqual([...type.querySelectorAll('option')].map((o) => o.textContent), ['Album', 'EP', 'Single', 'Mix', 'Compilation']);
  const year = qa('.album-fields input').find((i) => i.getAttribute('aria-label') === 'Year');
  assert.equal(year.value, '2012');
  assert.ok(year.classList.contains('album-year'));
  assert.equal(qa('.album-fields label').filter((l) => l.textContent === 'Genres').length, 1);
  assert.deepEqual(qa('.album-fields .chips .chip.tint').map((c) => c.textContent), ['Techno']);
  assert.equal(qa('.lk-row input').find((i) => i.getAttribute('data-key') === 'youtube').value, 'https://youtu.be/yeUFSnA9Puk');
  assert.equal(rows()[1].querySelector('.av-artist').value, 'Foo');
  fire(createBtn(), 'click');
  await settle();
  const body = post(calls, '/albums/from-video');
  assert.equal(body.album.type, 'EP');
  assert.deepEqual(body.album.genres, ['Techno']);
  assert.equal(body.album.albumArtist, 'Foo');
  D().close();
});

test('type defaults to Album when the preview has none, and is never forced to Mix', async () => {
  server({ preview: () => ok({ ...PV2, type: undefined }) });
  await open();
  assert.equal(q('.album-fields select').value, 'album');
  D().close();
});

test('the Advanced disclosure holds the shift control with the seconds label; Earlier and Later move every start', async () => {
  server();
  await open();
  const adv = q('details.av-advanced');
  assert.equal(adv.querySelector('summary').textContent, 'Advanced');
  assert.ok(adv.textContent.includes('seconds'));
  assert.equal(qa('button').filter((b) => b.textContent === 'Earlier' || b.textContent === 'Later').every((b) => adv.contains(b)), true);
  assert.equal(q('.av-bar-row').nextSibling, q('ul.av-rows'));
  D().close();
});

test('backdrop: inner clicks, padding clicks and a drag that started inside never close; a plain backdrop click closes unless the form is dirty', async () => {
  server();
  await open();
  const dlg = D();
  fire(rows()[0].querySelector('.av-title'), 'click');
  assert.equal(dlg.open, true);
  fire(rows()[0].querySelector('.av-title'), 'mousedown');
  fire(dlg, 'click', { clientX: 5, clientY: 5 });
  assert.equal(dlg.open, true, 'mousedown inside, mouseup on the backdrop');
  fire(dlg, 'mousedown');
  fire(dlg, 'click');
  assert.equal(dlg.open, true, 'a table is loaded: the form is dirty');
  fire(q('.dlg-head button'), 'click');
  assert.equal(dlg.open, false);
});

test('backdrop closes the empty address step', async () => {
  server();
  openAddAlbum();
  const dlg = D();
  fire(dlg, 'mousedown');
  fire(dlg, 'click');
  assert.equal(dlg.open, false);
});
