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

test('WEB-012: below 400 px the tab bar drops its gaps and side margins so eight 44 px entries fit 360 px', () => {
  const css = read('../style.css');
  const rule = css.match(/@media \(max-width: 399px\) \{ #nav :where\(a, \.nav-parent\) \{ min-width: var\(--hit\); \}[^\n]*\}/)[0];
  assert.match(rule, /#nav \{ gap: 0; padding-inline: 0; \}/);
  assert.match(rule, /\.side \{ left: clamp\(var\(--space-1\), calc\(\(100vw - 8 \* var\(--hit\)\) \/ 2\), var\(--space-4\)\)/);
});

test('WEB-175: the main app redirects the old Analyze and Synthesize hashes to the studio site before anything else in route()', async () => {
  const { studioSiteUrl, STUDIO_SITE } = await import('./studio-redirect.js');
  assert.equal(STUDIO_SITE, 'https://studio.electrophone.cc/');
  for (const h of ['#/studio/tools', '#studio/tools', '#/studio/analyze', '#/studio/tools/', '#/STUDIO/Analyze']) assert.equal(studioSiteUrl(h), 'https://studio.electrophone.cc/#/analyze', h);
  for (const h of ['#/studio/simple', '#/studio/synthesize', '#/studio/simple/']) assert.equal(studioSiteUrl(h), 'https://studio.electrophone.cc/#/synthesize', h);
  for (const h of ['', '#/studio', '#/studio/other', '#/library', undefined]) assert.equal(studioSiteUrl(h), null, String(h));
  const app = read('./app.js');
  assert.match(app, /function route\(soft = false\) \{\n  const studioSite = studioSiteUrl\(location\.hash\);\n  if \(studioSite\) \{\n    location\.replace\(studioSite\);\n    return;\n  \}/);
  assert.doesNotMatch(app, /studio\/tools|studio\/simple/);
});

