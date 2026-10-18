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

test('stored compact state is applied at init, before any song loads', () => {
  const b = $('mini-compact');
  assert.equal($('mini').classList.contains('compact'), true);
  assert.equal(document.body.classList.contains('mini-compact'), true);
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-label'), 'Expand player');
  assert.equal(b.title, 'Expand player');
  assert.equal(b.firstChild.innerHTML, '<path d="m15 18-6-6 6-6"/>');
});

test('clicking the handle flips state, class, label, chevron and storage', () => {
  const b = $('mini-compact');
  b.click();
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(b.getAttribute('aria-label'), 'Compact player');
  assert.equal(b.title, 'Compact player');
  assert.equal($('mini').classList.contains('compact'), false);
  assert.equal(document.body.classList.contains('mini-compact'), false);
  assert.equal(b.firstChild.innerHTML, '<path d="m9 18 6-6-6-6"/>');
  assert.equal(localStorage.getItem(KEY), '0');
  b.click();
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-label'), 'Expand player');
  assert.equal($('mini').classList.contains('compact'), true);
  assert.equal(localStorage.getItem(KEY), '1');
});

test('the handle is a real button inside the dock, expanded by default markup', () => {
  assert.match(html, /<button class="mini-handle" id="mini-compact" type="button" aria-pressed="false" aria-label="Compact player"/);
  const dock = html.slice(html.indexOf('<section id="mini"'), html.indexOf('</section>', html.indexOf('<section id="mini"')));
  assert.ok(dock.indexOf('id="mini-compact"') > 0 && dock.indexOf('id="mini-compact"') < dock.indexOf('class="mini-lead"'));
});

test('css: compact shows only play, next and the volume slider', () => {
  const hide = css.match(/\.mini\.compact \.mini-lead, \.mini\.compact :is\(([^)]*)\), \.mini\.compact \.mini-foot > :not\(#mini-volume\) \{ display: none; \}/);
  assert.ok(hide);
  for (const id of ['#mini-viz', '#mini-shuffle', '#mini-prev', '#mini-repeat']) assert.ok(hide[1].includes(id));
  for (const id of ['#mini-play', '#mini-next']) assert.ok(!hide[1].includes(id));
  assert.match(css, /\.mini\.compact \.mini-foot > \.slider \{ width: 100%; \}/);
  assert.match(css, /\.mini\.compact \{ grid-template-columns: var\(--mini-keys-w\); grid-template-rows: var\(--hit\) var\(--control-sm\); \}/);
});

test('css: compact sets the dock height and width through --mini-h and --mini-w, from 480px only', () => {
  const m = css.match(/@media \(min-width: 480px\) \{ body\.mini-compact \{ --mini-h: ([^;]+); --mini-w: ([^;]+); \} \}/);
  assert.ok(m);
  assert.equal(m[1], 'calc(var(--hit) + var(--control-sm) + 2 * var(--space-2))');
  assert.match(m[2], /--mini-keys-w/);
  assert.match(css, /--mini-keys-w: calc\(var\(--control-xl\) \+ var\(--space-2\) \+ var\(--hit\)\)/);
  assert.match(css, /transition: width var\(--dur-base\) var\(--ease-io\), height var\(--dur-base\) var\(--ease-io\)/);
});

test('css: the handle is not displayed below 480px and is styled only inside the 480px media rule', () => {
  assert.match(css, /\n\.mini-handle \{ display: none; \}\n/);
  const i = css.indexOf('@media (min-width: 480px) {\n  .mini {');
  const j = css.indexOf('@media (min-width: 640px) { .mini .opt');
  const block = css.slice(i, j);
  assert.match(block, /\.mini-handle \{[^}]*position: absolute; left: 0; top: 0; bottom: 0; width: var\(--mini-handle-w\)/);
  assert.match(block, /border-radius: var\(--radius-tray\) 0 0 var\(--radius-tray\)/);
  assert.match(block, /\.mini-handle:hover[^}]*--hover-wash/);
  assert.match(block, /\.mini-handle:active[^}]*--pressed-wash/);
  assert.ok(!/\.mini-handle[^{]*\{[^}]*display: none/.test(block));
});
