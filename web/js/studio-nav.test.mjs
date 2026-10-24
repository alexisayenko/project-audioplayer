import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './test-dom.mjs';

installDom();
const { ICONS, STROKE_WIDTH, icon } = await import('./icons.js');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('WEB-150: Studio is a main menu item between Statistics and Help with its own icon', () => {
  const html = read('../index.html');
  const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /<a href="#\/studio" data-route="studio" title="Studio"><span data-icon="studio" aria-hidden="true"><\/span><span class="nav-label">Studio<\/span><\/a>/);
  assert.ok(nav.indexOf('data-route="stats"') < nav.indexOf('data-route="studio"') && nav.indexOf('data-route="studio"') < nav.indexOf('id="help-toggle"'));
  assert.ok(ICONS.studio, 'icon exists');
});

test('WEB-150: the studio icon is five vertical stroked bars of different heights on the 24 grid', () => {
  const d = ICONS.studio.d;
  const bars = [...d.matchAll(/<path d="M(\d+) (\d+)v(\d+)"\/>/g)].map((m) => ({ x: +m[1], y: +m[2], h: +m[3] }));
  assert.equal(bars.length, 5);
  assert.equal(ICONS.studio.fill, undefined, 'stroke style, not filled');
  assert.equal(new Set(bars.map((b) => b.h)).size >= 4, true, 'bars of different heights');
  assert.ok(bars.every((b) => b.x >= 2 && b.x <= 22 && b.y >= 2 && b.y + b.h <= 22));
  assert.deepEqual(bars.map((b) => b.x), [4, 8, 12, 16, 20]);
  const svg = icon('studio');
  assert.equal(svg.getAttribute('stroke-width'), String(STROKE_WIDTH));
  assert.equal(svg.getAttribute('stroke-linecap'), 'round');
  assert.equal(svg.getAttribute('fill'), 'none');
});

test('WEB-150: #/studio is a lazy route that hands the player to the page, and its stylesheet is linked', () => {
  const app = read('./app.js');
  assert.match(app, /studio: lazyRoute\(\(\) => import\('\.\/studio\.js'\)/);
  assert.match(app, /renderStudio\(root, \{ player: playerApi \}\)/);
  assert.match(read('../index.html'), /<link rel="stylesheet" href="studio\.css">/);
});

test('PLY-160: the dock has the Loop chip host next to the connection note', () => {
  assert.match(read('../index.html'), /<span id="mini-loop" class="loop-chip t-caption" role="status" aria-live="polite" hidden><\/span>/);
});

test('WEB-012: below 400 px the tab bar drops its gaps and side margins so eight 44 px entries fit 360 px', () => {
  const css = read('../style.css');
  const rule = css.match(/@media \(max-width: 399px\) \{ #nav :where\(a, \.nav-parent\) \{ min-width: var\(--hit\); \}[^\n]*\}/)[0];
  assert.match(rule, /#nav \{ gap: 0; padding-inline: 0; \}/);
  assert.match(rule, /\.side \{ left: clamp\(var\(--space-1\), calc\(\(100vw - 8 \* var\(--hit\)\) \/ 2\), var\(--space-4\)\)/);
});

const { studioTabs, tabFromHash, TABS } = await import('./studio-tabs.js');
const { fire, makeEvent } = await import('./test-dom.mjs');

test('WEB-175: #/studio is the Track tab, #/studio/tools the Tools tab, and app.js maps both to the studio route', () => {
  assert.equal(tabFromHash(''), 'track');
  assert.equal(tabFromHash('#/studio'), 'track');
  assert.equal(tabFromHash('#/studio/tools'), 'tools');
  assert.equal(tabFromHash('#/studio/simple'), 'simple');
  assert.equal(tabFromHash('#/studio/other'), 'track');
  assert.deepEqual(TABS.map((t) => [t.label, t.hash]), [['Track', '#/studio'], ['Tools', '#/studio/tools'], ['Simple', '#/studio/simple']]);
  assert.match(read('./app.js'), /if \(name === 'studio\/tools' \|\| name === 'studio\/simple'\) name = 'studio';/);
});

test('WEB-175: the tabs reuse the Library switch classes with the tablist pattern and a roving tabindex', () => {
  const t = studioTabs('tools', () => {});
  assert.equal(t.bar.getAttribute('role'), 'tablist');
  assert.match(t.bar.className, /\bseg\b/);
  const tabs = t.bar.querySelectorAll('[role=tab]');
  assert.deepEqual(tabs.map((b) => b.textContent), ['Track', 'Tools', 'Simple']);
  assert.deepEqual(tabs.map((b) => b.getAttribute('aria-selected')), ['false', 'true', 'false']);
  assert.deepEqual(tabs.map((b) => b.getAttribute('tabindex')), ['-1', '0', '-1']);
  assert.deepEqual(tabs.map((b) => b.getAttribute('aria-controls')), ['stu-track', 'stu-tools', 'stu-simple']);
  assert.ok(tabs.every((b) => /\bseg-btn\b/.test(b.className)));
});

test('WEB-175: a click and the arrow keys change the hash; the active tab does nothing', () => {
  const seen = [];
  const t = studioTabs('track', (h) => seen.push(h));
  const [track, tools] = t.bar.querySelectorAll('[role=tab]');
  fire(track, 'click');
  assert.deepEqual(seen, []);
  fire(tools, 'click');
  assert.deepEqual(seen, ['#/studio/tools']);
  const ev = makeEvent('keydown', { key: 'ArrowRight', bubbles: true });
  t.bar.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(seen, ['#/studio/tools', '#/studio/tools']);
  t.bar.dispatchEvent(makeEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(seen.length, 2);
});
