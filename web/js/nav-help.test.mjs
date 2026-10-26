import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage } from './test-dom.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)[0];
const { helpMode, isHelpRoute, HELP_ROUTES, initHelpNav } = await import('./nav-help.js');

test('WEB-131 (superseded by ADR-0041): signed out, the whole sidebar and the dock are hidden, so the Help links are too', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /body\.signed-out :is\(\.side, #mini, #player/);
  assert.doesNotMatch(css, /body\.signed-out #nav a:not/);
});

test('help routes and display modes', () => {
  assert.deepEqual(HELP_ROUTES, ['theory', 'about', 'features']);
  assert.ok(isHelpRoute('about'));
  assert.ok(!isHelpRoute('library'));
  assert.equal(helpMode(375, false), 'sheet');
  assert.equal(helpMode(479, true), 'sheet');
  assert.equal(helpMode(480, false), 'flyout');
  assert.equal(helpMode(719, false), 'flyout');
  assert.equal(helpMode(720, true), 'flyout');
  assert.equal(helpMode(1200, false), 'inline');
});

await installPage();
const mk = (tag, id, attrs = {}) => {
  const e = document.createElement(tag);
  if (id) e.setAttribute('id', id);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const group = document.getElementById('nav-help');
const toggle = document.getElementById('help-toggle');
const sub = document.getElementById('help-sub');
for (const [route, label] of [['theory', 'Music theory'], ['about', 'About'], ['features', 'Features']]) {
  const a = mk('a', null, { href: `#/${route}`, 'data-route': route });
  const s = mk('span', null, { class: 'nav-label' });
  s.textContent = label;
  a.append(s);
  sub.append(a);
}
const sheet = document.getElementById('help-sheet');
sheet.close = () => { sheet.open = false; sheet.dispatchEvent({ type: 'close' }); };
const win = { innerWidth: 1200, addEventListener() {} };
const help = initHelpNav(document, win);
const state = () => [toggle.getAttribute('aria-expanded'), sub.hidden];
const click = () => toggle.dispatchEvent({ type: 'click', detail: 1, target: toggle });

test('collapsed by default on load; a load on a Help page expands it (see nav-expanded.test.mjs)', () => {
  assert.deepEqual(state(), ['false', true]);
  help.sync('theory');
  assert.deepEqual(state(), ['true', false], 'the first route (a reload) on a Help page opens the group');
  assert.ok(toggle.classList.contains('active'), 'the parent is the active item');
  click();
  assert.deepEqual(state(), ['false', true]);
});

test('click expands and collapses', () => {
  click();
  assert.deepEqual(state(), ['true', false]);
  click();
  assert.deepEqual(state(), ['false', true]);
});

test('navigating into a Help page expands; other pages keep the state; the parent follows the route', () => {
  help.sync('library');
  assert.ok(!toggle.classList.contains('active'));
  help.sync('about');
  assert.deepEqual(state(), ['true', false]);
  assert.ok(toggle.classList.contains('active'));
  help.sync('library');
  assert.deepEqual(state(), ['true', false]);
});

test('refresh (sidebar collapse) closes the menu', () => {
  help.refresh();
  assert.deepEqual(state(), ['false', true]);
});

test('phone: the Help entry opens the sheet with the three items and marks the current page', () => {
  win.innerWidth = 375;
  help.sync('features');
  click();
  assert.ok(sheet.open);
  assert.equal(toggle.getAttribute('aria-controls'), 'help-sheet');
  assert.equal(sub.hidden, true);
  const links = sheet.querySelectorAll('a');
  assert.deepEqual(links.map((a) => a.textContent), ['Music theory', 'About', 'Features']);
  assert.deepEqual(links.filter((a) => a.getAttribute('aria-current')).map((a) => a.dataset.route), ['features']);
  sheet.close();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('icon rail: a flyout opens on click and closes when a Help route is entered', () => {
  win.innerWidth = 600;
  help.refresh();
  click();
  assert.deepEqual(state(), ['true', false]);
  assert.equal(group.dataset.mode, 'flyout');
  help.sync('theory');
  assert.deepEqual(state(), ['false', true]);
});

test('WEB-131: no chevron in the header; sub items are indented in the wide rail only', () => {
  const btn = nav.match(/<button[^>]*id="help-toggle"[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(btn, /chev/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /nav-chev/);
  assert.match(css, /data-mode="inline"\] \.nav-sub a \{[^}]*margin-left: calc\(var\(--icon-nav\) \+ var\(--space-3\)\)/);
  assert.doesNotMatch(css, /data-mode="flyout"\] \.nav-sub a \{[^}]*margin-left/);
});

test('the Library menu group lists Songs, Albums and Drafts and owns the library routes', async () => {
  const { LIBRARY_ROUTES, isLibraryRoute } = await import('./nav-help.js');
  assert.deepEqual(LIBRARY_ROUTES, ['library', 'library/albums', 'library/drafts']);
  assert.ok(isLibraryRoute('library/albums') && !isLibraryRoute('playback'));
  assert.match(nav, /id="nav-library"[\s\S]*?id="library-toggle"[\s\S]*?id="library-sub"/);
  const subs = [...nav.match(/id="library-sub"[\s\S]*?<\/ul>/)[0].matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(subs, ['library', 'library/albums', 'library/drafts']);
  assert.match(nav, /id="nav-drafts-count"/);
  assert.doesNotMatch(nav, /<a href="#\/library" data-route="library" title="Library"/);
});
