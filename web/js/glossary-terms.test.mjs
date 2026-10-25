import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { TERMS, termById, termByAnchor, aliasSlug, filterTerms } = await import('./glossary-terms.js');
const { PAGES, pageFromHash, glossaryTermFromHash } = await import('../../studio/routes.js');
const { mountGlossary, countText } = await import('../../studio/glossary.js');

test('STU-025: terms are alphabetical, have unique ids and every see-also id exists', () => {
  const names = TERMS.map((t) => t.term);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  assert.equal(new Set(TERMS.map((t) => t.id)).size, TERMS.length);
  for (const t of TERMS) {
    assert.ok(t.text.length > 0, t.id);
    for (const id of t.see ?? []) assert.ok(termById(id), `${t.id} -> ${id}`);
    if (t.demo?.page) assert.ok(PAGES.some((p) => p.id === t.demo.page), `${t.id} demo ${t.demo.page}`);
    if (t.demo && !t.demo.page) {
      assert.equal(t.demo.type, 'link', t.id);
      assert.match(t.demo.href, /^#\/(learn\/sound-wave(\?wave=(sine|triangle|square|sawtooth))?|synthesize\/simple\?wave=(square|custom))$/, t.id);
    }
  }
});

test('STU-025: the terms asked for are present with their key wording', () => {
  for (const id of ['amplitude', 'beating', 'dbfs', 'db-spl', 'electrophones', 'missing-fundamental', 'oscillation', 'wavelength', 'strings-per-note']) assert.ok(termById(id), id);
  assert.match(termById('oscillation').text, /From Latin oscillare, "to swing" \(English since about 1726\)\./);
  assert.match(termById('cycle-and-period').text, /440 Hz = 2\.27 ms/);
  assert.match(termById('membranophones').text, /1, 1\.59, 2\.14 and 2\.30/);
});

test('STU-025: aliases are unique, do not clash with ids and resolve as anchors', () => {
  const seen = new Map();
  for (const t of TERMS) {
    for (const a of t.aliases ?? []) {
      const slug = aliasSlug(a);
      assert.ok(slug && slug !== 'map', `${t.id}: ${a}`);
      assert.ok(!termById(slug), `alias ${a} clashes with an id`);
      assert.ok(!seen.has(slug), `alias ${a} used by ${seen.get(slug)} and ${t.id}`);
      seen.set(slug, t.id);
    }
  }
  assert.equal(termByAnchor('tone-color').id, 'timbre');
  assert.equal(termByAnchor('tone-quality').id, 'timbre');
  assert.equal(termByAnchor('тембр').id, 'timbre');
  assert.equal(termByAnchor('f0').id, 'fundamental');
  assert.equal(termByAnchor('beats-per-minute').id, 'bpm');
  assert.equal(termByAnchor('timbre').id, 'timbre');
  assert.equal(termByAnchor('no-such-term'), undefined);
  assert.match(termById('timbre').text, /^When we say A4 = 440 Hz|\. When we say A4 = 440 Hz, that is only for H1, but it applies to all instruments\./);
  assert.match(termById('timbre').text, /More precisely: H1 is the pitch.*the same harmonics with different envelopes sound like a different instrument/);
  assert.ok(['fundamental', 'inharmonicity', 'spectrum', 'sawtooth-wave', 'square-wave', 'primitive'].every((id) => termById('timbre').see.includes(id)));
  assert.deepEqual(termById('timbre').aliases, ['tone color', 'tone colour', 'tone quality', 'Klangfarbe', 'тембр']);
  assert.match(termById('timbre').text, /Also called tone color or tone quality: the character of a sound that stays when pitch and loudness are the same\./);
});

test('STU-025: the filter matches aliases and the new terms are present', () => {
  assert.ok(filterTerms(TERMS, 'tone quality').some((t) => t.id === 'timbre'));
  assert.ok(filterTerms(TERMS, 'Klangfarbe').some((t) => t.id === 'timbre'));
  assert.ok(filterTerms(TERMS, 'upper partial').some((t) => t.id === 'overtone'));
  for (const id of ['harmony', 'octave', 'interval']) assert.ok(termById(id), id);
  assert.deepEqual(termById('harmony').see, ['harmonics', 'note', 'octave', 'interval', 'chord', 'chord-progression', 'melody']);
  assert.deepEqual(termById('octave').see, ['cent', 'note', 'interval', 'semitone', 'chromatic-scale', 'equal-temperament']);
  assert.deepEqual(termById('interval').see, ['octave', 'cent', 'harmony', 'semitone', 'third', 'fourth', 'fifth', 'consonance', 'dissonance']);
});

test('STU-025: the music theory entries are present with their Russian aliases and key numbers', () => {
  const ids = ['scale', 'major-scale', 'minor-scale', 'mode', 'key', 'tonic', 'semitone', 'whole-tone', 'tuning', 'equal-temperament', 'just-intonation', 'pythagorean-tuning', 'third', 'fourth', 'fifth', 'triad', 'chord', 'root', 'inversion', 'seventh-chord', 'chord-progression', 'cadence', 'consonance', 'dissonance', 'melody', 'circle-of-fifths', 'chromatic-scale', 'pentatonic-scale', 'reference-pitch'];
  for (const id of ids) assert.ok(termById(id), id);
  assert.equal(ids.length, 29);
  const ru = { 'гамма': 'scale', 'мажорная гамма': 'major-scale', 'минорная гамма': 'minor-scale', 'лад': 'mode', 'тональность': 'key', 'тоника': 'tonic', 'полутон': 'semitone', 'целый тон': 'whole-tone', 'строй': 'tuning', 'темперация': 'tuning', 'равномерная темперация': 'equal-temperament', 'чистый строй': 'just-intonation', 'пифагорейский строй': 'pythagorean-tuning', 'терция': 'third', 'кварта': 'fourth', 'квинта': 'fifth', 'трезвучие': 'triad', 'аккорд': 'chord', 'основной тон аккорда': 'root', 'обращение': 'inversion', 'септаккорд': 'seventh-chord', 'аккордовая прогрессия': 'chord-progression', 'каденция': 'cadence', 'консонанс': 'consonance', 'диссонанс': 'dissonance', 'мелодия': 'melody', 'квинтовый круг': 'circle-of-fifths', 'хроматическая гамма': 'chromatic-scale', 'пентатоника': 'pentatonic-scale', 'октава': 'octave', 'интервал': 'interval', 'гармония': 'harmony' };
  for (const [alias, id] of Object.entries(ru)) assert.equal(termByAnchor(aliasSlug(alias)).id, id, alias);
  assert.equal(termByAnchor('temperament').id, 'tuning');
  assert.equal(termByAnchor('half-step').id, 'semitone');
  assert.equal(termByAnchor('whole-step').id, 'whole-tone');
  assert.equal(termByAnchor('concert-pitch').id, 'reference-pitch');
  assert.match(termById('equal-temperament').text, /2\^\(1\/12\) = 1\.0595/);
  assert.match(termById('just-intonation').text, /3:2 for a fifth and 5:4 for a major third/);
  assert.match(termById('third').text, /about 5:4 \(386 cents just, 400 cents equal-tempered\)/);
  assert.match(termById('fourth').text, /4:3/);
  assert.match(termById('fifth').text, /3:2 \(about 702 cents just, 700 equal-tempered\)/);
  assert.match(termById('whole-tone').text, /Not the same as "tone"/);
  assert.match(termById('reference-pitch').text, /A4 = 440 Hz/);
  assert.match(termById('cadence').text, /ends a phrase and gives a feeling of rest or pause/);
  assert.ok(filterTerms(TERMS, 'квинта').some((t) => t.id === 'fifth'));
});

test('STU-025: the waveform, noise, analysis, rhythm and volume entries are present with their aliases', () => {
  for (const id of ['sawtooth-wave', 'square-wave', 'triangle-wave', 'pulse-wave', 'duty-cycle', 'white-noise', 'pink-noise', 'fourier-transform', 'spectrum-analyzer', 'rhythm', 'beat', 'tempo', 'meter', 'bar', 'downbeat', 'onset', 'syncopation', 'subdivision', 'swing']) assert.ok(termById(id), id);
  assert.equal(termByAnchor('saw').id, 'sawtooth-wave');
  assert.equal(termByAnchor('meander').id, 'square-wave');
  assert.equal(termByAnchor('меандр').id, 'square-wave');
  assert.equal(termByAnchor('fft').id, 'fourier-transform');
  assert.equal(termByAnchor('spectrometer').id, 'spectrum-analyzer');
  assert.equal(termByAnchor('spectral-analyzer').id, 'spectrum-analyzer');
  assert.equal(termByAnchor('time-signature').id, 'meter');
  assert.equal(termByAnchor('measure').id, 'bar');
  assert.equal(termByAnchor('volume').id, 'loudness');
  assert.equal(termByAnchor('tempo').id, 'tempo');
  assert.equal(termByAnchor('beats-per-minute').id, 'bpm');
  assert.ok(termById('spectrum') && termById('spectrum-analyzer'));
  assert.match(termById('loudness').text, /Doubling the amplitude means 4x the power \(\+6 dB\) but sounds only somewhat louder: about \+10 dB sounds twice as loud\./);
  assert.ok(termById('power').see.includes('loudness'));
});

test('STU-025: filterTerms matches every word in the term or the text, ignoring case', () => {
  assert.equal(filterTerms(TERMS, ''), TERMS);
  assert.equal(filterTerms(TERMS, '   '), TERMS);
  assert.ok(filterTerms(TERMS, 'BEATING').some((t) => t.id === 'beating'));
  assert.ok(filterTerms(TERMS, 'cone amplitude').some((t) => t.id === 'amplitude'));
  assert.deepEqual(filterTerms(TERMS, 'zzzz-no-such'), []);
});

test('STU-025: #/glossary and #/glossary/<term> open the glossary page', () => {
  assert.ok(PAGES.some((p) => p.id === 'glossary' && p.group === 'Learn' && p.hash === '#/glossary'));
  assert.equal(pageFromHash('#/glossary'), 'glossary');
  assert.equal(pageFromHash('#/glossary/amplitude'), 'glossary');
  assert.equal(pageFromHash('#/glossary/'), 'glossary');
  assert.equal(glossaryTermFromHash('#/glossary/amplitude'), 'amplitude');
  assert.equal(glossaryTermFromHash('#/glossary'), '');
  assert.equal(glossaryTermFromHash('#/glossary/%E0%A4%A'), '');
});

test('STU-025: the page lists every term and the count text follows the filter', () => {
  assert.equal(countText(0, 40, true), 'No terms match.');
  assert.equal(countText(3, 40, true), '3 of 40 terms');
  assert.equal(countText(40, 40, false), '40 terms');
  const pane = document.createElement('div');
  const win = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
  const stop = mountGlossary(pane, win);
  assert.equal(pane.querySelectorAll('.gl-item').length, TERMS.length);
  assert.equal(pane.querySelector('h2').textContent, 'Glossary');
  stop();
});

test('STU-044: Sound wave is a term with aliases, see-also links and the cone animation demo; Compression and rarefaction has it too', () => {
  const t = termById('sound-wave');
  assert.equal(t.term, 'Sound wave');
  assert.deepEqual(t.aliases, ['compression wave', 'longitudinal wave']);
  assert.deepEqual(t.see, ['compression-and-rarefaction', 'wavelength', 'speed-of-sound', 'frequency', 'amplitude']);
  assert.match(t.text, /^A travelling pattern of compressions \(air squeezed closer: high pressure\) and rarefactions \(air spread thinner: low pressure\)\./);
  assert.match(t.text, /about 343 m\/s in air\)\./);
  assert.deepEqual(t.demo, { type: 'link', href: '#/learn/sound-wave', label: 'Open the demo' });
  assert.deepEqual(termById('compression-and-rarefaction').demo, { type: 'link', href: '#/learn/sound-wave', label: 'Open the demo' });
  assert.ok(termById('compression-and-rarefaction').see.includes('sound-wave'));
  assert.equal(termByAnchor('longitudinal-wave').id, 'sound-wave');
  assert.equal(termByAnchor('compression-wave').id, 'sound-wave');
  assert.equal(TERMS.length, 120);
});

test('WEB-212: Harmonic decomposition is a glossary entry with its aliases, see-also terms and a demo link to Primitive', () => {
  const t = termById('harmonic-decomposition');
  assert.equal(t.term, 'Harmonic decomposition');
  assert.equal(t.text, 'Splitting a sound into its harmonics: each one a sine wave at a whole-number multiple of the fundamental. Their sum is the sound.');
  assert.deepEqual(t.aliases, ['harmonic stack', 'Fourier decomposition']);
  assert.deepEqual(t.see, ['fourier-series', 'harmonics', 'additive-synthesis']);
  assert.deepEqual(t.demo, { type: 'link', href: '#/synthesize/simple?wave=square', label: 'Open the demo' });
  assert.equal(termByAnchor(aliasSlug('harmonic stack')).id, 'harmonic-decomposition');
  assert.equal(termByAnchor(aliasSlug('Fourier decomposition')).id, 'harmonic-decomposition');
});

test('WEB-211: Fourier series and Additive synthesis are glossary entries; the second links to Primitive > Custom', () => {
  assert.equal(termById('fourier-series').term, 'Fourier series');
  assert.match(termById('fourier-series').text, /square = odd harmonics at 1\/n\.$/);
  assert.equal(termById('additive-synthesis').text, 'Building a sound by adding sine waves (harmonics). Primitive > Custom lets you do that with sliders.');
  assert.equal(termById('additive-synthesis').demo.type, 'link');
  assert.equal(termById('additive-synthesis').demo.href, '#/synthesize/simple?wave=custom');
  assert.ok(termById('primitive').see.includes('additive-synthesis'));
});

test('STU-060: Digitizing sound is a category of 9 new terms with their numbers, aliases and see-also links', () => {
  const ids = ['sample', 'sample-rate', 'nyquist-limit', 'fft-size', 'bin', 'band', 'time-frequency-tradeoff', 'gibbs-ringing', 'phase'];
  for (const id of ids) assert.ok(termById(id), id);
  assert.match(termById('sample-rate').text, /44\.1 kHz = 44,100 Hz = 44,100 samples a second/);
  assert.match(termById('nyquist-limit').text, /22\.05 kHz at 44\.1 kHz, 24 kHz at 48 kHz/);
  assert.match(termById('fft-size').text, /16384 = 2\^14/);
  assert.match(termById('bin').text, /2\.69 Hz \(48000 \/ 16384 = 2\.93 Hz\)/);
  assert.match(termById('time-frequency-tradeoff').text, /about 7 bins wide at 16384/);
  assert.match(termById('gibbs-ringing').text, /about 9% of the jump/);
  assert.match(termById('band').text, /such as 80-150 Hz/);
  assert.match(termById('spectrum').text, /20 Hz to 20 kHz\) is its axis, not the spectrum itself/);
  assert.ok(termById('band').see.includes('bin') && termById('bin').see.includes('band'));
  assert.match(termById('phase').text, /-100%/);
  assert.equal(termByAnchor('sampling-rate').id, 'sample-rate');
  assert.equal(termByAnchor('nyquist-frequency').id, 'nyquist-limit');
  assert.equal(termByAnchor('fft-window').id, 'fft-size');
  assert.equal(termByAnchor('fft-bin').id, 'bin');
  assert.ok(termById('fourier-transform').see.includes('fft-size'));
  assert.ok(termById('square-wave').see.includes('gibbs-ringing') && termById('sawtooth-wave').see.includes('gibbs-ringing'));
});

test('STU-056: a term with the demo has an Open the demo link to the Sound wave page and no animation', () => {
  const pane = document.createElement('div');
  const win = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
  const stop = mountGlossary(pane, win);
  const link = pane.querySelector('#gl-sound-wave .gl-demo-link');
  assert.equal(link.textContent, 'Open the demo →');
  assert.equal(link.getAttribute('href'), '#/learn/sound-wave');
  assert.equal(pane.querySelectorAll('.gl-demo-link').length, 8);
  assert.equal(pane.querySelectorAll('canvas').length, 0);
  assert.equal(pane.querySelectorAll('button').filter((b) => /animation/i.test(b.textContent)).length, 0);
  stop();
});

test('STU-056: the four wave entries link to the Sound wave page with their own shape', () => {
  for (const wave of ['sine', 'triangle', 'square', 'sawtooth']) {
    const t = termById(`${wave}-wave`);
    assert.deepEqual(t.demo, { type: 'link', href: `#/learn/sound-wave?wave=${wave}`, label: 'Open the demo' });
    assert.match(t.text, /Open the demo to see how it squeezes the air\.$/);
  }
  assert.equal(termById('pulse-wave').demo, undefined);
  const pane = document.createElement('div');
  const win = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
  const stop = mountGlossary(pane, win);
  for (const wave of ['sine', 'triangle', 'square', 'sawtooth']) {
    assert.equal(pane.querySelector(`#gl-${wave}-wave .gl-demo-link`).getAttribute('href'), `#/learn/sound-wave?wave=${wave}`);
  }
  stop();
});

test('STU-045: the list is grouped by category with counted headings, an Order switch, and the filter hides empty sections', () => {
  const pane = document.createElement('div');
  const win = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
  const stop = mountGlossary(pane, win);
  const heads = () => pane.querySelectorAll('.gl-sec-h').map((h) => h.textContent);
  assert.deepEqual(heads(), ['Physics of sound (27)', 'Perception (6)', 'Music (22)', 'Music theory (32)', 'Instruments (7)', 'Analysis tools (17)', 'Digitizing sound (9)']);
  assert.equal(pane.querySelectorAll('.gl-sec').length, 7);
  assert.equal(pane.querySelectorAll('.gl-chip').length, 7);
  const order = pane.querySelectorAll('.hm-seg').find((g) => g.getAttribute('aria-labelledby') === 'gl-order-label');
  assert.deepEqual(order.querySelectorAll('button').map((b) => b.textContent), ['By category', 'A-Z']);
  assert.equal(order.querySelectorAll('button')[0].getAttribute('aria-checked'), 'true');
  const q = pane.querySelector('.gl-q');
  q.value = 'beating';
  q.dispatchEvent(new Event('input'));
  assert.deepEqual(pane.querySelectorAll('.gl-sec').filter((s) => !s.hidden).map((s) => s.querySelector('.gl-sec-h').textContent), ['Music (1 of 22)', 'Music theory (1 of 32)']);
  assert.deepEqual(pane.querySelectorAll('.gl-chip').filter((b) => !b.hidden).map((b) => b.textContent), ['Music', 'Music theory']);
  q.value = '';
  q.dispatchEvent(new Event('input'));
  order.querySelectorAll('button')[1].click();
  assert.equal(pane.querySelectorAll('.gl-sec').length, 0);
  assert.equal(pane.querySelectorAll('.gl-item').length, TERMS.length);
  assert.equal(pane.querySelector('.gl-jump').hidden, true);
  const names = pane.querySelectorAll('.gl-item dt').map((d) => d.firstChild.textContent);
  assert.deepEqual(names, TERMS.map((t) => t.term));
  stop();
});
