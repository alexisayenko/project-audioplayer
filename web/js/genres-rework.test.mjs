import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const PAYLOAD = {
  version: 2,
  clusters: [{ id: 'edm-dance', name: 'EDM / Dance', colour: '#D52633' }],
  genres: [
    { id: 'house', name: 'House', level: 1, cluster: 'edm-dance', parents: [], v1: 'house', description: 'Four on the floor.', source_links: [] },
    { id: 'deep', name: 'Deep House', level: 2, cluster: 'edm-dance', parents: ['house'], v1: 'deep house', description: null, source_links: [] },
  ],
};
let mode = 'ok';
const calls = stubFetch((u) => {
  if (u.includes('/genres/v2')) return mode === 'vocab-fail' ? { status: 500, body: { error: 'x' } } : { body: mode === 'empty' ? { version: 2, clusters: [], genres: [] } : PAYLOAD };
  if (mode === 'lib-fail') return { status: 500, body: { error: 'x' } };
  return { body: { songs: [{ id: 's1', tags: ['genre:deep house'] }] } };
});
const { renderGenresMap } = await import('./genres-rework.js');

function spyView() {
  const log = [];
  const rec = (name) => (...a) => { log.push([name, ...a]); };
  const names = ['setGraph', 'setVisible', 'setMarks', 'setRelated', 'select', 'setMatches', 'focusNode', 'reset', 'zoomBy', 'resize', 'destroy'];
  return { log, factory: () => Object.fromEntries(names.map((n) => [n, rec(n)])) };
}

async function mount() {
  const spy = spyView();
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresMap(root, { forceViewFactory: spy.factory });
  await flush();
  return { root, cleanup, spy };
}
const status = (root) => root.querySelector('[role="status"]');

test('the Genres map loads the v2 structure and the library and draws the graph', async () => {
  mode = 'ok';
  const { root, cleanup, spy } = await mount();
  assert.ok(calls.some((c) => c.url.includes('/genres/v2')) && calls.some((c) => c.url.endsWith('/library')));
  assert.ok(!calls.some((c) => c.url.includes('/genres/vocabulary')));
  assert.equal(root.querySelector('h1').textContent, 'Genres map');
  assert.equal(root.querySelector('canvas').getAttribute('role'), 'img');
  const set = spy.log.find((c) => c[0] === 'setGraph');
  assert.ok(set[1].nodes.length >= 2);
  assert.equal(status(root).hidden, true);
  cleanup();
});

test('the page has the dock and zoom bar and no outline, legend, tree, side panel or toolbar', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  assert.ok(root.querySelector('.gmr-dock'));
  assert.ok(root.querySelector('.gm').classList.contains('has-dock'));
  assert.ok(root.querySelector('.gm-zoom'));
  for (const l of ['Zoom in', 'Zoom out', 'Reset view']) assert.ok(root.querySelectorAll('button').some((b) => b.getAttribute('aria-label') === l), l);
  for (const s of ['#gmr-outline', '.gmr-side', '#gmr-legend', '[role="tree"]', '.gmr-search', '.gmr-preview']) assert.equal(root.querySelector(s), null, s);
  cleanup();
});

test('the dock overlays the map: collapsing it leaves the wrapper classes untouched and shows the Genre info bar', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const wrap = root.querySelector('.gmr');
  const before = wrap.className;
  const dock = root.querySelector('.gmr-dock');
  const toggle = root.querySelector('.gmr-dock-toggle');
  if (!dock.classList.contains('collapsed')) toggle.click();
  assert.ok(dock.classList.contains('collapsed'));
  assert.equal(dock.querySelector('.gmr-dock-title').textContent, 'Genre info');
  assert.equal(wrap.className, before.replace(/ collapsed/, ''));
  toggle.click();
  assert.ok(!dock.classList.contains('collapsed'));
  cleanup();
});

test('failures show a status line: structure down, empty structure, library down', async () => {
  mode = 'vocab-fail';
  let m = await mount();
  assert.equal(status(m.root).hidden, false);
  assert.match(status(m.root).textContent, /structure unavailable/);
  m.cleanup();
  mode = 'empty';
  m = await mount();
  assert.match(status(m.root).textContent, /empty/);
  m.cleanup();
  mode = 'lib-fail';
  m = await mount();
  assert.match(status(m.root).textContent, /Library unavailable/);
  m.cleanup();
});

test('cleanup destroys the view', async () => {
  mode = 'ok';
  const { cleanup, spy } = await mount();
  cleanup();
  assert.ok(spy.log.some((c) => c[0] === 'destroy'));
});

test('collapsed dock on wide screens releases the bottom inset so it is a compact pill', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../genres.css', import.meta.url), 'utf8');
  const rule = css.match(/@media \(min-width: 720px\) \{[^]*?\n\}/g).join('\n').match(/\.gmr-dock\.collapsed \{([^}]*)\}/)[1];
  assert.match(rule, /bottom:\s*auto/);
  assert.match(rule, /height:\s*auto/);
  assert.match(rule, /min-height:\s*0/);
  assert.match(rule, /width:\s*auto/);
});
