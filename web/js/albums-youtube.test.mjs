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
const { mountAlbums, openAddAlbum, youtubeErrorText } = await import('./albums.js');
const yt = await import('./albums-youtube.js');
const { autodl } = await import('./autodl.js');

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLabc123';
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
    if (u === '/albums/discogs/search') return ok({ candidates: [], searchError: null });
    if (u === '/albums/genres/suggest') return ok({ suggestions: [], wikipediaPage: null, searchError: null });
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

const type = (node, value) => { node.value = value; fire(node, 'input'); };
const next = async () => { fire(q('.wiz-next'), 'click'); await settle(); };
async function fetchOnly(address = PLAYLIST) {
  openAddAlbum();
  type(q('#wiz-url'), address);
  await next();
}
async function popup(address = PLAYLIST) {
  await fetchOnly(address);
  await next();
  await next();
  await settle();
}
const body = (d, url) => JSON.parse(d.calls.find((c) => c.url === url).opts.body);
const rows = () => qa('li.wiz-row');
const label = (row) => row.querySelector('.av-label').textContent.replace(/\s+/g, ' ').trim();
const create = () => q('.wiz-next');

test('a playlist row is a label with its length; the pencil opens Artist, Title and Version', async () => {
  server();
  await popup();
  assert.equal(rows().length, 3);
  assert.equal(label(rows()[0]), 'Derango - Intro');
  assert.equal(rows()[0].querySelector('.av-time').textContent, '1:00');
  assert.match(label(rows()[1]), /^Derango - Noise \[Foo Remix\]$/);
  assert.equal(rows()[1].querySelector('.av-time').textContent, '3:20');
  const kids = [...rows()[0].querySelector('.av-line1').children].map((c) => c.className.split(' ').find((n) => /^av-(label|edit|time)$/.test(n)));
  assert.deepEqual(kids.filter(Boolean), ['av-label', 'av-edit', 'av-time']);
  assert.ok(rows()[2].querySelector('.album-in-library'));
  assert.equal(rows()[0].querySelector('.av-line2').hidden, true);
  fire(rows()[0].querySelector('.av-edit'), 'click');
  assert.equal(rows()[0].querySelector('.av-line2').hidden, false);
  assert.equal(rows()[0].querySelectorAll('.av-line2 input').length, 3);
  type(rows()[0].querySelector('.av-title'), 'Intro 2');
  assert.match(label(rows()[0]), /Intro 2/);
  D().close();
});

test('Import sends the album form body, then starts the downloads and shows the result', async () => {
  const d = server();
  await popup();
  fire(rows()[0].querySelector('.av-edit'), 'click');
  type(rows()[0].querySelector('.av-artist'), 'Derango & Friend');
  const second = rows()[1].querySelector('input[type=checkbox]');
  second.checked = false;
  fire(second, 'change');
  const sel = q('.wiz-type select');
  sel.value = 'EP';
  fire(sel, 'change');
  assert.match(create().textContent, /^Import and download 1 track$/);
  await next();
  const c = body(d, '/albums/youtube/commit');
  assert.deepEqual(Object.keys(c).sort(), ['album', 'coverToSongs', 'playlistUrl', 'selected']);
  assert.equal(c.playlistUrl, PLAYLIST);
  assert.deepEqual(c.album, { title: 'Tumult', albumArtist: 'Derango', type: 'EP', year: 2004, genres: ['Techno'], coverUrl: 'https://i/t.jpg', links: { wikipedia: 'https://en.wikipedia.org/wiki/Tumult' } });
  assert.deepEqual(c.selected, [
    { position: 1, videoId: 'aaaaaaaaaaa', title: 'Intro', durationS: 60, artists: ['Derango', 'Friend'], version: null, trackNo: 1 },
    { position: 3, videoId: 'ccccccccccc', title: 'Noise (dub)', durationS: 210, artists: ['Derango'], version: null, trackNo: 2 },
  ]);
  assert.match(q('.wiz-run').textContent, /Album created, 2 songs added/);
  assert.equal(await until(() => d.calls.filter((x) => /\/audio$/.test(x.url)).length === 2), true);
  assert.deepEqual(d.calls.filter((x) => /\/audio$/.test(x.url)).map((x) => x.url), ['/songs/n1/audio', '/songs/n2/audio']);
  assert.equal(await until(() => /Downloaded 2 songs/.test(toastText())), true);
  D().close();
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

test('the result line reports the tracks being downloaded and the hourly pause', async () => {
  server({ audio: () => ({ status: 429, body: { error: 'hourly_limit', retry_after_minutes: 1 } }) });
  await popup();
  await next();
  await settle(10);
  assert.match(q('.wiz-run').textContent, /Album created, 2 songs added/);
  await until(() => yt.jobState()?.paused > 0);
  assert.match(q('.wiz-dl').textContent, /Paused: hourly limit/);
  autodl.cancel(['n1', 'n2']);
  D().close();
});

test('start errors: 400, 404, 409 library_full_songs and 502', async () => {
  const cases = [[400, 'bad_url', /not a valid YouTube playlist/], [404, 'not_found', /no playlist/], [409, 'library_full_songs', /library is full/], [502, 'youtube_failed', /could not be read/]];
  for (const [status, error, re] of cases) {
    server({ pv: () => ({ status, body: { error, detail: error } }) });
    await fetchOnly();
    assert.match(q('.wiz-msg').textContent, re);
    assert.match(q('.wiz-stepline').textContent, /Step 1/);
    D().close();
  }
  assert.match(youtubeErrorText({ status: 418, message: 'x' }), /x/);
});

test('a commit error stays on the review and keeps the choices', async () => {
  server({ commit: () => ({ status: 502, body: { error: 'youtube_failed' } }) });
  await popup();
  await next();
  assert.match(q('.wiz-msg').textContent, /could not be read/);
  assert.equal(D().open, true);
  assert.match(q('.wiz-stepline').textContent, /Review/);
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
  await next();
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
  D().close();
});

test('songs that already have audio are skipped', async () => {
  const d = server();
  d.have.add('e1');
  const n = await yt.startDownloads(['e1']);
  assert.equal(n, 0);
  assert.equal(d.calls.some((c) => c.url === '/songs/e1/audio'), false);
});
