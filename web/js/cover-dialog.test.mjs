import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch, flush } from './test-dom.mjs';

installDom({ ids: ['toast'] });
const { openCoverDialog, filePreviewError, hasOwnCover, canChangeCover } = await import('./cover-dialog.js');
const { store } = await import('./store.js');
const { setGuest, clearGuest } = await import('./guest.js');

const song = { id: 's1', title: 'Song', cover: true, cover_v: 'a1', cover_source: 'custom' };
const plain = { id: 's2', title: 'Plain' };
const btn = (dlg, label) => dlg.querySelectorAll('button').find((b) => b.textContent === label);
const stub = (extra = () => null) => stubFetch((url, o) => extra(url, o) || (url === '/library' ? { body: { songs: [{ ...song, cover_v: 'b2' }] } } : { body: {} }));
const open = (s = song) => openCoverDialog(s).dialog;

test('guests never get the dialog', () => {
  setGuest({});
  assert.equal(canChangeCover(), false);
  assert.equal(openCoverDialog(song), null);
  clearGuest();
  assert.equal(canChangeCover(), true);
});

test('hasOwnCover is true only for custom and default', () => {
  assert.equal(hasOwnCover({ cover_source: 'custom' }), true);
  assert.equal(hasOwnCover({ cover_source: 'default' }), true);
  assert.equal(hasOwnCover({}), false);
});

test('filePreviewError uses the choose wording and the size limit', () => {
  assert.equal(filePreviewError({ type: 'image/gif', size: 1 }), 'Choose a JPEG, PNG or WebP image.');
  assert.equal(filePreviewError({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), 'The image is larger than 5 MB.');
  assert.equal(filePreviewError({ type: 'image/webp', size: 10 }), '');
});

test('opens modally with four options, Save disabled and Remove visible for a custom cover', () => {
  stub();
  const dlg = open();
  assert.equal(dlg.open, true);
  const labels = dlg.querySelectorAll('.cover-options button').map((b) => b.textContent);
  assert.deepEqual(labels, ['From address', 'Upload', 'Wikipedia', 'Default image']);
  assert.equal(btn(dlg, 'Save').disabled, true);
  assert.equal(btn(dlg, 'Remove custom cover').hidden, false);
  dlg.close();
});

test('Remove custom cover is hidden for an automatic cover', () => {
  stub();
  const dlg = open({ ...plain, cover: true });
  assert.equal(btn(dlg, 'Remove custom cover').hidden, true);
  dlg.close();
});

test('From address previews, validates and saves a JSON url', async () => {
  const calls = stub();
  const dlg = open();
  const input = dlg.querySelector('input[type="url"]');
  input.value = 'not a url';
  input.dispatchEvent(makeEvent('input'));
  assert.equal(btn(dlg, 'Save').disabled, true);
  assert.match(dlg.querySelector('.msg.error').textContent, /http/);
  input.value = 'https://a.example/x.jpg';
  input.dispatchEvent(makeEvent('input'));
  assert.equal(dlg.querySelector('.cover-preview-img').getAttribute('src'), 'https://a.example/x.jpg');
  assert.equal(btn(dlg, 'Save').disabled, false);
  btn(dlg, 'Save').click();
  assert.equal(btn(dlg, 'Save').disabled, true);
  assert.match(dlg.textContent, /Saving\.\.\./);
  await flush();
  const put = calls.find((c) => c.opts.method === 'PUT');
  assert.equal(put.url, '/songs/s1/cover');
  assert.equal(put.opts.body, '{"url":"https://a.example/x.jpg"}');
  assert.ok(calls.some((c) => c.url === '/library'));
  assert.equal(dlg.open, false);
});

test('a preview that fails to load shows the soft note', () => {
  stub();
  const dlg = open();
  const input = dlg.querySelector('input[type="url"]');
  input.value = 'https://a.example/x.jpg';
  input.dispatchEvent(makeEvent('input'));
  dlg.querySelector('.cover-preview-img').dispatchEvent(makeEvent('error'));
  assert.match(dlg.textContent, /Cannot preview this address\. It may still work\./);
  assert.equal(btn(dlg, 'Save').disabled, false);
  dlg.close();
});

test('Upload rejects a wrong type, accepts a PNG and sends multipart', async () => {
  const calls = stub();
  const dlg = open();
  btn(dlg, 'Upload').click();
  const fileIn = dlg.querySelector('input[type="file"]');
  fileIn.files = [new File(['x'], 'a.gif', { type: 'image/gif' })];
  fileIn.dispatchEvent(makeEvent('change'));
  assert.match(dlg.querySelector('.msg.error').textContent, /Choose a JPEG, PNG or WebP image\./);
  assert.equal(btn(dlg, 'Save').disabled, true);
  fileIn.files = [new File(['x'], 'a.png', { type: 'image/png' })];
  fileIn.dispatchEvent(makeEvent('change'));
  assert.equal(dlg.querySelector('.msg.error').hidden, true);
  btn(dlg, 'Save').click();
  await flush();
  const put = calls.find((c) => c.opts.method === 'PUT');
  assert.ok(put.opts.body instanceof FormData);
  assert.equal(put.opts.headers['Content-Type'], undefined);
  assert.equal(dlg.open, false);
});

test('dropping a file on the dialog switches to Upload', () => {
  stub();
  const dlg = open();
  const ev = makeEvent('drop');
  ev.dataTransfer = { files: [new File(['x'], 'a.png', { type: 'image/png' })] };
  dlg.dispatchEvent(ev);
  assert.equal(btn(dlg, 'Upload').getAttribute('aria-pressed'), 'true');
  assert.equal(btn(dlg, 'Save').disabled, false);
  dlg.close();
});

test('Wikipedia loads lazily, lists at most four, shows the source and saves the picked url', async () => {
  const list = Array.from({ length: 6 }, (_, i) => ({ url: `https://w/${i}.jpg`, thumb: `https://w/t${i}.jpg`, title: `Album ${i}`, page: `https://en.wikipedia.org/wiki/A${i}` }));
  const calls = stub((url) => (url === '/songs/s1/cover/suggestions' ? { body: { suggestions: list } } : null));
  const dlg = open();
  assert.equal(calls.some((c) => c.url.endsWith('/suggestions')), false);
  btn(dlg, 'Wikipedia').click();
  assert.match(dlg.textContent, /Looking for covers\.\.\./);
  await flush();
  const picks = dlg.querySelectorAll('.cover-suggestion');
  assert.equal(picks.length, 4);
  picks[1].click();
  assert.equal(dlg.querySelector('.cover-preview-img').getAttribute('src'), 'https://w/t1.jpg');
  assert.equal(dlg.querySelector('.cover-wiki a').getAttribute('href'), 'https://en.wikipedia.org/wiki/A1');
  btn(dlg, 'Save').click();
  await flush();
  assert.equal(calls.find((c) => c.opts.method === 'PUT').opts.body, '{"url":"https://w/1.jpg"}');
});

test('Wikipedia with no suggestions says so', async () => {
  stub((url) => (url.endsWith('/suggestions') ? { body: { suggestions: [] } } : null));
  const dlg = open();
  btn(dlg, 'Wikipedia').click();
  await flush();
  assert.match(dlg.textContent, /No Wikipedia covers found for this song\./);
  assert.equal(btn(dlg, 'Save').disabled, true);
  dlg.close();
});

test('Default image previews the placeholder and saves {default:true}', async () => {
  const calls = stub();
  const dlg = open();
  btn(dlg, 'Default image').click();
  assert.match(dlg.textContent, /Use the neutral placeholder and keep it\./);
  assert.equal(dlg.querySelector('.cover-preview-img').getAttribute('src'), null);
  btn(dlg, 'Save').click();
  await flush();
  assert.equal(calls.find((c) => c.opts.method === 'PUT').opts.body, '{"default":true}');
});

test('a server error stays inline and keeps the dialog open', async () => {
  stub((url, o) => (o.method === 'PUT' ? { status: 415, body: { detail: 'That file is not an image.' } } : null));
  const dlg = open();
  btn(dlg, 'Default image').click();
  btn(dlg, 'Save').click();
  await flush();
  assert.equal(dlg.open, true);
  assert.match(dlg.querySelector('.msg.error').textContent, /not an image/);
  assert.equal(btn(dlg, 'Save').disabled, false);
  dlg.close();
});

test('Remove custom cover calls DELETE, refreshes the store and closes', async () => {
  const calls = stub();
  const dlg = open();
  btn(dlg, 'Remove custom cover').click();
  await flush();
  const del = calls.find((c) => c.opts.method === 'DELETE');
  assert.equal(del.url, '/songs/s1/cover');
  assert.equal(store.songs[0].cover_v, 'b2');
  assert.equal(dlg.open, false);
});
