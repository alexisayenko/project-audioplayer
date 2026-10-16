import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch, flush } from './test-dom.mjs';

installDom({ ids: ['edit-dialog', 'toast'] });
const { editDialog, removeSong, dialogHead } = await import('./edit-dialog.js');

const dlg = () => document.getElementById('edit-dialog');
const submit = (form) => form.dispatchEvent(makeEvent('submit'));
const song = { id: 's1', title: 'Song', artist: 'Band', tags: ['rock'], file: 'a.mp3', sources: [{ url: 'https://y/1' }] };

test('dialogHead renders title, optional subtitle and a working Cancel', () => {
  let n = 0;
  const h = dialogHead('Hello', 'sub', () => { n += 1; });
  assert.equal(h.querySelector('h2').textContent, 'Hello');
  assert.equal(h.querySelector('.muted').textContent, 'sub');
  h.querySelector('button').click();
  assert.equal(n, 1);
  assert.equal(dialogHead('x', null, () => {}).querySelector('.muted'), null);
});

test('editDialog opens modally with the song loaded; Save patches and refreshes', async () => {
  const calls = stubFetch((url, o) => (o.method === 'PATCH' ? { body: { ...song } } : { body: { songs: [song] } }));
  editDialog(song);
  assert.equal(dlg().open, true);
  const form = dlg().querySelector('form');
  assert.equal(form.querySelector('h2').textContent, 'Edit song');
  submit(form);
  await flush();
  const patch = calls.find((c) => c.opts.method === 'PATCH');
  assert.equal(patch.url, '/songs/s1');
  const body = JSON.parse(patch.opts.body);
  assert.equal(body.title, 'Song');
  assert.deepEqual(body.mainArtists, ['Band']);
  assert.ok(body.tags.includes('rock'));
  assert.equal(dlg().open, false);
  assert.equal(document.getElementById('toast').textContent, 'Saved');
  assert.ok(calls.some((c) => c.url === '/library'));
});

test('an empty title is refused client-side with no request', async () => {
  const calls = stubFetch(() => ({ body: {} }));
  editDialog({ ...song, title: '' });
  const form = dlg().querySelector('form');
  submit(form);
  await flush();
  assert.equal(calls.filter((c) => c.opts.method === 'PATCH').length, 0);
  const err = form.querySelectorAll('.msg.error').at(-1);
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Title is required');
  assert.equal(dlg().open, true);
});

test('a server error is shown in the dialog and the dialog stays open', async () => {
  stubFetch(() => ({ status: 422, body: { detail: 'year out of range' } }));
  editDialog(song);
  const form = dlg().querySelector('form');
  submit(form);
  await flush();
  assert.equal(form.querySelectorAll('.msg.error').at(-1).textContent, 'year out of range');
  assert.equal(dlg().open, true);
});

test('the Download button exists only for songs with audio', () => {
  stubFetch(() => ({ body: {} }));
  editDialog(song);
  assert.ok(dlg().querySelector('[aria-label=Download]'));
  editDialog({ ...song, file: null });
  assert.equal(dlg().querySelector('[aria-label=Download]'), null);
});

test('Cancel closes the dialog', () => {
  stubFetch(() => ({ body: {} }));
  editDialog(song);
  dlg().querySelector('.dlg-head button').click();
  assert.equal(dlg().open, false);
});

test('removeSong: Delete calls the API, closes, refreshes and toasts', async () => {
  const calls = stubFetch((u, o) => (o.method === 'DELETE' ? { status: 204 } : { body: { songs: [] } }));
  removeSong(song);
  assert.equal(dlg().open, true);
  assert.match(dlg().textContent, /"Song" will be removed/);
  const form = dlg().querySelector('form');
  submit(form);
  await flush();
  assert.ok(calls.some((c) => c.opts.method === 'DELETE' && c.url === '/songs/s1'));
  assert.equal(dlg().open, false);
  assert.equal(document.getElementById('toast').textContent, 'Deleted');
});

test('removeSong: 404 means already gone, so it quietly closes and refreshes', async () => {
  const calls = stubFetch((u, o) => (o.method === 'DELETE' ? { status: 404, body: { detail: 'nope' } } : { body: { songs: [] } }));
  removeSong(song);
  submit(dlg().querySelector('form'));
  await flush();
  assert.equal(dlg().open, false);
  assert.ok(calls.some((c) => c.url === '/library'));
});

test('removeSong: other failures keep the dialog open, show the error and re-enable Delete', async () => {
  stubFetch(() => ({ status: 500, body: { detail: 'disk error' } }));
  removeSong(song);
  const form = dlg().querySelector('form');
  submit(form);
  await flush();
  assert.equal(dlg().open, true);
  assert.equal(form.querySelectorAll('.msg.error').at(-1).textContent, 'disk error');
  assert.equal(form.querySelector('.btn.danger').disabled, false);
});

test('a song title with markup is rendered as text in the delete prompt', () => {
  removeSong({ id: 'x', title: '<b>bold</b>' });
  assert.equal(dlg().querySelectorAll('b').length, 0);
  assert.match(dlg().textContent, /<b>bold<\/b>/);
});
