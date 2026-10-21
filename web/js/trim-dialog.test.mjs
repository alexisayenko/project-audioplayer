import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { openAdd } = await import('./add.js');
const { editDialog } = await import('./edit-dialog.js');

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const PREVIEW = { id: 'dQw4w9WgXcQ', title: 'Rick - Never Gonna', title_raw: 'Rick - Never Gonna', artist: 'Rick', source: 'youtube', source_url: YT, thumbnail: 'https://i/t.jpg', duration: 212, tags: [], in_library: false };
const STAGES = [{ id: 'link', label: 'Reading the link' }];
const lines = (...evs) => `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`;
const addDlg = () => document.getElementById('add-dialog');
const editDlg = () => document.getElementById('edit-dialog');
const route = (body) => (url, o) => {
  if (url === '/preview/stream') return { body: lines({ event: 'stages', stages: STAGES }, { event: 'result', data: body }) };
  if (url === '/library') return { body: { songs: [] } };
  if (url === '/songs' && o.method === 'POST') return { body: { id: 'dQw4w9WgXcQ', song: { id: 'dQw4w9WgXcQ', title: 'x', tags: [] } } };
  return { body: {} };
};
const fetchPreview = async () => {
  store.loaded = true;
  store.songs = [];
  openAdd();
  const url = addDlg().querySelector('input');
  url.value = YT;
  addDlg().querySelector('form.well').dispatchEvent(makeEvent('submit'));
  await flush();
};
const type = (inp, v) => { inp.value = v; inp.dispatchEvent(makeEvent('input')); };
const inputs = (dlg) => ({ start: dlg.querySelector('.trim-block input'), end: dlg.querySelectorAll('.trim-block input')[1] });
const saveForm = () => addDlg().querySelector('form.add-card');
const reBtn = () => [...editDlg().querySelectorAll('button')].find((b) => b.textContent === 'Re-download with this cut');

test('Add: Advanced is collapsed by default and holds the hint', async () => {
  stubFetch(route(PREVIEW));
  await fetchPreview();
  const d = addDlg().querySelector('details.trim-block');
  assert.ok(d);
  assert.ok(!d.open);
  assert.equal(d.querySelector('summary').textContent, 'Advanced');
  assert.match(d.textContent, /Cut only this part of the source\. Leave empty to keep everything\./);
  addDlg().close();
});

test('Add: no trim in the payload when nothing is set', async () => {
  const calls = stubFetch(route(PREVIEW));
  await fetchPreview();
  saveForm().dispatchEvent(makeEvent('submit'));
  await flush();
  const post = calls.find((c) => c.url === '/songs');
  assert.equal('trim' in JSON.parse(post.opts.body), false);
});

test('Add: trim carries only the set values and the length shows', async () => {
  const calls = stubFetch(route(PREVIEW));
  await fetchPreview();
  const { start, end } = inputs(addDlg());
  type(start, '0:30');
  assert.match(addDlg().querySelector('.trim-block').textContent, /Length: 3:02/);
  assert.equal(addDlg().querySelector('summary').textContent, 'Advanced · cut from 0:30');
  type(end, '3:30');
  saveForm().dispatchEvent(makeEvent('submit'));
  await flush();
  const post = calls.find((c) => c.url === '/songs');
  assert.deepEqual(JSON.parse(post.opts.body).trim, { start: 30, end: 210 });
});

test('Add: validation messages and a blocked save', async () => {
  const calls = stubFetch(route(PREVIEW));
  await fetchPreview();
  const { start, end } = inputs(addDlg());
  type(start, '2:00');
  type(end, '1:00');
  assert.equal(addDlg().querySelector('.trim-block .msg').textContent, 'Start must be before End.');
  type(start, '0:10');
  type(end, '9:00');
  assert.equal(addDlg().querySelector('.trim-block .msg').textContent, 'End is after the end of the track.');
  saveForm().dispatchEvent(makeEvent('submit'));
  await flush();
  assert.equal(calls.filter((c) => c.url === '/songs').length, 0);
});

test('Add: trim_start_hint pre-fills Start and marks the summary, still collapsed', async () => {
  stubFetch(route({ ...PREVIEW, trim_start_hint: 85 }));
  await fetchPreview();
  const { start } = inputs(addDlg());
  assert.equal(start.value, '1:25');
  assert.equal(addDlg().querySelector('summary').textContent, 'Advanced · cut from 1:25');
  assert.ok(!addDlg().querySelector('details').open);
});

const song = { id: 's1', title: 'Song', artist: 'Band', tags: [], file: 'a.mp3', sources: [{ url: 'https://y/1', trim_start: 85, trim_end: 190, duration: 300 }] };

test('Edit: shows the stored cut and, with audio, the re-download note and button after a change', async () => {
  stubFetch(() => ({ body: {} }));
  editDialog(song);
  const { start, end } = inputs(editDlg());
  assert.equal(start.value, '1:25');
  assert.equal(end.value, '3:10');
  const note = editDlg().querySelector('.trim-note');
  assert.equal(note.hidden, true);
  type(start, '1:00');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Changing the cut needs a new download.');
  assert.equal(reBtn().hidden, false);
});

test('Edit: re-download 404 shows the not-available message', async () => {
  stubFetch((url) => (url.endsWith('/redownload') ? { status: 404, body: { detail: 'Not Found' } } : { body: {} }));
  editDialog(song);
  type(inputs(editDlg()).start, '1:00');
  reBtn().click();
  await flush();
  assert.match(editDlg().textContent, /Re-download is not available yet\./);
});

test('Edit: PATCH carries trim only when changed; cleared fields send null', async () => {
  let calls = stubFetch(() => ({ body: { songs: [] } }));
  editDialog(song);
  editDlg().querySelector('form').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.equal('trim' in JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body), false);
  calls = stubFetch(() => ({ body: { songs: [] } }));
  editDialog(song);
  const { start, end } = inputs(editDlg());
  type(start, '');
  type(end, '');
  editDlg().querySelector('form').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.equal(JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body).trim, null);
});
