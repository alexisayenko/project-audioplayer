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
const { store } = await import('./store.js');
const { mountAlbums, openAddAlbum, youtubeErrorText } = await import('./albums.js');
const yt = await import('./albums-youtube.js');
const { autodl } = await import('./autodl.js');

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLabc123';
const PREVIEW = { title: 'Tumult', artist: 'Derango', year: 2004, source: 'discogs:545650', tracks: [{ no: 1, title: 'Intro', durationS: 65 }, { no: 2, title: 'Noise', durationS: 200 }], genres: [] };
const CAND = { url: 'https://www.discogs.com/release/545650-Derango-Tumult', discogsId: 545650, title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 2, score: 0.9 };
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

function startPayload(ids, extra = {}) {
  return { playlist: { title: 'Derango - Tumult', uploader: 'x', count: ids.length }, guess: { artist: 'Derango', album: 'Tumult' }, songs: ids.map((id, i) => ({ songId: id, title: `T${i}`, durationS: 60 + i, position: i + 1 })), skipped: [], ...extra };
}

function server({ ids, audio = () => ok({ status: 'done' }), search = () => ok({ candidates: [CAND] }), start = null, created = () => ok({ id: 'alb_9', title: 'Tumult', linked: 2, unlinked: 1 }, 201) }) {
  const have = new Set();
  const calls = stubFetch((u, o) => {
    if (u === '/albums/youtube/start') return start ? start() : ok(startPayload(ids));
    if (u === '/albums/discogs-search') return search(o);
    if (u === '/albums/preview') return ok(PREVIEW);
    if (u === '/albums' && o.method === 'POST') return created(o);
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

async function popup(address) {
  openAddAlbum();
  q('.well input').value = address;
  fire(q('.well'), 'submit');
  for (let i = 0; i < 6; i++) await flush();
}

test('URL detection: Discogs keeps the preview flow, a playlist starts the import, Mix and private lists are refused', async () => {
  const d = server({ ids: ['d1'] });
  await popup('https://www.discogs.com/release/545650-Derango-Tumult');
  assert.ok(d.calls.some((c) => c.url === '/albums/preview'));
  assert.equal(d.calls.some((c) => c.url === '/albums/youtube/start'), false);
  D().close();

  for (const bad of ['https://www.youtube.com/playlist?list=RDabc123', 'https://www.youtube.com/playlist?list=WL']) {
    const e = server({ ids: [] });
    await popup(bad);
    assert.ok(q('.msg.error'));
    assert.equal(e.calls.length, 0);
    D().close();
  }
});

test('popup title, placeholder and subtitle', async () => {
  server({ ids: [] });
  openAddAlbum();
  assert.equal(D().querySelector('h2').textContent, 'Add album');
  assert.equal(q('.well input').getAttribute('placeholder'), 'Discogs release or YouTube playlist address');
  assert.match(D().textContent, /YouTube playlist/);
  D().close();
});

test('YouTube start runs the downloads and the Discogs search together; candidates are listed', async () => {
  const d = server({ ids: ['y1', 'y2'] });
  await popup(`${PLAYLIST}&index=2`);
  const startCall = d.calls.find((c) => c.url === '/albums/youtube/start');
  assert.deepEqual(JSON.parse(startCall.opts.body), { url: PLAYLIST });
  const search = d.calls.find((c) => c.url === '/albums/discogs-search');
  assert.deepEqual(JSON.parse(search.opts.body), { artist: 'Derango', album: 'Tumult', trackCount: 2, durationsS: [60, 61] });
  assert.equal(q('.album-search input').value, 'Derango');
  assert.match(q('.album-yt').textContent, /2 songs were added to your library/);
  assert.match(q('.album-yt').textContent, /Closing this window keeps them/);
  const cand = q('.album-cand');
  assert.equal(cand.textContent, 'Derango - Tumult · 2004 · 2 tracks');
  assert.equal(await until(() => d.calls.filter((c) => /\/audio$/.test(c.url)).length === 2), true);
  assert.deepEqual(d.calls.filter((c) => /\/audio$/.test(c.url)).map((c) => c.url), ['/songs/y1/audio', '/songs/y2/audio']);
  assert.equal(await until(() => /Downloaded 2 songs/.test(toastText())), true);
  D().close();
});

test('picking a candidate shows the preview; Create sends songIds and reports linked and unmatched', async () => {
  const d = server({ ids: ['p1', 'p2', 'p3'] });
  await popup(PLAYLIST);
  fire(q('.album-cand'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  assert.match(q('.album-preview').textContent, /Derango - Tumult · 2004/);
  assert.ok(q('.album-preview .album-rym input'));
  fire(qa('button').find((b) => b.textContent.includes('Create')), 'click');
  for (let i = 0; i < 6; i++) await flush();
  const post = d.calls.find((c) => c.url === '/albums' && c.opts.method === 'POST');
  assert.deepEqual(JSON.parse(post.opts.body).songIds, ['p1', 'p2', 'p3']);
  assert.equal(JSON.parse(post.opts.body).title, 'Tumult');
  assert.equal(D().open, false);
  assert.equal(toastText(), 'Album created, 2 songs linked, 1 not matched');
  await until(() => autodl.view('p3').kind === 'none' && /Downloaded/.test(toastText()), 4000);
});

test('Back from a picked preview returns to the candidate list', async () => {
  server({ ids: ['b1'] });
  await popup(PLAYLIST);
  fire(q('.album-cand'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  fire(qa('button').find((b) => b.textContent === 'Back'), 'click');
  for (let i = 0; i < 5; i++) await flush();
  assert.ok(q('.album-cand'));
  D().close();
});

test('search again sends the edited artist and album', async () => {
  const d = server({ ids: ['s1'] });
  await popup(PLAYLIST);
  q('.album-search input').value = 'Someone Else';
  fire(q('.album-search'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const searches = d.calls.filter((c) => c.url === '/albums/discogs-search');
  assert.equal(searches.length, 2);
  assert.equal(JSON.parse(searches[1].opts.body).artist, 'Someone Else');
  D().close();
});

test('no candidates and 503 say so and offer to paste a Discogs link', async () => {
  server({ ids: ['n1'], search: () => ok({ candidates: [] }) });
  await popup(PLAYLIST);
  assert.match(q('.album-cands').textContent, /No matching releases found/);
  assert.equal(q('.well').hidden, true);
  fire(qa('button').find((b) => b.textContent === 'Paste a Discogs link'), 'click');
  assert.equal(q('.well').hidden, false);
  D().close();

  server({ ids: ['n2'], search: () => ({ status: 503, body: { error: 'discogs_unavailable' } }) });
  await popup(PLAYLIST);
  assert.match(q('.album-cands').textContent, /Discogs is not available/);
  D().close();
});

test('pasting a Discogs link after a playlist import still sends songIds', async () => {
  const d = server({ ids: ['k1', 'k2'], search: () => ok({ candidates: [] }) });
  await popup(PLAYLIST);
  fire(qa('button').find((b) => b.textContent === 'Paste a Discogs link'), 'click');
  q('.well input').value = 'https://www.discogs.com/release/545650-Derango-Tumult';
  fire(q('.well'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  fire(qa('button').find((b) => b.textContent.includes('Create')), 'click');
  for (let i = 0; i < 6; i++) await flush();
  const post = d.calls.find((c) => c.url === '/albums' && c.opts.method === 'POST');
  assert.deepEqual(JSON.parse(post.opts.body).songIds, ['k1', 'k2']);
});

test('start errors: 400, 404, 409 library_full_songs and 502', async () => {
  const cases = [[400, 'bad_url', /not a valid YouTube playlist/], [404, 'not_found', /no playlist/], [409, 'library_full_songs', /library is full/], [502, 'youtube_failed', /could not be read/]];
  for (const [status, error, re] of cases) {
    server({ ids: [], start: () => ({ status, body: { error, detail: error } }) });
    await popup(PLAYLIST);
    assert.match(q('.msg.error').textContent, re);
    assert.equal(q('.album-yt'), null);
    D().close();
  }
  assert.match(youtubeErrorText({ status: 418, message: 'x' }), /x/);
});

test('closing the popup keeps the downloads running', async () => {
  const d = server({ ids: ['c1', 'c2'] });
  await popup(PLAYLIST);
  D().close();
  assert.equal(await until(() => d.calls.filter((c) => /\/audio$/.test(c.url)).length === 2), true);
  assert.equal(await until(() => yt.jobState() === null), true);
});

test('hourly_limit pauses with a visible state and resumes when allowed', async () => {
  let limited = true;
  const d = server({ ids: ['h1', 'h2'], audio: () => (limited ? { status: 429, body: { error: 'hourly_limit', retry_after_minutes: 1 } } : ok({ status: 'done' })) });
  const pane = document.createElement('div');
  document.body.append(pane);
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  await popup(PLAYLIST);
  D().close();
  assert.equal(await until(() => yt.jobState()?.paused > 0), true);
  const line = pane.querySelector('.album-dl-status');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /Paused: hourly limit, resumes in 1 minute/);
  assert.match(toastText(), /Paused: hourly limit/);
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
  assert.equal(d.calls.filter((c) => /\/audio$/.test(c.url)).length >= 3, true);
  assert.match(toastText(), /Downloaded 2 songs/);
  assert.equal(pane.querySelector('.album-dl-status').hidden, true);
  unmount();
});

test('songs that already have audio are skipped', async () => {
  const d = server({ ids: ['e1'] });
  d.have.add('e1');
  const n = await yt.startDownloads(['e1']);
  assert.equal(n, 0);
  assert.equal(d.calls.some((c) => c.url === '/songs/e1/audio'), false);
});
