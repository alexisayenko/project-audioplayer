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
    if (t.demo) assert.ok(PAGES.some((p) => p.id === t.demo.page), `${t.id} demo ${t.demo.page}`);
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
  assert.ok(PAGES.some((p) => p.id === 'glossary' && p.group === 'Reference' && p.hash === '#/glossary'));
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
