import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { openAdd } = await import('./add.js');
const { fetchSteps } = await import('./add-progress.js');
const { api } = await import('./api.js');

const STAGES = [{ id: 'link', label: 'Reading the link' }, { id: 'details', label: 'Getting title and artist' }, { id: 'wiki', label: 'Checking Wikipedia' }];
const stagesEv = { event: 'stages', stages: STAGES };
const st = (id, state) => ({ event: 'stage', id, state });
const cls = (n) => [...n.querySelectorAll('li')].map((li) => li.className);

test('checklist: pending, current and done steps; the live line names the step', () => {
  const s = fetchSteps();
  s.handle(stagesEv);
  assert.deepEqual(cls(s.node), ['step pending', 'step pending', 'step pending']);
  s.handle(st('link', 'start'));
  s.handle(st('link', 'done'));
  s.handle(st('details', 'start'));
  assert.deepEqual(cls(s.node), ['step done', 'step current', 'step pending']);
  const live = s.node.querySelector('[role=status]');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.equal(live.textContent, 'Step 2 of 3: Getting title and artist');
  assert.equal(s.node.querySelectorAll('li')[1].getAttribute('aria-current'), 'step');
  s.stop();
});

test('checklist: fail marks the running step and says where it stopped', () => {
  const s = fetchSteps();
  s.handle(stagesEv);
  s.handle(st('link', 'start'));
  s.handle(st('link', 'done'));
  s.handle(st('details', 'start'));
  s.fail();
  assert.deepEqual(cls(s.node), ['step done', 'step failed', 'step pending']);
  assert.equal(s.node.querySelector('[role=status]').textContent, 'Stopped at: Getting title and artist');
});

test('checklist: elapsed seconds come from the clock, not from fake progress', () => {
  let t = 1000;
  const s = fetchSteps(() => t);
  t = 8400;
  s.stop();
  assert.equal(s.node.querySelector('.step-clock').textContent, '7 s');
});

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const lines = (...evs) => `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`;
const dlg = () => document.getElementById('add-dialog');

test('Add dialog shows the checklist while fetching, then replaces it with the form', async () => {
  store.loaded = true;
  store.songs = [];
  let release;
  stubFetch((url) => (url === '/preview/stream'
    ? new Promise((r) => { release = () => r({ body: lines(stagesEv, st('link', 'start'), { event: 'result', data: { id: 'dQw4w9WgXcQ', title: 'T', artist: 'A', source: 'youtube', source_url: YT, tags: [] } }) }); })
    : { body: { songs: [] } }));
  openAdd();
  const input = dlg().querySelector('input');
  input.value = YT;
  input.dispatchEvent(makeEvent('input', { inputType: 'insertText', data: 'x' }));
  dlg().querySelector('form.well').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.ok(dlg().querySelector('.fetch-steps'), 'checklist visible while waiting');
  release();
  await flush();
  assert.equal(dlg().querySelector('.fetch-steps'), null);
  assert.ok(dlg().querySelector('.add-card'));
  dlg().close();
});

test('Add dialog keeps the checklist with the failing step marked and the error text', async () => {
  store.loaded = true;
  stubFetch((url) => (url === '/preview/stream'
    ? { body: lines(stagesEv, st('link', 'start'), st('link', 'done'), st('details', 'start'), { event: 'error', stage: 'details', status: 502, error: 'failed', detail: 'preview failed: Video unavailable' }) }
    : { body: { songs: [] } }));
  openAdd();
  const input = dlg().querySelector('input');
  input.value = YT;
  input.dispatchEvent(makeEvent('input', { inputType: 'insertText', data: 'x' }));
  dlg().querySelector('form.well').dispatchEvent(makeEvent('submit'));
  await flush();
  assert.deepEqual(cls(dlg().querySelector('.fetch-steps')), ['step done', 'step failed', 'step pending']);
  assert.match(dlg().textContent, /Video unavailable/);
  assert.equal(dlg().querySelector('button[type=submit]').disabled, false);
  dlg().close();
});

test('api.preview with a stream callback: a dropped stream is an error, 401 keeps the sign-in message', async () => {
  stubFetch(() => ({ body: lines(stagesEv, st('link', 'start')) }));
  const seen = [];
  await assert.rejects(api.preview(YT, undefined, (e) => seen.push(e.event)), /interrupted/);
  assert.deepEqual(seen, ['stages', 'stage']);
  stubFetch(() => ({ status: 401, body: { detail: 'x' } }));
  await assert.rejects(api.preview(YT, undefined, () => {}), /Not signed in/);
});
