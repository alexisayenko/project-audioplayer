import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, fire } from './test-dom.mjs';

installDom();
const { PAGES, pageFromHash, DEFAULT_PAGE } = await import('../../studio/routes.js');
const { createHarmonicsCard, PLAYER_NEEDS_APP, APP_URL } = await import('./harmonics.js');
const { createMicCard, CAPTION, CAPTION_STANDALONE } = await import('./mic-tool.js');
const { mountTools, TOOLS_NOTE } = await import('./studio-tools.js');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const player = (available) => ({ available, playing: false, analyser: null, sampleRate: 0, failed: false, ensure() {} });

test('STU-006: #/synthesize is the default, #/analyze the second route, anything else falls back to Synthesize', () => {
  assert.equal(DEFAULT_PAGE, 'synthesize');
  assert.equal(pageFromHash('#/synthesize'), 'synthesize');
  assert.equal(pageFromHash('#/analyze'), 'analyze');
  assert.equal(pageFromHash(''), 'synthesize');
  assert.equal(pageFromHash('#/bogus'), 'synthesize');
  assert.equal(pageFromHash('#/studio/tools'), 'synthesize');
  assert.deepEqual(PAGES.map((p) => [p.label, p.hash]), [['Synthesize', '#/synthesize'], ['Analyze', '#/analyze']]);
});

test('STU-005: the left menu is a nav named Studio with Synthesize then Analyze and a link back to the main app', () => {
  const html = read('../../studio/index.html');
  assert.match(html, /<nav class="site-nav" aria-label="Studio">\s*<a [^>]*href="#\/synthesize"[^>]*>Synthesize<\/a>\s*<a [^>]*href="#\/analyze"[^>]*>Analyze<\/a>\s*<\/nav>/);
  assert.ok(html.indexOf('class="site-nav"') < html.indexOf('class="site-home'));
  assert.match(html, /<a class="site-home[^"]*" href="https:\/\/electrophone\.cc\/">Back to Electrophone<\/a>/);
  assert.doesNotMatch(read('../../studio/main.js'), /studio-tabs|role: 'tab/);
  assert.match(read('../../studio/main.js'), /setAttribute\('aria-current', 'page'\)/);
});

test('STU-009: without a player the Player source is disabled and explained, not hidden', () => {
  const card = createHarmonicsCard({ player: player(false) });
  const buttons = card.node.querySelectorAll('.hm-seg button');
  const off = buttons.find((b) => b.textContent === 'Player');
  assert.equal(off.disabled, true);
  assert.equal(off.title, PLAYER_NEEDS_APP);
  assert.equal(buttons.find((b) => b.textContent === 'Synth').getAttribute('aria-checked'), 'true');
  const note = card.node.querySelectorAll('.hm-cap').find((p) => p.textContent === PLAYER_NEEDS_APP);
  assert.equal(note.hidden, false);
  assert.equal(note.querySelector('a').getAttribute('href'), APP_URL);
  fire(off, 'click');
  assert.equal(buttons.find((b) => b.textContent === 'Synth').getAttribute('aria-checked'), 'true');
  card.dispose();
});

test('STU-009: with a player nothing changes in the main app', () => {
  const card = createHarmonicsCard({ player: player(true) });
  const off = card.node.querySelectorAll('.hm-seg button').find((b) => b.textContent === 'Player');
  assert.equal(off.disabled, false);
  assert.equal(card.node.querySelectorAll('.hm-cap').some((p) => p.textContent === PLAYER_NEEDS_APP), false);
  card.dispose();
});

test('STU-010: the standalone caption leaves out the player and the Analyze tab drops the temporary note', () => {
  assert.match(CAPTION, /The player and this tool can run together/);
  assert.doesNotMatch(CAPTION_STANDALONE, /player/i);
  assert.match(CAPTION_STANDALONE, /Nothing is recorded or uploaded/);
  const mic = createMicCard({ standalone: true });
  assert.equal(mic.node.querySelector('.mt-caption').textContent, CAPTION_STANDALONE);
  mic.dispose();
  const panel = document.createElement('div');
  const dispose = mountTools(panel, { standalone: true, harmonics: { player: player(false) } });
  assert.equal(panel.querySelector('.stu-tools-note'), null);
  assert.ok(panel.querySelector('.mt-card') && panel.querySelector('.hm-card'));
  dispose();
  assert.equal(TOOLS_NOTE, 'Temporary home for audio tools.');
});

test('STU-001, STU-014: the site page and headers match the spec', () => {
  const html = read('../../studio/index.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<title>Electrophone Studio<\/title>/);
  assert.match(html, /<body[^>]*data-route="studio"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)|\sstyle=|\son[a-z]+=/);
  const headers = read('../../studio/_headers');
  for (const h of ["script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", 'microphone=(self)', 'nosniff', 'Referrer-Policy: no-referrer', 'X-Robots-Tag: noindex', 'max-age=31536000, immutable']) assert.ok(headers.includes(h), h);
  assert.doesNotMatch(headers, /includeSubDomains/);
  assert.match(read('../../studio/robots.txt'), /Disallow: \//);
});

test('STU-002, STU-012: the entry imports the shared tool modules and none of the main app state', () => {
  const main = read('../../studio/main.js');
  assert.match(main, /from '\.\.\/web\/js\/studio-tools\.js'/);
  assert.match(main, /from '\.\.\/web\/js\/simple-tone\.js'/);
  for (const name of ['studio-tools', 'simple-tone', 'mic-tool', 'harmonics', 'harmonics-input']) {
    assert.doesNotMatch(read(`./${name}.js`), /from '\.\/(api|store|guest|storage)\.js'|localStorage|sessionStorage|fetch\(/, name);
  }
});
