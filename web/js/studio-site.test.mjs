import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, fire } from './test-dom.mjs';

installDom();
const { PAGES, pageFromHash, DEFAULT_PAGE } = await import('../../studio/routes.js');
const { createHarmonicsCard } = await import('./harmonics.js');
const { createListenCard, PLAYER_NEEDS_APP } = await import('./listen.js');
const { createRhythmCard, CAPTION } = await import('./rhythm.js');
const { mountRhythm, mountListen, mountChordophones } = await import('./studio-tools.js');
const { PLACEHOLDERS, mountPlaceholder } = await import('../../studio/placeholders.js');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const player = (available) => ({ available, playing: false, analyser: null, sampleRate: 0, failed: false, ensure() {} });

test('STU-006: seven routes, #/synthesize/simple is the default, the old two-page hashes are aliases, anything else falls back', () => {
  assert.equal(DEFAULT_PAGE, 'synthesize/simple');
  for (const id of ['synthesize/simple', 'synthesize/chordophones', 'synthesize/aerophones', 'synthesize/membranophones', 'synthesize/idiophones', 'analyze/listen', 'analyze/rhythm']) {
    assert.equal(pageFromHash(`#/${id}`), id);
  }
  assert.equal(pageFromHash('#/analyze/bpm'), 'analyze/rhythm');
  assert.equal(pageFromHash('#/analyze/bpm/'), 'analyze/rhythm');
  assert.equal(pageFromHash('#/synthesize/chordophones/'), 'synthesize/chordophones');
  assert.equal(pageFromHash('#/synthesize'), 'synthesize/simple');
  assert.equal(pageFromHash('#/analyze'), 'analyze/listen');
  assert.equal(pageFromHash(''), 'synthesize/simple');
  assert.equal(pageFromHash('#/bogus'), 'synthesize/simple');
  assert.equal(pageFromHash('#/analyze/bogus'), 'synthesize/simple');
  assert.equal(pageFromHash('#/studio/tools'), 'synthesize/simple');
  assert.deepEqual(PAGES.map((p) => [p.group, p.label, p.hash]), [
    ['Synthesize', 'Primitive', '#/synthesize/simple'],
    ['Synthesize', 'Chordophones', '#/synthesize/chordophones'],
    ['Synthesize', 'Aerophones', '#/synthesize/aerophones'],
    ['Synthesize', 'Membranophones', '#/synthesize/membranophones'],
    ['Synthesize', 'Idiophones', '#/synthesize/idiophones'],
    ['Analyze', 'Listen', '#/analyze/listen'],
    ['Analyze', 'Rhythm', '#/analyze/rhythm'],
    ['Reference', 'Glossary', '#/glossary'],
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

test('STU-005: the left menu is a nav named Studio with the groups Synthesize (five items), Analyze (Listen, Rhythm) and Reference (Glossary) and a link back to the main app', () => {
  const html = read('../../studio/index.html');
  const nav = html.match(/<nav class="site-nav" aria-label="Studio">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/<h2 [^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), ['Synthesize', 'Analyze', 'Reference']);
  assert.deepEqual([...nav.matchAll(/<a [^>]*href="([^"]*)"[^>]*data-page="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2], m[3]]), PAGES.map((p) => [p.hash, p.id, p.label]));
  assert.ok(html.indexOf('class="site-nav"') < html.indexOf('class="site-home'));
  assert.match(html, /<a class="site-home[^"]*" href="https:\/\/electrophone\.cc\/">Back to Electrophone<\/a>/);
  assert.doesNotMatch(read('../../studio/main.js'), /studio-tabs|role: 'tab/);
  assert.match(read('../../studio/main.js'), /setAttribute\('aria-current', 'page'\)/);
});

test('STU-009: the studio offers no Player source: Listen has no Source switch and the lab has none either', () => {
  const card = createListenCard({ player: player(false) });
  assert.equal(card.source, 'mic');
  assert.equal(card.node.querySelectorAll('.hm-seg button').some((b) => b.textContent === 'Player' || b.textContent === 'Microphone'), false);
  assert.equal(card.node.textContent.includes('Player'), false);
  assert.equal(card.node.textContent.includes(PLAYER_NEEDS_APP), false);
  assert.equal(card.node.querySelectorAll('.hm-toggle').length, 1);
  card.setSource('player');
  assert.equal(card.source, 'mic');
  card.dispose();
  const lab = createHarmonicsCard();
  assert.equal(lab.node.querySelectorAll('.hm-seg button').some((b) => ['Synth', 'Microphone', 'Player'].includes(b.textContent)), false);
  assert.equal(lab.node.textContent.includes('Source'), false);
  lab.dispose();
});

test('STU-009: the Player code path stays in the shared module and is reachable only with an explicit flag', () => {
  const card = createListenCard({ sources: ['mic', 'player'], player: player(true) });
  const buttons = card.node.querySelectorAll('.hm-seg button');
  const off = buttons.find((b) => b.textContent === 'Player');
  assert.equal(off.disabled, false);
  card.dispose();
  const none = createListenCard({ sources: ['mic', 'player'], player: player(false) });
  const blocked = none.node.querySelectorAll('.hm-seg button').find((b) => b.textContent === 'Player');
  assert.equal(blocked.disabled, true);
  assert.equal(blocked.title, PLAYER_NEEDS_APP);
  fire(blocked, 'click');
  assert.equal(none.source, 'mic');
  none.dispose();
});

test('STU-010: the Rhythm caption leaves out the player and keeps the privacy sentence', () => {
  assert.doesNotMatch(CAPTION, /player/i);
  assert.match(CAPTION, /Nothing is recorded or uploaded/);
  const rhythm = createRhythmCard();
  assert.equal(rhythm.node.querySelector('.mt-caption').textContent, CAPTION);
  rhythm.dispose();
});

test('STU-006: Rhythm, Listen and Chordophones are separate pages, each with one card and a dispose', () => {
  const bpm = document.createElement('div');
  const stopBpm = mountRhythm(bpm);
  assert.ok(bpm.querySelector('.rh-card'));
  assert.equal(bpm.querySelector('.hm-card'), null);
  assert.equal(bpm.querySelector('.ls-card'), null);
  stopBpm();
  const listen = document.createElement('div');
  const stopListen = mountListen(listen);
  assert.ok(listen.querySelector('.ls-card'));
  assert.equal(listen.querySelector('.mt-card'), null);
  assert.equal(listen.querySelectorAll('.hm-card').length, 1);
  stopListen();
  const lab = document.createElement('div');
  const stopLab = mountChordophones(lab);
  assert.ok(lab.querySelector('.hm-card'));
  assert.equal(lab.querySelector('.ls-card'), null);
  assert.equal(lab.querySelector('.mt-card'), null);
  stopLab();
});

test('STU-018: Listen shows the level meter, the waveform, spectrum with the peak readout and spectrogram, in that order, and no beat bands', () => {
  const card = createListenCard();
  assert.equal(card.node.querySelector('h2').textContent, 'Listen');
  assert.deepEqual(card.node.querySelectorAll('h3').map((h) => h.textContent), ['Level', 'Waveform', 'Spectrum', 'Spectrogram']);
  assert.equal(card.node.querySelector('.hm-bands'), null);
  assert.equal(card.node.querySelector('.lv-read').textContent, '< -90 dBFS');
  assert.equal(card.node.querySelector('.hm-peak').textContent, 'Peak: -');
  assert.equal(card.node.querySelector('.hm-state').textContent, 'Tap Start to listen');
  assert.ok(card.node.textContent.includes('dBFS is the digital level: 0 is the loudest the device can record; it is not dB SPL (room loudness), which needs a calibrated microphone.'));
  assert.deepEqual(card.node.querySelectorAll('.hm-seg').map((s) => s.children.map((b) => b.textContent).join('|')), ['40 ms|1 cycle|2 cycles|4 cycles', 'Linear|Log', '2 kHz|5 kHz|10 kHz']);
  card.dispose();
});

test('STU-019: the peak-hold button resets the hold', () => {
  const card = createListenCard();
  const hold = card.node.querySelector('.lv-hold');
  assert.equal(hold.textContent, 'Peak hold: -');
  fire(hold, 'click');
  assert.equal(card.meter.hold, -90);
  card.dispose();
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
  assert.match(main, /import \{ mountRhythm, mountListen, mountChordophones \} from '\.\.\/web\/js\/studio-tools\.js'/);
  assert.match(main, /from '\.\.\/web\/js\/simple-tone\.js'/);
  for (const name of ['studio-tools', 'simple-tone', 'rhythm', 'mic-bpm', 'harmonics', 'harmonics-input', 'listen', 'listen-views']) {
    assert.doesNotMatch(read(`./${name}.js`), /from '\.\/(api|store|guest|storage)\.js'|localStorage|sessionStorage|fetch\(/, name);
  }
});
