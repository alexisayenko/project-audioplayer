import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
const b = await import('./bulk.js');
const { LONG_SONG_SECONDS } = await import('./constants.js');
const { store } = await import('./store.js');
const { metadataCard } = await import('./backfill-card.js');
const { downloadAllCard, bulkDownload } = await import('./bulk-download.js');

test('metadata texts', () => {
  assert.equal(b.metaLead(0), 'Every downloaded song has its metadata.');
  assert.equal(b.metaLead(1), '1 downloaded song has no metadata yet');
  assert.equal(b.metaLead(12), '12 downloaded songs have no metadata yet');
  assert.equal(b.metaButton({ candidates: 0, state: 'idle' }), 'Nothing to do');
  assert.equal(b.metaButton({ candidates: 2, state: 'idle' }), 'Get metadata');
  const s = { state: 'running', total: 10, updated: 3, nothing: 2, failed: 1, skipped: 0 };
  assert.equal(b.metaStatus(s), 'Getting metadata... 6 of 10 (1 failed)');
  assert.equal(b.metaStatus({ ...s, state: 'done' }), 'Done: 3 updated, 2 nothing found, 1 failed.');
  assert.equal(b.metaNormalize(s).done, 5);
});

test('metadata card reads status and starts the job', async () => {
  let started = false;
  stubFetch((url, o) => {
    if (url !== '/me/backfill/metadata') return { status: 404, body: {} };
    if (o.method === 'POST') { started = true; return { status: 202, body: { state: 'running', candidates: 2, total: 2, updated: 0, nothing: 0, failed: 0, skipped: 0 } }; }
    return { body: { state: 'idle', candidates: 2, total: 0, updated: 0, nothing: 0, failed: 0, skipped: 0 } };
  });
  const card = metadataCard();
  document.body.append(card);
  await flush();
  assert.match(card.textContent, /2 downloaded songs have no metadata yet/);
  const [start] = card.querySelectorAll('button');
  assert.equal(start.textContent, 'Get metadata');
  fire(start, 'click');
  await flush();
  assert.ok(started);
  assert.match(card.textContent, /Getting metadata\.\.\. 0 of 2/);
  card.remove();
});

test('confirm text covers the hourly limit', () => {
  assert.doesNotMatch(b.confirmText(30, { max_adds: null }), /limit/);
  assert.match(b.confirmText(10, { max_adds: 20, adds_last_hour: 5 }), /15 left now/);
  assert.match(b.confirmText(45, { max_adds: 20, adds_last_hour: 5 }), /pause and resume by itself, about 2 hours/);
});

test('three failures in a row stop the run; a success resets the streak', () => {
  let r = b.newRun(['a', 'b', 'c', 'd'], 2);
  r = b.settle(r, 'a', 'failed', 'x');
  r = b.settle(r, 'b', 'done');
  r = b.settle(r, 'c', 'failed');
  assert.equal(b.streak(r), 1);
  r = b.settle(r, 'd', 'failed');
  assert.equal(b.streak(r), 2);
  assert.equal(b.settle(r, 'd', 'done'), r, 'a settled id is final');
  const t = b.tally(r);
  assert.deepEqual([t.done, t.failed, t.left], [1, 3, 0]);
  assert.match(b.runText(r, { running: false }), /^Done: 1 downloaded, 3 failed, 2 long songs skipped\.$/);
  assert.match(b.runText({ ...r, stopped: true }, { running: false }), /^Stopped after 3 failures in a row/);
  assert.deepEqual(b.failedList(r, [{ id: 'a', artist: 'A', title: 'T' }]), ['A - T (a): x', 'c (c)', 'd (d)']);
});

test('long songs: more than 5 minutes or unknown length', () => {
  assert.equal(LONG_SONG_SECONDS, 300);
  const songs = [{ id: 's', duration: 300 }, { id: 'l', duration: 301 }, { id: 'u' }, { id: 'z', duration: 0 }];
  const { short, long } = b.splitLong(songs);
  assert.deepEqual(short.map((x) => x.id), ['s']);
  assert.deepEqual(long.map((x) => x.id), ['l', 'u', 'z']);
  const text = b.longText([{ id: 'l', artist: 'A', title: 'T', duration: 3600 }, { id: 'u' }, { id: 'x', duration: 400 }, { id: 'y', duration: 500 }]);
  assert.match(text, /^4 songs are longer than 5 minutes/);
  assert.match(text, /A - T \(1:00:00\); u \(unknown length\); x \(6:40\); and 1 more/);
});

test('download card skips long songs unless included', async () => {
  const requested = [];
  stubFetch((url, o) => {
    if (url === '/me/usage') return { body: { max_adds: null } };
    if (/^\/songs\/.+\/audio/.test(url)) { requested.push(url); return { status: 500, body: { detail: 'no' } }; }
    return { status: 404, body: {} };
  });
  store.songs = [{ id: 'aaaaaaaaaaa', title: 'Short', duration: 200, audio_state: 'none' }, { id: 'bbbbbbbbbbb', title: 'Long', duration: 4000, audio_state: 'none' }];
  bulkDownload.reset();
  const card = downloadAllCard();
  document.body.append(card);
  assert.match(card.textContent, /2 songs are not downloaded yet/);
  fire(card.querySelectorAll('button')[0], 'click');
  await flush();
  assert.match(card.textContent, /Download 1 song,/);
  assert.match(card.textContent, /1 song is longer than 5 minutes/);
  const go = [...card.querySelectorAll('button')].find((x) => x.textContent === 'Start');
  fire(go, 'click');
  await flush();
  await flush();
  assert.deepEqual(requested, ['/songs/aaaaaaaaaaa/audio']);
  assert.match(card.textContent, /1 failed, 1 long song skipped/);
  bulkDownload.reset();
  card.remove();
});
