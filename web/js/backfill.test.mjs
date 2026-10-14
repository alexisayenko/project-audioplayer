import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'music.example' };
const h = await import('./backfill.js');
const { store } = await import('./store.js');
const { bpmCard } = await import('./backfill-card.js');

const realTimeout = globalThis.setTimeout;
const S = (o = {}) => ({ state: 'idle', candidates: 0, total: 0, done: 0, failed: 0, skipped: 0, ...o });

test('candidate text and plural', () => {
  assert.equal(h.candidateText(0), 'Every song with audio has a BPM.');
  assert.equal(h.candidateText(1), '1 song has audio but no BPM');
  assert.equal(h.candidateText(56), '56 songs have audio but no BPM');
});

test('progress label and percent', () => {
  const s = S({ state: 'running', total: 56, done: 9, failed: 3 });
  assert.equal(h.progressText(s), 'Detecting... 12 of 56 (3 failed)');
  assert.equal(h.progressPercent(s), 21);
  assert.equal(h.progressText(S({ state: 'running', total: 4, done: 1 })), 'Detecting... 1 of 4');
  assert.equal(h.progressPercent(S()), 0);
  assert.equal(h.progressPercent(S({ total: 2, done: 5 })), 100);
});

test('final messages', () => {
  assert.equal(h.finalText(S({ state: 'done', done: 51, failed: 3, skipped: 2 })), 'Done: 51 detected, 3 failed, 2 skipped. Reload the library to see new BPMs');
  assert.match(h.finalText(S({ state: 'cancelled', done: 1 })), /^Cancelled: 1 detected/);
  assert.match(h.finalText(S({ state: 'error', last_error: 'disk' })), /\(disk\)/);
  assert.equal(h.statusText(S()), '');
  assert.equal(h.statusText(S({ state: 'done' })), '');
});

test('start is allowed only with candidates and no running job', () => {
  assert.equal(h.canStart(S({ candidates: 0 })), false);
  assert.equal(h.canStart(S({ candidates: 3 })), true);
  assert.equal(h.canStart(S({ candidates: 3, state: 'running' })), false);
  assert.equal(h.canStart(null), false);
});

function harness(states) {
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { if (ms !== h.POLL_MS) return realTimeout(fn, ms); timers.push(fn); return timers.length; };
  globalThis.clearTimeout = () => {};
  let polls = 0;
  let refreshed = 0;
  store.refresh = async () => { refreshed += 1; };
  const calls = stubFetch((url, o) => {
    if (url !== '/me/backfill/bpm') return { status: 404, body: {} };
    if (o.method === 'POST') return { status: 202, body: states.start };
    if (o.method === 'DELETE') return { body: states.cancel || S({ state: 'cancelled' }) };
    polls += 1;
    return { body: states.polls.shift() ?? states.polls.at(-1) };
  });
  const card = bpmCard();
  document.body.append(card);
  return { card, calls, timers, refreshed: () => refreshed, polls: () => polls };
}
const q = (card, sel) => card.querySelector(sel);
const buttons = (card) => [...card.querySelectorAll('button')];

test('idle with candidates: text, enabled button, no bar', async () => {
  const { card } = harness({ polls: [S({ candidates: 5 })] });
  await flush();
  assert.match(card.textContent, /5 songs have audio but no BPM/);
  const [start, stop] = buttons(card);
  assert.equal(start.disabled, false);
  assert.equal(stop.hidden, true);
  assert.equal(q(card, '[role=progressbar]').hidden, true);
  card.remove();
});

test('no candidates disables the button', async () => {
  const { card } = harness({ polls: [S()] });
  await flush();
  assert.equal(buttons(card)[0].disabled, true);
  card.remove();
});

test('run: progress, polling, completion refreshes the library', async () => {
  const running = (done) => S({ state: 'running', candidates: 3, total: 3, done });
  const { card, timers, refreshed } = harness({
    start: running(0),
    polls: [S({ candidates: 3 }), running(1), S({ state: 'done', candidates: 1, total: 3, done: 2, failed: 1 })],
  });
  await flush();
  buttons(card)[0].click();
  await flush();
  const bar = q(card, '[role=progressbar]');
  assert.equal(bar.hidden, false);
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  assert.equal(buttons(card)[0].disabled, true);
  assert.equal(buttons(card)[1].hidden, false);
  assert.equal(timers.length, 1);
  timers.shift()();
  await flush();
  assert.equal(bar.getAttribute('aria-valuenow'), '33');
  assert.match(q(card, '[role=status]').textContent, /Detecting\.\.\. 1 of 3/);
  assert.equal(refreshed(), 0);
  timers.shift()();
  await flush();
  assert.match(q(card, '[role=status]').textContent, /^Done: 2 detected, 1 failed, 0 skipped\. Reload the library/);
  assert.equal(bar.hidden, true);
  assert.equal(timers.length, 0);
  assert.equal(refreshed(), 1);
  card.remove();
});

test('cancel calls DELETE and shows the cancelled state', async () => {
  const running = S({ state: 'running', candidates: 2, total: 2 });
  const { card, calls } = harness({ start: running, polls: [S({ candidates: 2 }), S({ state: 'cancelled', candidates: 2, total: 2, done: 1 })] });
  await flush();
  buttons(card)[0].click();
  await flush();
  buttons(card)[1].click();
  await flush();
  assert.ok(calls.some((c) => c.opts.method === 'DELETE'));
  assert.match(q(card, '[role=status]').textContent, /^Cancelled: 1 detected/);
  card.remove();
});

test('a hidden tab pauses polling and resumes on visibility', async () => {
  const running = S({ state: 'running', candidates: 2, total: 2 });
  const { card, timers, polls } = harness({ start: running, polls: [S({ candidates: 2 }), running, running] });
  await flush();
  buttons(card)[0].click();
  await flush();
  document.hidden = true;
  timers.shift()();
  await flush();
  assert.equal(polls(), 1);
  document.hidden = false;
  document.dispatchEvent({ type: 'visibilitychange' });
  await flush();
  assert.equal(polls(), 2);
  card.remove();
});
