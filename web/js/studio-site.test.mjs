import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, fire } from './test-dom.mjs';

installDom();
const { PAGES, pageFromHash, DEFAULT_PAGE } = await import('../../studio/routes.js');
const { createHarmonicsCard, PLAYER_NEEDS_APP, APP_URL } = await import('./harmonics.js');
const { createMicCard, CAPTION, CAPTION_STANDALONE } = await import('./mic-tool.js');
const { mountTools, mountMic, mountChordophones, TOOLS_NOTE } = await import('./studio-tools.js');
const { PLACEHOLDERS, mountPlaceholder } = await import('../../studio/placeholders.js');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const player = (available) => ({ available, playing: false, analyser: null, sampleRate: 0, failed: false, ensure() {} });

test('STU-006: six routes, #/synthesize/simple is the default, the old two-page hashes are aliases, anything else falls back', () => {
  assert.equal(DEFAULT_PAGE, 'synthesize/simple');
  for (const id of ['synthesize/simple', 'synthesize/chordophones', 'synthesize/aerophones', 'synthesize/membranophones', 'synthesize/idiophones', 'analyze/bpm']) {
    assert.equal(pageFromHash(`#/${id}`), id);
  }
  assert.equal(pageFromHash('#/synthesize/chordophones/'), 'synthesize/chordophones');
  assert.equal(pageFromHash('#/synthesize'), 'synthesize/simple');
  assert.equal(pageFromHash('#/analyze'), 'analyze/bpm');
  assert.equal(pageFromHash(''), 'synthesize/simple');
  assert.equal(pageFromHash('#/bogus'), 'synthesize/simple');
  assert.equal(pageFromHash('#/analyze/bogus'), 'synthesize/simple');
  assert.equal(pageFromHash('#/studio/tools'), 'synthesize/simple');
  assert.deepEqual(PAGES.map((p) => [p.group, p.label, p.hash]), [
    ['Synthesize', 'Simple tone', '#/synthesize/simple'],
    ['Synthesize', 'Chordophones', '#/synthesize/chordophones'],
    ['Synthesize', 'Aerophones', '#/synthesize/aerophones'],
    ['Synthesize', 'Membranophones', '#/synthesize/membranophones'],
    ['Synthesize', 'Idiophones', '#/synthesize/idiophones'],
    ['Analyze', 'Live BPM', '#/analyze/bpm'],
  ]);
});

test('STU-017: the three placeholder pages name their physics and a new ticket', () => {
  assert.deepEqual(Object.keys(PLACEHOLDERS), ['synthesize/aerophones', 'synthesize/membranophones', 'synthesize/idiophones']);
  for (const [id, { task }] of Object.entries(PLACEHOLDERS)) {
    const pane = document.createElement('div');
    mountPlaceholder(pane, id);
    assert.match(pane.querySelector('.stu-soon').textContent, new RegExp(`Coming soon: see ${task}$`));
    assert.ok(read(`../../docs/tasks/${task}.md`).includes('status: to do'));
  }
  assert.match(PLACEHOLDERS['synthesize/membranophones'].lines.join(' '), /1, 1\.59, 2\.14, 2\.30, 2\.65 and 2\.92/);
});

test('STU-005: the left menu is a nav named Studio with the groups Synthesize (five items) and Analyze (Live BPM) and a link back to the main app', () => {
  const html = read('../../studio/index.html');
  const nav = html.match(/<nav class="site-nav" aria-label="Studio">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/<h2 [^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), ['Synthesize', 'Analyze']);
  assert.deepEqual([...nav.matchAll(/<a [^>]*href="([^"]*)"[^>]*data-page="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2], m[3]]), PAGES.map((p) => [p.hash, p.id, p.label]));
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

test('STU-006: Live BPM and Chordophones are separate pages, each with one card and a dispose', () => {
  const bpm = document.createElement('div');
  const stopBpm = mountMic(bpm, { standalone: true });
  assert.ok(bpm.querySelector('.mt-card'));
  assert.equal(bpm.querySelector('.hm-card'), null);
  stopBpm();
  const lab = document.createElement('div');
  const stopLab = mountChordophones(lab, { harmonics: { player: player(false) } });
  assert.ok(lab.querySelector('.hm-card'));
  assert.equal(lab.querySelector('.mt-card'), null);
  stopLab();
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
  assert.match(main, /import \{ mountMic, mountChordophones \} from '\.\.\/web\/js\/studio-tools\.js'/);
  assert.match(main, /from '\.\.\/web\/js\/simple-tone\.js'/);
  for (const name of ['studio-tools', 'simple-tone', 'mic-tool', 'harmonics', 'harmonics-input']) {
    assert.doesNotMatch(read(`./${name}.js`), /from '\.\/(api|store|guest|storage)\.js'|localStorage|sessionStorage|fetch\(/, name);
  }
});
