import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { TERMS, termById, filterTerms } = await import('./glossary-terms.js');
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
