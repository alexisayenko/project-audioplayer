import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { draftStore, mountDrafts } = await import('./drafts.js');

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const draft = (id, extra = {}) => ({
  id, text: '', url: '', source: null, title: `Song ${id}`, mainArtists: [`Artist ${id}`], featuredArtists: [], withArtists: [], version: null, year: null, duration: null,
  thumbnail: null, state: 'new', inLibrary: false, createdAt: '2026-10-18T10:00:00Z', ...extra,
});
const toast = () => document.getElementById('toast');
const dlg = () => document.getElementById('add-dialog');

function server(handlers = {}) {
  const state = { drafts: [], posts: [] };
  const calls = stubFetch(async (url, o) => {
    const method = o.method || 'GET';
    const key = `${method} ${url}`;
    if (handlers[key]) return handlers[key](o, state);
    if (key === 'GET /drafts') return { body: { drafts: state.drafts, counts: { total: state.drafts.length, unfetched: 0 }, limit: 500 } };
    if (key === 'POST /drafts') {
      const lines = JSON.parse(o.body).lines;
      state.posts.push(lines);
      const created = lines.map((l, i) => draft(`n${state.posts.length}_${i}`, { text: l }));
      state.drafts = [...created, ...state.drafts];
      return { body: { created, updated: [], counts: { lines: lines.length, created: lines.length, updated: 0, duplicates: 0, tooLong: 0, overCap: 0, unfetched: 0, rateLimited: false, total: state.drafts.length } } };
    }
    if (method === 'DELETE' && url === '/drafts') { state.drafts = []; return { status: 204 }; }
    if (method === 'DELETE' && url.startsWith('/drafts/')) { state.drafts = state.drafts.filter((d) => d.id !== url.slice(8)); return { status: 204 }; }
    if (url === '/library') return { body: { songs: [] } };
    return { body: {} };
  });
  return { calls, state };
}

async function mount(initial = [], handlers = {}) {
  draftStore.reset();
  const s = server(handlers);
  s.state.drafts = initial;
  const host = document.createElement('div');
  document.body.append(host);
  const unmount = mountDrafts(host);
  await flush();
  await flush();
  const q = (sel) => host.querySelector(sel);
  const qa = (sel) => host.querySelectorAll(sel);
  const rows = () => qa('li.draft');
  const button = (re, within = host) => within.querySelectorAll('button').find((b) => re.test(b.textContent));
  const paste = async (text, how = 'submit') => {
    q('textarea').value = text;
    if (how === 'submit') q('form.drafts-paste').dispatchEvent(makeEvent('submit'));
    else q('textarea').dispatchEvent(makeEvent('keydown', { key: 'Enter', [how]: true }));
    for (let i = 0; i < 5; i += 1) await flush();
  };
  return { host, q, qa, rows, button, paste, unmount, ...s };
}

test('an empty list shows the specified text, the paste box with its placeholder and no Clear button', async () => {
  const v = await mount([]);
  assert.equal(v.q('.drafts-empty').textContent, 'No drafts yet. Paste "Artist - Title" or links above to collect songs to add later.');
  assert.equal(v.q('textarea').placeholder, 'Paste "Artist - Title" or links, one per line');
  assert.ok(v.button(/^Add to drafts$/));
  assert.equal(v.button(/Clear all drafts/), undefined);
  assert.equal(v.rows().length, 0);
  v.unmount();
});

test('a loading failure shows the error with Retry', async () => {
  let fail = true;
  const v = await mount([], { 'GET /drafts': (o, st) => (fail ? { status: 500, body: { detail: 'boom' } } : { body: { drafts: [draft('a')], limit: 500 } }) });
  assert.match(v.q('.drafts-state').textContent, /boom/);
  fail = false;
  v.button(/^Retry$/).click();
  await flush();
  await flush();
  assert.equal(v.rows().length, 1);
  v.unmount();
});

test('Add to drafts sends the trimmed non-empty lines, shows the new rows first and clears the box', async () => {
  const v = await mount([draft('old')]);
  await v.paste('  Daft Punk - Around the World  \n\n' + `${YT} Foo - Bar\n   \njust a title`);
  assert.deepEqual(v.state.posts, [['Daft Punk - Around the World', `${YT} Foo - Bar`, 'just a title']]);
  assert.equal(v.q('textarea').value, '');
  assert.equal(v.rows().length, 4);
  assert.equal(v.rows().at(-1).getAttribute('data-id'), 'old');
  assert.match(v.q('.drafts-msg').textContent, /^Added 3 drafts\./);
  assert.equal(v.q('.drafts-bar').textContent.includes('4 drafts of 500'), true);
  assert.equal(draftStore.count, 4);
  v.unmount();
});

test('Ctrl+Enter and Cmd+Enter add too; an empty box says so and sends nothing', async () => {
  const v = await mount([]);
  await v.paste('A - B', 'ctrlKey');
  assert.equal(v.state.posts.length, 1);
  await v.paste('C - D', 'metaKey');
  assert.equal(v.state.posts.length, 2);
  await v.paste('   \n  ');
  assert.equal(v.state.posts.length, 2);
  assert.match(v.q('.drafts-msg').textContent, /Paste at least one line first/);
  v.unmount();
});

test('lines past 100 stay in the box, lines over 300 characters are skipped, both are reported', async () => {
  const v = await mount([]);
  const many = Array.from({ length: 105 }, (_, i) => `A - Song ${i}`);
  many[1] = 'x'.repeat(301);
  await v.paste(many.join('\n'));
  assert.equal(v.state.posts[0].length, 99);
  assert.equal(v.q('textarea').value.split('\n').length, 5);
  assert.match(v.q('.drafts-msg').textContent, /1 line skipped \(over 300 characters\)\. Only 100 lines are added at once: 5 left in the box\./);
  v.unmount();
});

test('a server refusal keeps the pasted text and shows the message', async () => {
  const v = await mount([], { 'POST /drafts': () => ({ status: 429, body: { error: 'draft_limit', detail: 'x', retry_after_minutes: 7 } }) });
  await v.paste('A - B');
  assert.equal(v.q('textarea').value, 'A - B');
  assert.match(v.q('.drafts-msg').textContent, /Draft lookup limit reached\. Try again in 7 minutes\./);
  assert.equal(v.rows().length, 0);
  assert.equal(v.button(/^Add to drafts$/).disabled, false);
  v.unmount();
});

test('the report names unfetched drafts when YouTube limits requests', async () => {
  const v = await mount([], { 'POST /drafts': (o) => {
    const lines = JSON.parse(o.body).lines;
    return { body: { created: lines.map((l, i) => draft(`n${i}`, { text: l })), updated: [], counts: { created: lines.length, unfetched: 2, rateLimited: true } } };
  } });
  await v.paste(`${YT}\nA - B`);
  assert.match(v.q('.drafts-msg').textContent, /2 not fetched yet \(YouTube is limiting requests\)/);
  v.unmount();
});

test('a row shows the title with its version span, artists, year, length, source link and status', async () => {
  const v = await mount([
    draft('a', { title: 'Song', mainArtists: ['Foo'], featuredArtists: ['Baz'], version: { type: 'remix', name: 'Qux Remix', artists: ['Qux'] }, year: 2019, duration: 215, url: YT, source: 'youtube', state: 'fetched', thumbnail: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }),
    draft('b', { title: '', url: 'https://example.org/page', source: 'link', mainArtists: [] }),
    draft('c', { inLibrary: true, source: 'soundcloud', url: 'https://soundcloud.com/a/b', state: 'new' }),
  ]);
  const [a, b, c] = v.rows();
  assert.equal(a.querySelector('.ttl').textContent, 'Song');
  assert.equal(a.querySelector('.rmx').textContent, '(Qux Remix)');
  assert.equal(a.querySelector('.sub').textContent, 'Foo feat. Baz · 2019 · 3:35');
  assert.equal(a.querySelector('.sub span').title, 'Upload year: a suggestion for the version year, not the release year');
  assert.equal(a.querySelector('img.cover').src, 'https://i.ytimg.com/vi/x/hqdefault.jpg');
  assert.equal(a.querySelector('a.src-youtube').href, YT);
  assert.equal(a.querySelector('.draft-mark').textContent, 'Fetched');
  assert.equal(b.querySelector('img.cover').src, '');
  assert.equal(b.querySelector('.draft-title').textContent, 'example.org/page');
  assert.match(b.textContent, /Kept as plain link text: only YouTube and SoundCloud links are looked up\./);
  assert.equal(b.querySelector('.draft-mark').textContent, 'Link only');
  assert.equal(c.querySelector('.draft-mark').textContent, 'In library');
  assert.equal(c.classList.contains('in-library'), true);
  v.unmount();
});

test('an unfetched YouTube draft says so and Refresh fetches it; fetched and text-only rows have no Refresh', async () => {
  const fresh = draft('a', { url: YT, source: 'youtube', state: 'new', title: '', mainArtists: [] });
  const v = await mount([fresh, draft('t', { text: 'A - B' }), draft('f', { url: YT, source: 'youtube', state: 'fetched' })], {
    'POST /drafts/a/refresh': () => ({ body: { draft: { ...fresh, title: 'Fresh', mainArtists: ['Band'], year: 2020, state: 'fetched' }, fetched: true, rateLimited: false, error: null } }),
  });
  const [a, t, f] = v.rows();
  assert.equal(a.querySelector('.draft-mark').textContent, 'Not fetched yet');
  assert.equal(v.button(/Refresh/, a).getAttribute('aria-label'), `Refresh: ${YT.replace('https://www.', '')}`);
  assert.equal(v.button(/Refresh/, t), undefined);
  assert.equal(v.button(/Refresh/, f), undefined);
  v.button(/Refresh/, a).click();
  assert.match(v.button(/Fetching/, v.rows()[0]).textContent, /Fetching/);
  await flush();
  await flush();
  const after = v.rows()[0];
  assert.equal(after.querySelector('.ttl').textContent, 'Fresh');
  assert.equal(after.querySelector('.draft-mark').textContent, 'Fetched');
  assert.equal(v.button(/Refresh/, after), undefined);
  v.unmount();
});

test('Refresh reports a rate limit or a failed lookup in a toast and keeps the row', async () => {
  const row = draft('a', { url: YT, source: 'youtube', state: 'new' });
  let answer = { draft: row, fetched: false, rateLimited: true, error: null };
  const v = await mount([row], { 'POST /drafts/a/refresh': () => ({ body: answer }) });
  v.button(/Refresh/).click();
  await flush();
  await flush();
  assert.equal(toast().textContent, 'YouTube is limiting requests. Try again later.');
  answer = { draft: { ...row, state: 'failed' }, fetched: false, rateLimited: false, error: 'Video unavailable' };
  v.button(/Refresh/).click();
  await flush();
  await flush();
  assert.equal(toast().textContent, 'Could not fetch: Video unavailable');
  assert.equal(v.rows()[0].querySelector('.draft-mark').textContent, 'Could not fetch');
  v.unmount();
});

test('Edit re-parses: the box holds the raw line, Save sends text and link, Cancel changes nothing', async () => {
  const row = draft('a', { text: 'Foo - Bar', url: YT, source: 'youtube', state: 'fetched' });
  const v = await mount([row], {
    'PATCH /drafts/a': (o) => {
      const body = JSON.parse(o.body);
      return { body: { ...row, text: body.text, url: body.url, title: 'Edited', mainArtists: ['Foo'] } };
    },
  });
  v.button(/^Edit$/).click();
  const input = v.q('.draft-edit-input');
  assert.equal(input.value, `Foo - Bar ${YT}`);
  assert.equal(document.activeElement, input);
  v.button(/^Cancel$/).click();
  assert.equal(v.qa('.draft-edit-input').length, 0);
  v.button(/^Edit$/).click();
  v.q('.draft-edit-input').value = 'New Artist - New Title https://youtu.be/dQw4w9WgXcQ?si=zz';
  v.q('.draft-edit-input').dispatchEvent(makeEvent('input'));
  v.q('form.draft-edit').dispatchEvent(makeEvent('submit'));
  await flush();
  await flush();
  const patch = v.calls.find((c) => c.url === '/drafts/a' && c.opts.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.opts.body), { text: 'New Artist - New Title', url: YT });
  assert.equal(v.qa('.draft-edit-input').length, 0);
  assert.equal(v.rows()[0].querySelector('.ttl').textContent, 'Edited');
  v.unmount();
});

test('Edit shows a server error inline and rejects an empty line without a request', async () => {
  const row = draft('a', { text: 'Foo - Bar' });
  const v = await mount([row], { 'PATCH /drafts/a': () => ({ status: 409, body: { detail: 'this link is already in your drafts' } }) });
  v.button(/^Edit$/).click();
  v.q('.draft-edit-input').value = '   ';
  v.q('.draft-edit-input').dispatchEvent(makeEvent('input'));
  v.q('form.draft-edit').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.match(v.q('.draft-edit .msg').textContent, /needs a text or a link/);
  assert.equal(v.calls.filter((c) => c.opts.method === 'PATCH').length, 0);
  v.q('.draft-edit-input').value = YT;
  v.q('.draft-edit-input').dispatchEvent(makeEvent('input'));
  v.q('form.draft-edit').dispatchEvent(makeEvent('submit'));
  await flush();
  await flush();
  assert.match(v.q('.draft-edit .msg').textContent, /already in your drafts/);
  v.unmount();
});

test('Delete hides the row at once with an Undo toast; Undo brings it back without any request', async () => {
  const v = await mount([draft('a'), draft('b')]);
  v.button(/^Delete$/, v.rows()[0]).click();
  assert.equal(v.rows().length, 1);
  assert.equal(draftStore.count, 1);
  assert.match(toast().textContent, /Draft deleted/);
  toast().querySelector('button').click();
  assert.equal(v.rows().length, 2);
  assert.equal(v.calls.filter((c) => c.opts.method === 'DELETE').length, 0);
  assert.equal(draftStore.timers.size, 0);
  v.unmount();
});

test('an unundone delete is sent when the undo window ends, on leaving the view, and a failure restores the row', async () => {
  const v = await mount([draft('a'), draft('b'), draft('c')], { 'DELETE /drafts/c': () => ({ status: 500, body: { detail: 'nope' } }) });
  v.button(/^Delete$/, v.rows()[0]).click();
  assert.equal(draftStore.timers.size, 1);
  await draftStore.commitDelete('a');
  assert.ok(v.calls.some((c) => c.url === '/drafts/a' && c.opts.method === 'DELETE'));
  assert.equal(v.rows().length, 2);
  v.button(/^Delete$/, v.rows()[0]).click();
  v.unmount();
  await flush();
  await flush();
  assert.ok(v.calls.some((c) => c.url === '/drafts/b' && c.opts.method === 'DELETE'), 'leaving the view sends the pending delete');
  draftStore.softDelete('c');
  await draftStore.flush();
  assert.equal(draftStore.items.some((d) => d.id === 'c'), true);
  assert.equal(draftStore.hidden.has('c'), false);
  assert.match(toast().textContent, /Could not delete the draft: nope/);
});

test('Clear all drafts asks first; Cancel keeps everything, Yes deletes the whole list', async () => {
  const v = await mount([draft('a'), draft('b')]);
  assert.match(v.q('.drafts-bar').textContent, /2 drafts of 500/);
  v.button(/^Clear all drafts$/).click();
  assert.match(v.q('.drafts-confirm').textContent, /Delete all 2 drafts\?/);
  v.button(/^Cancel$/).click();
  assert.equal(v.qa('.drafts-confirm').length, 0);
  assert.equal(v.rows().length, 2);
  v.button(/^Clear all drafts$/).click();
  v.button(/^Yes, clear$/).click();
  await flush();
  await flush();
  assert.ok(v.calls.some((c) => c.url === '/drafts' && c.opts.method === 'DELETE'));
  assert.equal(v.rows().length, 0);
  assert.equal(v.qa('.drafts-empty').length, 1);
  assert.equal(v.qa('.drafts-bar button').length, 0);
  v.unmount();
});

const PREVIEW = { id: 'dQw4w9WgXcQ', title: 'Rick - Never Gonna', title_raw: 'Rick - Never Gonna', artist: 'Rick', mainArtists: ['Rick'], featuredArtists: [], withArtists: [], source: 'youtube', source_url: YT, thumbnail: 'https://i/t.jpg', duration: 212, tags: [], in_library: false };
const STAGES = [{ id: 'link', label: 'Reading the link' }];
const stream = (body) => `${[{ event: 'stages', stages: STAGES }, { event: 'result', data: body }].map((e) => JSON.stringify(e)).join('\n')}\n`;
const addHandlers = (extra = {}) => ({
  'POST /preview/stream': () => ({ body: stream(PREVIEW) }),
  'POST /songs': () => ({ body: { id: 'dQw4w9WgXcQ', song: { id: 'dQw4w9WgXcQ', title: 'Rick - Never Gonna', tags: [] } } }),
  ...extra,
});

test('Add properly with a YouTube link opens the Add dialog and runs the preview as if the link was pasted', async () => {
  store.loaded = true;
  store.songs = [];
  const v = await mount([draft('a', { url: YT, source: 'youtube', text: 'Rick - Never Gonna' })], addHandlers());
  v.button(/Add properly/).click();
  assert.equal(dlg().open, true);
  assert.equal(dlg().querySelector('input').value, YT);
  assert.match(dlg().querySelector('.draft-note').textContent, /From your drafts: /);
  await flush();
  await flush();
  assert.ok(v.calls.some((c) => c.url === '/preview/stream'));
  assert.equal(dlg().querySelector('form.well').hidden, true);
  assert.ok(dlg().querySelector('form.add-card'));
  dlg().close();
  v.unmount();
});

test('saving from Add properly removes the draft; cancelling keeps it', async () => {
  store.loaded = true;
  store.songs = [];
  const v = await mount([draft('a', { url: YT, source: 'youtube' }), draft('b')], addHandlers());
  v.button(/Add properly/, v.rows()[0]).click();
  await flush();
  await flush();
  dlg().close();
  await flush();
  assert.equal(v.rows().length, 2, 'cancel keeps the draft');
  assert.equal(v.calls.filter((c) => c.opts.method === 'DELETE').length, 0);

  v.button(/Add properly/, v.rows()[0]).click();
  await flush();
  await flush();
  dlg().querySelector('form.add-card').dispatchEvent(makeEvent('submit'));
  await flush();
  await flush();
  await flush();
  assert.equal(toast().textContent, 'Saved to library');
  assert.ok(v.calls.some((c) => c.url === '/drafts/a' && c.opts.method === 'DELETE'));
  assert.deepEqual(v.rows().map((r) => r.getAttribute('data-id')), ['b']);
  v.unmount();
});

test('Add properly for a text-only draft opens the dialog with a note and no fetch; the form starts from the draft text', async () => {
  store.loaded = true;
  store.songs = [];
  const text = draft('t', { text: 'Mine - Own Title', title: 'Own Title', mainArtists: ['Mine'] });
  const v = await mount([text], addHandlers());
  v.button(/Add properly/).click();
  assert.equal(dlg().querySelector('input').value, '');
  assert.match(dlg().querySelector('.draft-note').textContent, /Paste its YouTube or SoundCloud link to continue\. Title and Artists start from your text\./);
  await flush();
  assert.equal(v.calls.filter((c) => c.url === '/preview/stream').length, 0);
  dlg().querySelector('input').value = YT;
  dlg().querySelector('input').dispatchEvent(makeEvent('input', { inputType: 'insertText', data: 'x' }));
  dlg().querySelector('form.well').dispatchEvent(makeEvent('submit'));
  await flush();
  await flush();
  assert.ok(dlg().querySelector('form.add-card'));
  dlg().querySelector('form.add-card').dispatchEvent(makeEvent('submit'));
  await flush();
  await flush();
  await flush();
  const post = JSON.parse(v.calls.find((c) => c.url === '/songs' && c.opts.method === 'POST').opts.body);
  assert.equal(post.metadata.title, 'Own Title');
  assert.deepEqual(post.metadata.mainArtists, ['Mine']);
  assert.ok(v.calls.some((c) => c.url === '/drafts/t' && c.opts.method === 'DELETE'));
  v.unmount();
});

test('signing out clears the loaded drafts', async () => {
  const v = await mount([draft('a')]);
  assert.equal(draftStore.count, 1);
  window.dispatch('auth-changed');
  assert.equal(draftStore.count, 0);
  assert.equal(draftStore.loaded, false);
  v.unmount();
});
