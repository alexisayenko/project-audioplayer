import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { genreEditor } = await import('./album-genre-editor.js');
const { albumGenresToSongs, genresResult } = await import('./albums-genres.js');

const ok = (body, status = 200) => ({ status, body });
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush(); };
const SONGS = [{ id: 'aaaaaaaaaaa', title: 'One' }, { id: 'bbbbbbbbbbb', title: 'Two' }];
const ALBUM = {
  id: 'alb_1', title: 'Tumult', artist: 'Derango', genres: ['Rock', 'Breakbeat'],
  tracks: [{ no: 1, title: 'One', songId: 'aaaaaaaaaaa' }, { no: 2, title: 'Two', songId: 'bbbbbbbbbbb' }, { no: 3, title: 'Three', songId: null }],
};

function section(album, answers, songs = SONGS) {
  store.songs = songs;
  const calls = stubFetch((u, o) => {
    if (u === '/library') return ok({ songs });
    if (o.method === 'PATCH') return ok({ genres: JSON.parse(o.body).genres });
    if (u.endsWith('/genres/to-songs')) { const a = answers.shift(); return a.status ? a : ok(a); }
    return ok({});
  });
  const editor = genreEditor(album.genres);
  const sec = albumGenresToSongs({ ...album }, editor);
  document.body.append(sec.node);
  const btn = sec.node.querySelector('.album-genres-songs');
  const hint = sec.node.querySelector('.album-genres-songs-hint');
  const posts = () => calls.filter((c) => c.url.endsWith('/genres/to-songs')).map((c) => JSON.parse(c.opts.body));
  return { sec, editor, calls, btn, hint, posts, msg: () => [...sec.node.querySelectorAll('[role=status]')].map((n) => n.textContent).filter(Boolean).at(-1) };
}

test('genresResult words each outcome', () => {
  assert.equal(genresResult({ linked: 7, applied: 7, unchanged: 0, skipped: 0, failed: 0 }), 'Set genres on 7 songs');
  assert.equal(genresResult({ linked: 1, applied: 1, unchanged: 0, skipped: 0, failed: 0 }), 'Set genres on 1 song');
  assert.equal(genresResult({ linked: 2, applied: 0, unchanged: 2, skipped: 0, failed: 0 }), '2 songs already had these genres');
  assert.equal(genresResult({ linked: 9, applied: 7, unchanged: 2, skipped: 0, failed: 0 }), 'Set genres on 7 songs. 2 songs already had these genres');
  assert.match(genresResult({ linked: 3, applied: 1, unchanged: 0, skipped: 2, failed: 0 }), /^Set genres on 1 song\. 2 songs kept their own genres: click again to replace them/);
  assert.match(genresResult({ linked: 3, applied: 2, unchanged: 0, skipped: 0, failed: 1 }), /1 song failed/);
  assert.equal(genresResult({ linked: 0, applied: 0, unchanged: 0, skipped: 0, failed: 0 }), 'No linked songs');
});

test('the button is enabled with genres and linked songs and posts overwrite false, then reloads the library', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 2, unchanged: 0, skipped: 0, failed: 0 }]);
  assert.equal(s.btn.textContent, 'Use for songs');
  assert.equal(s.btn.title, 'Give these genres to all linked songs');
  assert.equal(s.btn.disabled, false);
  assert.equal(s.hint.hidden, true);
  fire(s.btn, 'click');
  await settle();
  assert.deepEqual(s.posts(), [{ overwrite: false }]);
  assert.ok(s.calls.some((c) => c.url === '/library'), 'the library is reloaded so the genre pills update');
  assert.equal(document.getElementById('toast').textContent, 'Set genres on 2 songs');
  assert.equal(s.msg(), 'Set genres on 2 songs');
  assert.equal(s.btn.disabled, false);
});

test('songs with other genres are kept first; the next click says Replace and sends overwrite true', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 1, unchanged: 0, skipped: 1, failed: 0 }, { linked: 2, applied: 1, unchanged: 0, skipped: 0, failed: 0 }]);
  fire(s.btn, 'click');
  await settle();
  assert.equal(s.btn.textContent, 'Replace genres on 1 song');
  assert.equal(s.btn.title, "Replace their genres with the album's genres");
  assert.match(s.msg(), /1 song kept their own genres/);
  fire(s.btn, 'click');
  await settle();
  assert.deepEqual(s.posts(), [{ overwrite: false }, { overwrite: true }]);
  assert.equal(s.btn.textContent, 'Use for songs');
  assert.equal(document.getElementById('toast').textContent, 'Set genres on 1 song');
});

test('new genres are saved on the album first, then given to the songs', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 2, unchanged: 0, skipped: 0, failed: 0 }]);
  s.editor.add(['Progressive Psytrance']);
  assert.equal(s.btn.disabled, false);
  fire(s.btn, 'click');
  await settle();
  const order = s.calls.filter((c) => c.url.includes('alb_1')).map((c) => `${c.opts.method} ${c.url}`);
  assert.deepEqual(order, ['PATCH /albums/alb_1', 'POST /albums/alb_1/genres/to-songs']);
  const patch = s.calls.find((c) => c.opts.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.opts.body), { genres: ['Rock', 'Breakbeat', 'Progressive Psytrance'] });
  assert.equal(s.msg(), 'Set genres on 2 songs');
});

test('editing the genre pills resets the replace step and keeps the button enabled', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 0, unchanged: 0, skipped: 2, failed: 0 }]);
  fire(s.btn, 'click');
  await settle();
  assert.equal(s.btn.textContent, 'Replace genres on 2 songs');
  s.editor.add(['House']);
  assert.equal(s.btn.textContent, 'Use for songs');
  assert.equal(s.btn.disabled, false);
});

test('disabled with a hint when the album has no genres or no linked song exists', () => {
  const none = section({ ...ALBUM, genres: [] }, []);
  assert.equal(none.btn.disabled, true);
  assert.equal(none.hint.textContent, 'Add genres to the album first');
  assert.equal(none.hint.hidden, false);
  const bare = section({ ...ALBUM, tracks: [{ no: 1, title: 'One', songId: null }] }, []);
  assert.equal(bare.btn.disabled, true);
  assert.equal(bare.hint.textContent, 'No linked songs');
  const gone = section(ALBUM, [], []);
  assert.equal(gone.btn.disabled, true, 'a link to a song that is not in the library does not count');
});

test('failures stay inline and keep the button usable', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 1, unchanged: 0, skipped: 0, failed: 1 }, { status: 409, body: { detail: 'no_genres' } }]);
  fire(s.btn, 'click');
  await settle();
  assert.match(s.msg(), /Set genres on 1 song\. 1 song failed/);
  assert.equal(s.btn.disabled, false);
  fire(s.btn, 'click');
  await settle();
  assert.equal(s.msg(), 'Add genres from the genre tree to the album first.');
  assert.equal(s.btn.disabled, false);
});
