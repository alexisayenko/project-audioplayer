import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';
import { initLibraryNav, initHelpNav } from './nav-help.js';
import { EXPANDED_KEY, loadExpanded } from './sidebar-state.js';

const mem = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

async function page({ hash, storage, width = 1200, collapsed = false, helpToo = false }) {
  await installPage();
  if (collapsed) document.body.classList.add('side-collapsed');
  const sub = document.getElementById('library-sub');
  for (const route of ['library', 'library/albums', 'library/drafts']) {
    const a = document.createElement('a');
    a.setAttribute('href', `#/${route}`);
    a.setAttribute('data-route', route);
    sub.append(a);
  }
  const win = { innerWidth: width, addEventListener() {} };
  const lib = initLibraryNav(document, win, { storage, hash });
  const help = helpToo ? initHelpNav(document, win, { storage, hash }) : null;
  const toggle = document.getElementById('library-toggle');
  return {
    lib, help, sub, toggle,
    state: () => [toggle.getAttribute('aria-expanded'), sub.hidden],
    click: () => toggle.dispatchEvent({ type: 'click', detail: 1, target: toggle }),
  };
}

test('a reload on a Library sub-route opens the Library group before the first route, default storage empty', async () => {
  for (const hash of ['#/library', '#/library/albums', '#/library/drafts', '#/library/albums/x1']) {
    const p = await page({ hash, storage: mem() });
    assert.deepEqual(p.state(), ['true', false], hash);
  }
});

test('the first route keeps it open and marks the parent active', async () => {
  const p = await page({ hash: '#/library/drafts', storage: mem() });
  p.lib.sync('library/drafts');
  assert.deepEqual(p.state(), ['true', false]);
  assert.ok(p.toggle.classList.contains('active'));
});

test('on another page the Library follows the remembered state, default collapsed', async () => {
  let p = await page({ hash: '#/playback', storage: mem() });
  assert.deepEqual(p.state(), ['false', true]);
  p = await page({ hash: '#/playback', storage: mem({ [EXPANDED_KEY]: '{"library":true}' }) });
  assert.deepEqual(p.state(), ['true', false]);
  p.lib.sync('playback');
  assert.deepEqual(p.state(), ['true', false]);
});

test('a manual toggle is remembered; the active route group is forced open anyway', async () => {
  const storage = mem();
  const p = await page({ hash: '#/library', storage });
  p.lib.sync('library');
  p.click();
  assert.deepEqual(p.state(), ['false', true]);
  assert.equal(loadExpanded(storage).library, false);
  p.lib.sync('library/albums');
  assert.deepEqual(p.state(), ['true', false], 'navigating inside the Library forces it open');
  assert.equal(loadExpanded(storage).library, false, 'forcing open does not overwrite the manual choice');
  const reload = await page({ hash: '#/library/albums', storage });
  assert.deepEqual(reload.state(), ['true', false], 'a reload on a Library route opens it despite the remembered collapse');
  const away = await page({ hash: '#/playback', storage });
  assert.deepEqual(away.state(), ['false', true]);
  away.click();
  assert.equal(loadExpanded(storage).library, true);
});

test('groups are remembered independently', async () => {
  const storage = mem({ [EXPANDED_KEY]: '{"help":true}' });
  const p = await page({ hash: '#/library/drafts', storage, helpToo: true });
  assert.deepEqual(p.state(), ['true', false]);
  const helpToggle = document.getElementById('help-toggle');
  assert.equal(helpToggle.getAttribute('aria-expanded'), 'true');
});

test('blocked storage: the group still opens on a Library route and toggling does not throw', async () => {
  const p = await page({ hash: '#/library/drafts', storage: broken });
  assert.deepEqual(p.state(), ['true', false]);
  p.click();
  assert.deepEqual(p.state(), ['false', true]);
  const away = await page({ hash: '#/stats', storage: broken });
  assert.deepEqual(away.state(), ['false', true]);
});

test('null storage (no localStorage at all) is tolerated', async () => {
  const p = await page({ hash: '#/library', storage: null });
  assert.deepEqual(p.state(), ['true', false]);
  p.click();
  assert.deepEqual(p.state(), ['false', true]);
});

test('icon rail and phone start closed (flyout and sheet), also on a Library route', async () => {
  const rail = await page({ hash: '#/library', storage: mem({ [EXPANDED_KEY]: '{"library":true}' }), collapsed: true });
  assert.deepEqual(rail.state(), ['false', true]);
  rail.lib.refresh();
  assert.deepEqual(rail.state(), ['false', true]);
  const phone = await page({ hash: '#/library/drafts', storage: mem(), width: 375 });
  assert.deepEqual(phone.state(), ['false', true]);
  phone.lib.sync('library/drafts');
  assert.deepEqual(phone.state(), ['false', true]);
});

test('the sidebar collapse that app.js applies right after the init does not close the preopened group', async () => {
  const p = await page({ hash: '#/library/drafts', storage: mem() });
  p.lib.refresh();
  assert.deepEqual(p.state(), ['true', false]);
  p.lib.sync('library/drafts');
  p.lib.refresh();
  assert.deepEqual(p.state(), ['false', true], 'after the first route, a collapse still closes the menu');
});
