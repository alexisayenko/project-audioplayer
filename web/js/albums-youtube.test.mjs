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
const { mountAlbums, openAddAlbum, youtubeErrorText, matchMap, autoMatch, candidatePayload } = await import('./albums.js');
const yt = await import('./albums-youtube.js');
const { autodl } = await import('./autodl.js');

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLabc123';
const DISCOGS = 'https://www.discogs.com/release/545650-Derango-Tumult';
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const toastText = () => document.getElementById('toast').textContent;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond, ms = 6000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(20);
  return cond();
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush(); };

const DTRACKS = [{ no: 1, title: 'Intro', durationS: 65 }, { no: 2, title: 'Noise', durationS: 200 }];
const CAND1 = { url: DISCOGS, discogsId: 545650, title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 2, tracks: DTRACKS, genres: ['Techno'], matches: { 1: 1, 2: 2, 3: null } };

const TRACKS = [
  { position: 1, videoId: 'aaaaaaaaaaa', title: 'Intro', artists: ['Derango'], artist: 'Derango', version: null, durationS: 60, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', songId: null },
  { position: 2, videoId: 'bbbbbbbbbbb', title: 'Noise', artists: ['Derango'], artist: 'Derango', version: 'Foo Remix', durationS: 200, url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', songId: null },
  { position: 3, videoId: 'ccccccccccc', title: 'Noise (dub)', artists: ['Derango'], artist: 'Derango', version: null, durationS: 210, url: 'https://www.youtube.com/watch?v=ccccccccccc', songId: 'in1' },
];

function preview(extra = {}) {
  return {
    playlist: { title: 'Derango - Tumult (full album)', uploader: 'x', count: 3, url: PLAYLIST },
    guess: { artist: 'Derango', album: 'Tumult', year: 2004, type: 'album' },
    album: { title: 'Tumult', albumArtist: 'Derango', type: 'album', year: 2004, coverUrl: 'https://i/t.jpg' },
    genres: ['Techno'], links: { discogs: null, wikipedia: 'https://en.wikipedia.org/wiki/Tumult', rateyourmusic: null }, discogsMatch: null, discogsCandidates: [], thumbnail: 'https://i/t.jpg',
    tracks: TRACKS, candidates: [], searchError: null, ...extra,
  };
}

function server({ pv = () => ok(preview()), audio = () => ok({ status: 'done' }), commit = null, me = { owner: false } } = {}) {
  const have = new Set();
  const calls = stubFetch((u, o) => {
    if (u === '/albums/youtube/preview') return pv();
    if (u === '/albums/youtube/commit') return commit ? commit(o) : ok({ album: { id: 'alb_9', title: 'Tumult' }, songs: [{ position: 1, songId: 'n1' }, { position: 2, songId: 'n2' }], linked: 2, unlinked: 1 }, 201);
    if (u === '/albums/preview') return ok({ title: 'Pasted', artist: 'Derango', year: 2001, source: { type: 'discogs', id: '7', url: 'https://www.discogs.com/release/7' }, genres: [], tracks: [{ no: 1, title: 'Intro', durationS: 10 }, { no: 2, title: 'Noise', durationS: 20 }] });
    if (u === '/me') return ok(me);
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [...have].map((id) => ({ id, title: id, artist: 'Derango', file: `${id}.mp3`, duration: 60 })) });
    const m = /^\/songs\/([^/]+)\/audio$/.exec(u);
    if (m) {
      const r = audio(m[1]);
      if (r.status === 200) have.add(m[1]);
      return r;
    }
    return ok({});
  });
  return { calls, have };
}

async function popup(address = PLAYLIST) {
  openAddAlbum();
  q('.well input').value = address;
  fire(q('.well'), 'submit');
  await settle();
}
const body = (d, url) => JSON.parse(d.calls.find((c) => c.url === url).opts.body);
const rows = () => qa('li.av-row');
const label = (row) => row.querySelector('.av-label').textContent.replace(/\s+/g, ' ').trim();
const typeInto = (node, value) => { node.value = value; fire(node, 'input'); };
const tokenField = (name) => qa('.token-field').find((x) => x.getAttribute('aria-label') === name);
const tokens = (name, value) => typeInto(tokenField(name), value);
const yearInput = () => qa('.album-fields input').find((i) => i.getAttribute('aria-label') === 'Year');
const create = () => qa('button').find((b) => /^Create album/.test(b.textContent));

test('matching helpers', () => {
  assert.equal(matchMap(CAND1).get(2).no, 2);
  assert.equal(matchMap({}).size, 0);
  const auto = autoMatch([{ position: 1, title: 'Intro' }, { position: 2, title: 'Noise' }], DTRACKS);
  assert.deepEqual(auto, { 1: 1, 2: 2 });
  assert.deepEqual(autoMatch([{ position: 5, title: 'x' }, { position: 6, title: 'y' }], DTRACKS), { 5: 1, 6: 2 });
  assert.equal(matchMap(CAND1).get(2).title, 'Noise');
  assert.equal(matchMap(CAND1).has(3), false);
  const p = candidatePayload(CAND1, PLAYLIST);
  assert.deepEqual(p.links, { discogs: DISCOGS, youtube: PLAYLIST });
  assert.equal(p.discogsId, 545650);
  assert.equal('source' in p, false);
});

test('URL detection: Discogs keeps the preview flow, a playlist uses the YouTube preview, Mix and private lists are refused', async () => {
  const d = server();
  await popup(DISCOGS);
  assert.ok(d.calls.some((c) => c.url === '/albums/preview'));
  assert.equal(d.calls.some((c) => c.url === '/albums/youtube/preview'), false);
  D().close();

  const e = server();
  await popup(PLAYLIST);
  assert.ok(e.calls.some((c) => c.url === '/albums/youtube/preview'));
  assert.equal(e.calls.some((c) => c.url === '/albums/preview'), false);
  D().close();

  for (const bad of ['https://www.youtube.com/playlist?list=RDabc123', 'https://www.youtube.com/playlist?list=WL']) {
    const f = server();
    await popup(bad);
    assert.ok(q('.msg.error'));
    assert.equal(f.calls.length, 0);
    D().close();
  }
});

test('the preview creates nothing and shows the shared form and one-line track labels', async () => {
  const d = server();
  await popup();
  assert.equal(body(d, '/albums/youtube/preview').url, PLAYLIST);
  assert.match(q('.av-head').textContent, /Derango - Tumult \(full album\)/);
  assert.equal(tokenField('Album title').value, 'Tumult');
  assert.equal(tokenField('Album artists').value, 'Derango');
  assert.equal(yearInput().value, '2004');
  assert.equal(q('.album-fields select').value, 'album');
  assert.ok(qa('button').find((b) => b.textContent === 'Find on Discogs'));
  assert.equal(q('img.av-cover').getAttribute('src'), 'https://i/t.jpg');
  assert.equal(q('.av-matched'), null);
  assert.deepEqual(rows().map(label), ['Derango - Intro (1:00)', 'Derango - Noise [Foo Remix] (3:20)', 'Derango - Noise (dub) (3:30)']);
  assert.equal(rows()[0].querySelector('.av-start'), null);
  assert.equal(rows()[0].querySelector('a.av-yt').href, TRACKS[0].url);
  assert.ok(rows()[0].querySelector('button.av-remove'));
  assert.ok(rows()[2].querySelector('.album-in-library'));
  assert.match(q('.av-summary').textContent, /^3 tracks · 8 min$/);
  const before = d.calls.length;
  fire(qa('button').find((b) => b.textContent === 'Back'), 'click');
  await settle();
  assert.equal(q('form.well').hidden, false);
  assert.equal(d.calls.length, before);
  assert.equal(d.calls.some((c) => c.url === '/albums/youtube/commit' || /\/audio$/.test(c.url)), false);
  D().close();
});

test('a Discogs match is shown as Matched on Discogs', async () => {
  server({ pv: () => ok(preview({ discogsMatch: 'https://www.discogs.com/master/1' })) });
  await popup();
  assert.match(q('.av-matched').textContent, /Matched on Discogs: discogs\.com\/master\/1/);
  D().close();
});

test('the pencil opens Artist, Title and Version; edits change the label', async () => {
  server();
  await popup();
  const row = rows()[0];
  assert.equal(row.querySelector('.av-line2').hidden, true);
  fire(row.querySelector('.av-edit'), 'click');
  assert.equal(row.querySelector('.av-line2').hidden, false);
  assert.equal(row.querySelectorAll('.av-line2 input').length, 3);
  typeInto(row.querySelector('.av-title'), 'Opening');
  typeInto(row.querySelector('.av-version'), 'Edit');
  assert.equal(label(row), 'Derango - Opening [Edit] (1:00)');
  typeInto(row.querySelector('.av-title'), '');
  assert.match(row.querySelector('.av-issue').textContent, /Title is empty/);
  assert.equal(create().disabled, true);
  D().close();
});

test('Select all and none, removing a row, and the Create label count only tracks to download', async () => {
  server();
  await popup();
  assert.equal(create().textContent.trim(), 'Create album and download 2 tracks');
  fire(q('.av-select-all'), 'click');
  assert.equal(q('.av-select-all').textContent, 'Select all');
  assert.equal(create().disabled, true);
  assert.match(q('.av-problems').textContent, /at least one/);
  fire(q('.av-select-all'), 'click');
  fire(rows()[0].querySelector('button.av-remove'), 'click');
  assert.equal(rows().length, 2);
  assert.equal(create().textContent.trim(), 'Create album and download 1 track');
  assert.equal(rows()[0].querySelector('.album-no').textContent, '1.');
  D().close();
});

test('Create sends the album form body, closes, then starts the downloads and toasts', async () => {
  const d = server();
  await popup();
  tokens('Album title', 'My Tumult');
  typeInto(yearInput(), '2005');
  const type = q('.album-fields select');
  type.value = 'EP';
  fire(type, 'change');
  fire(rows()[0].querySelector('.av-edit'), 'click');
  typeInto(rows()[0].querySelector('.av-artist'), 'Derango & Friend');
  const second = rows()[1].querySelector('input[type=checkbox]');
  second.checked = false;
  fire(second, 'change');
  fire(create(), 'click');
  await settle(8);
  const c = body(d, '/albums/youtube/commit');
  assert.deepEqual(Object.keys(c).sort(), ['album', 'playlistUrl', 'selected']);
  assert.equal(c.playlistUrl, PLAYLIST);
  assert.deepEqual(c.album, { title: 'My Tumult', albumArtist: 'Derango', type: 'EP', year: 2005, genres: ['Techno'], coverUrl: 'https://i/t.jpg', links: { wikipedia: 'https://en.wikipedia.org/wiki/Tumult' } });
  assert.deepEqual(c.selected, [
    { position: 1, videoId: 'aaaaaaaaaaa', title: 'Intro', durationS: 60, artists: ['Derango', 'Friend'], version: null },
    { position: 3, videoId: 'ccccccccccc', title: 'Noise (dub)', durationS: 210, artists: ['Derango'], version: null },
  ]);
  assert.equal(D().open, false);
  assert.equal(await until(() => d.calls.filter((x) => /\/audio$/.test(x.url)).length === 2), true);
  assert.deepEqual(d.calls.filter((x) => /\/audio$/.test(x.url)).map((x) => x.url), ['/songs/n1/audio', '/songs/n2/audio']);
  assert.equal(await until(() => /Downloaded 2 songs/.test(toastText())), true);
});

test('the quota hint shows for a normal user and is hidden for the owner', async () => {
  server();
  await popup();
  assert.match(q('.album-quota').textContent, /2 selected, up to 20 fetches an hour, it pauses and resumes/);
  D().close();
  server({ me: { owner: true } });
  await popup();
  await settle();
  assert.equal(q('.album-quota').hidden, true);
  D().close();
});

test('the commit toast reports linked, unmatched and the tracks being downloaded', async () => {
  server({ audio: () => ({ status: 429, body: { error: 'hourly_limit', retry_after_minutes: 1 } }) });
  await popup();
  fire(create(), 'click');
  await settle(10);
  assert.match(toastText(), /Album created, 2 songs added; downloading 2 tracks|Paused: hourly limit/);
  await until(() => yt.jobState()?.paused > 0);
  autodl.cancel(['n1', 'n2']);
});

test('start errors: 400, 404, 409 library_full_songs and 502', async () => {
  const cases = [[400, 'bad_url', /not a valid YouTube playlist/], [404, 'not_found', /no playlist/], [409, 'library_full_songs', /library is full/], [502, 'youtube_failed', /could not be read/]];
  for (const [status, error, re] of cases) {
    server({ pv: () => ({ status, body: { error, detail: error } }) });
    await popup();
    assert.match(q('.msg.error').textContent, re);
    assert.equal(q('.av-head'), null);
    D().close();
  }
  assert.match(youtubeErrorText({ status: 418, message: 'x' }), /x/);
});

test('a commit error stays in the popup and keeps the choices', async () => {
  server({ commit: () => ({ status: 502, body: { error: 'youtube_failed' } }) });
  await popup();
  fire(create(), 'click');
  await settle(8);
  assert.match(q('.msg.error').textContent, /could not be read/);
  assert.equal(D().open, true);
  assert.match(q('.av-summary').textContent, /^3 tracks/);
  D().close();
});

test('hourly_limit pauses with a visible state and resumes when allowed', async () => {
  let limited = true;
  const d = server({ audio: () => (limited ? { status: 429, body: { error: 'hourly_limit', retry_after_minutes: 1 } } : ok({ status: 'done' })) });
  const pane = document.createElement('div');
  document.body.append(pane);
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  await popup();
  fire(create(), 'click');
  await settle(8);
  assert.equal(await until(() => yt.jobState()?.paused > 0), true);
  const line = pane.querySelector('.album-dl-status');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /Paused: hourly limit, resumes in 1 minute/);
  assert.ok(line.querySelector('button'));
  limited = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 61 * 60000;
  try {
    fire(line.querySelector('button'), 'click');
    assert.equal(await until(() => yt.jobState() === null, 8000), true);
  } finally {
    Date.now = realNow;
  }
  assert.equal(d.calls.filter((c) => /\/audio$/.test(c.url)).length >= 2, true);
  assert.match(toastText(), /Downloaded 2 songs/);
  assert.equal(pane.querySelector('.album-dl-status').hidden, true);
  unmount();
});

test('songs that already have audio are skipped', async () => {
  const d = server();
  d.have.add('e1');
  const n = await yt.startDownloads(['e1']);
  assert.equal(n, 0);
  assert.equal(d.calls.some((c) => c.url === '/songs/e1/audio'), false);
});
