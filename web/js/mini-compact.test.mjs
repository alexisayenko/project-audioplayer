import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
localStorage.setItem('ap2.miniCompact', '1');
const { initPlayer } = await import('./player.js');
initPlayer();

const $ = (id) => document.getElementById(id);
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const KEY = 'ap2.miniCompact';

test('stored collapsed state is applied at init, before any song loads', () => {
  assert.equal($('mini').classList.contains('compact'), true);
  assert.equal(document.body.classList.contains('mini-compact'), true);
  for (const id of ['mini-compact', 'side-mini-open']) assert.equal($(id).getAttribute('aria-expanded'), 'false');
  assert.equal($('mini-compact').firstChild.innerHTML, '<path d="m15 18-6-6 6-6"/>');
  assert.equal($('side-mini-expand'), null);
});

test('either button flips state, class, aria-expanded and storage', () => {
  $('side-mini-open').click();
  for (const id of ['mini-compact', 'side-mini-open']) assert.equal($(id).getAttribute('aria-expanded'), 'true');
  assert.equal($('mini').classList.contains('compact'), false);
  assert.equal(document.body.classList.contains('mini-compact'), false);
  assert.equal(localStorage.getItem(KEY), '0');
  $('mini-compact').click();
  for (const id of ['mini-compact', 'side-mini-open']) assert.equal($(id).getAttribute('aria-expanded'), 'false');
  assert.equal($('mini').classList.contains('compact'), true);
  assert.equal(localStorage.getItem(KEY), '1');
});

test('markup: the dock handle and the sidebar footer expand button are real buttons with labels, and the rail has no chevron', () => {
  assert.match(html, /<button class="mini-handle" id="mini-compact" type="button" aria-expanded="true" aria-label="Collapse player"/);
  assert.ok(!html.includes('side-mini-expand') && !html.includes('sm-handle'));
  const dock = html.slice(html.indexOf('<section id="mini"'), html.indexOf('</section>', html.indexOf('<section id="mini"')));
  assert.ok(dock.indexOf('id="mini-compact"') > 0 && dock.indexOf('id="mini-compact"') < dock.indexOf('class="mini-lead"'));
  const side = html.slice(html.indexOf('<aside class="side">'), html.indexOf('</aside>'));
  assert.ok(side.indexOf('id="server-build"') > side.indexOf('id="side-mini"'));
  assert.ok(side.indexOf('class="nav-sep"') > side.indexOf('data-route="studio"') && side.indexOf('class="nav-sep"') < side.indexOf('id="nav-help"'));
  assert.match(side, /<button class="sm-play" id="side-mini-play" type="button" aria-label="Play"/);
  assert.match(side, /<circle class="sm-prog" pathLength="100">/);
  assert.match(side, /<button class="sm-open" id="side-mini-open" type="button" aria-expanded="false" aria-label="Expand player"><span class="mini-text">/);
  assert.ok(!side.includes('side-mini-cover') && !side.includes('sm-cover') && !side.includes('<img'));
  assert.ok(side.indexOf('id="side-mini-open"') < side.indexOf('id="side-mini-play"'));
  assert.ok(!html.includes('title="Collapse player"'));
  assert.match(side, /<span class="sm-line" aria-hidden="true"><\/span>/);
});

test('css: the collapsed dock is not displayed and frees its page space, from 480px only', () => {
  const i = css.indexOf('@media (min-width: 480px) {\n  .mini {');
  const j = css.indexOf('@media (min-width: 640px) { .mini .opt');
  assert.match(css.slice(i, j), /\.mini\.compact \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 480px\) \{ body\.mini-compact \{ --mini-h: 0px; \} \}/);
  assert.ok(!/--mini-keys-w/.test(css));
});

test('css: the sidebar mini-player shows only when collapsed and a song is loaded, from 480px', () => {
  assert.match(css, /\.side-mini \{ display: none; position: relative; flex: none; margin-top: auto;/);
  assert.match(css, /@media \(min-width: 480px\) \{\n  body\.mini-compact\.has-mini \.side-mini \{ display: flex;/);
  assert.match(css, /body\.mini-compact\.has-mini:not\(\.side-collapsed\) \.side-mini \{[^}]*border-bottom: var\(--stroke-hairline\) solid var\(--line\)/);
  assert.ok(!/\.side-mini \{[^}]*overflow: hidden/.test(css.slice(css.indexOf('side mini-player: the dock'))));
  assert.match(css, /\.sm-line \{[^}]*height: var\(--stroke-progress\); border-radius: var\(--radius-pill\)/);
  assert.match(css, /\.sm-line::after \{[^}]*width: calc\(var\(--ring-p, 0\) \* 1%\)/);
});

test('css: the rail play button is the 56px control-xl target with a token-coloured ring', () => {
  assert.match(css, /\.sm-play \{ --sm-size: var\(--control-xl\);[^}]*width: var\(--sm-size\); height: var\(--sm-size\);[^}]*border-radius: var\(--radius-pill\)/);
  assert.ok(!/sm-handle|sm-cover/.test(css));
  assert.match(css, /\.sm-ring circle \{ cx: 50%; cy: 50%; r: calc\(50% - var\(--stroke-medium\) \/ 2\); fill: none; stroke-width: var\(--stroke-medium\); \}/);
  assert.match(css, /\.sm-prog \{ stroke: var\(--fill\); stroke-dasharray: var\(--ring-p, 0\) 100; \}/);
});

test('css: the handle is not displayed below 480px and is styled only inside the 480px media rule', () => {
  assert.match(css, /\n\.mini-handle \{ display: none; \}\n/);
  const i = css.indexOf('@media (min-width: 480px) {\n  .mini {');
  const j = css.indexOf('@media (min-width: 640px) { .mini .opt');
  const block = css.slice(i, j);
  assert.match(block, /\.mini-handle \{[^}]*position: absolute;[^}]*margin-block: auto; width: var\(--control-sm\); height: var\(--control-sm\)/);
  assert.match(block, /\.mini-handle \{[^}]*border: 0; border-radius: var\(--radius-pill\)[^}]*background-color: transparent/);
  assert.match(block, /\.mini-handle:hover[^}]*--hover-wash/);
  assert.match(block, /\.mini-handle::after \{\s*content: attr\(aria-label\);/);
  assert.match(block, /\.mini-handle:focus-visible \{ background-image/);
  assert.match(block, /\.mini-handle:active[^}]*--pressed-wash/);
  assert.ok(!/\.mini-handle[^{]*\{[^}]*display: none/.test(block));
});
