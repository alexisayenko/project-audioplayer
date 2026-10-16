import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch, flush } from './test-dom.mjs';

installDom();
const { identifyBlock } = await import('./identify-block.js');

function mk(opts = {}) {
  const calls = { suggested: [], year: [], links: [] };
  const editor = { setSuggested: (t, o) => calls.suggested.push([t, o]) };
  const b = identifyBlock({ id: 's1', audio: true, editor, getReleased: () => '', setReleased: (y) => calls.year.push(y), applyLinks: (l) => calls.links.push(l), ...opts });
  return { b, calls, btn: b.node.querySelector('button'), msg: b.node.querySelector('p') };
}

const OK = { status: 'ok', matched: { title: 'T', artist: 'A', confidence: 0.91 }, sources: ['musicbrainz'], suggested_year: 1999, suggested_tags: ['genre:rock', 'bad', 'country:gb'], links: { musicbrainz: 'https://mb/1', discogs: 'javascript:alert(1)' } };

test('disabled with a reason when the song has no id or no audio', () => {
  stubFetch(() => ({ body: {} }));
  for (const o of [{ id: null, audio: false }, { id: 's', audio: false }]) {
    const { btn } = mk(o);
    assert.equal(btn.disabled, true);
    assert.ok(btn.title.length > 5);
  }
});

test('stored state loads on creation: availability disables, results are shown', async () => {
  stubFetch(() => ({ body: { available: { acoustid: false, discogs: false }, status: 'unavailable' } }));
  const a = mk();
  await flush();
  assert.equal(a.btn.disabled, true);
  assert.match(a.btn.title, /Not configured/);
  stubFetch(() => ({ body: { ...OK, available: { acoustid: true, discogs: true } } }));
  const b = mk();
  await flush();
  assert.equal(b.btn.disabled, false);
  assert.match(b.msg.textContent, /Matched: A - T \(91%\)/);
  assert.deepEqual(b.calls.suggested[0][0], ['genre:rock', 'country:gb']);
});

test('clicking identifies, shows suggestions and Apply buttons that call back; unsafe links are dropped', async () => {
  const calls = stubFetch((url, o) => (o.method === 'POST' ? { body: OK } : { body: { status: 'none' } }));
  const { btn, b, calls: cb, msg } = mk();
  await flush();
  btn.click();
  assert.equal(btn.disabled, true);
  assert.match(btn.textContent, /Identifying/);
  await flush();
  assert.ok(calls.some((c) => c.url === '/songs/s1/identify' && c.opts.method === 'POST'));
  assert.match(msg.textContent, /MusicBrainz/);
  const [yearBtn, linkBtn] = b.node.querySelectorAll('.row button');
  assert.equal(yearBtn.textContent, 'Apply year 1999');
  yearBtn.click();
  linkBtn.click();
  assert.deepEqual(cb.year, [1999]);
  assert.equal(cb.links[0].musicbrainz_url, 'https://mb/1');
  assert.equal(cb.links[0].discogs_url, null, 'javascript: URLs never reach the form');
  assert.equal(btn.textContent, 'Identify from audio');
  assert.equal(btn.disabled, false);
});

test('year button is not offered when the year already matches', async () => {
  stubFetch((u, o) => (o.method === 'POST' ? { body: { ...OK, links: {} } } : { body: {} }));
  const { btn, b } = mk({ getReleased: () => '1999' });
  await flush();
  btn.click();
  await flush();
  assert.equal(b.node.querySelectorAll('.row button').length, 0);
});

test('failure shows the error message and re-enables the button', async () => {
  stubFetch((u, o) => (o.method === 'POST' ? { status: 503, body: { detail: 'AcoustID down' } } : { body: {} }));
  const { btn, msg } = mk();
  await flush();
  btn.click();
  await flush();
  assert.equal(msg.textContent, 'AcoustID down');
  assert.equal(btn.disabled, false);
});

test('reset and destroy make an in-flight result stale', async () => {
  let release;
  stubFetch((u, o) => (o.method === 'POST' ? new Promise((r) => { release = () => r({ body: OK }); }) : { body: {} }));
  const { btn, msg, b } = mk();
  await flush();
  btn.click();
  b.reset();
  release();
  await flush();
  assert.equal(msg.textContent, '', 'late answer after reset is ignored');
  b.destroy();
});
