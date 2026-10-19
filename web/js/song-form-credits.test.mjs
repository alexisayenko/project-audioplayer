import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, stubFetch } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { songForm } = await import('./song-form.js');
const { initialCredits, kindFor } = await import('./song-form-credits.js');

const mk = (song = {}, mode = 'edit') => songForm({ mode, song: { id: 's1', title: 'T', tags: [], ...song } });
const fieldOf = (f, label) => f.node.querySelectorAll('.field').find((d) => d.children[0].textContent === label);
const input = (f, label) => fieldOf(f, label).querySelector('input');
const kind = (f) => f.node.querySelector('select');
const setKind = (f, k) => { kind(f).value = k; fire(kind(f), 'input'); };
const type = (el, v) => { el.value = v; fire(el, 'input'); };
const pills = (f, label) => f.node.querySelectorAll('.token-field').find((n) => n.getAttribute('aria-label') === label).querySelectorAll('.token-text').map((n) => n.textContent);
const preview = (f) => f.node.querySelector('.credits-preview');
const panel = (f) => f.node.querySelector('.credits-suggest');
const rowBtn = (f, row, text) => panel(f).querySelectorAll('.credits-suggest-row')[row].querySelectorAll('button').find((b) => b.textContent === text);
const warn = (f) => f.node.querySelector('.credits-warn');

test('the form has every credits field with its label', () => {
  const f = mk({ mainArtists: ['A'], featuredArtists: [] });
  for (const label of ['Title', 'Artists', 'Featuring', 'With', 'Version', 'Version name', 'Version by', 'Remix year', 'Cover of', 'First released']) {
    assert.ok(fieldOf(f, label), label);
  }
  assert.deepEqual([...kind(f).querySelectorAll('option')].map((o) => o.value), ['', 'remix', 'live', 'acoustic', 'extended', 'instrumental', 'remaster', 'edit', 'cover', 'mashup', 'other']);
});

test('Artists, Featuring and Remix by are pill fields', () => {
  const f = mk({ mainArtists: ['A', 'B'], featuredArtists: ['C'], version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso', 'X'], releaseYear: null } });
  assert.deepEqual(pills(f, 'Artists'), ['A', 'B']);
  assert.deepEqual(pills(f, 'Featuring'), ['C']);
  assert.deepEqual(pills(f, 'Remix by'), ['Alesso', 'X']);
  assert.deepEqual(f.values().mainArtists, ['A', 'B']);
  assert.deepEqual(f.values().version.artists, ['Alesso', 'X']);
});

test('without a version the version details are hidden and values().version is null', () => {
  const f = mk({ mainArtists: ['A'], featuredArtists: [] });
  assert.equal(fieldOf(f, 'Version name').hidden, true);
  assert.equal(fieldOf(f, 'Version by').parentNode.hidden, true);
  setKind(f, 'remix');
  assert.equal(fieldOf(f, 'Version name').hidden, false);
  assert.equal(fieldOf(f, 'Remix by').parentNode.hidden, false);
  setKind(f, '');
  assert.equal(f.values().version, null);
});

test('Cover of shows only for Cover and is dropped when leaving Cover', () => {
  const f = mk({ mainArtists: ['B'], featuredArtists: [] });
  assert.equal(fieldOf(f, 'Cover of').hidden, true);
  setKind(f, 'cover');
  assert.equal(fieldOf(f, 'Cover of').hidden, false);
  type(input(f, 'Cover of'), 'Artist A');
  assert.deepEqual(f.values().version.originalArtists, ['Artist A']);
  setKind(f, 'live');
  assert.equal(fieldOf(f, 'Cover of').hidden, true);
  assert.ok(!('originalArtists' in f.values().version));
  setKind(f, 'cover');
  assert.deepEqual(f.values().version.originalArtists, ['Artist A'], 'text is kept in the field and sent for covers');
});

test('the preview line is the display line and follows the fields', () => {
  const f = mk({ title: 'Song', mainArtists: ['A', 'B'], featuredArtists: ['C'] });
  assert.equal(preview(f).textContent, 'A & B feat. C - Song');
  setKind(f, 'remix');
  type(input(f, 'Version name'), 'Alesso Remix');
  assert.equal(preview(f).textContent, 'A & B feat. C - Song (Alesso Remix)');
  setKind(f, 'cover');
  type(input(f, 'Version name'), '');
  assert.equal(preview(f).textContent, 'A & B feat. C - Song (cover)');
});

test('Suggested split offers the split of the current text, never applies it by itself', () => {
  const f = mk({ mainArtists: ['Martin Garrix & Tiesto'], featuredArtists: [] });
  assert.equal(panel(f).hidden, false);
  assert.match(panel(f).textContent, /Suggested split/);
  assert.match(panel(f).textContent, /Artists: Martin Garrix \| Tiesto/);
  assert.deepEqual(f.values().mainArtists, ['Martin Garrix & Tiesto'], 'nothing changes until Apply');
  rowBtn(f, 0, 'Apply').click();
  assert.deepEqual(f.values().mainArtists, ['Martin Garrix', 'Tiesto']);
  assert.equal(panel(f).hidden, true, 'nothing left to suggest');
});

test('Suggested split: Dismiss hides one suggestion and keeps the text', () => {
  const f = mk({ mainArtists: ['A, B'], featuredArtists: [] });
  assert.equal(panel(f).hidden, false);
  rowBtn(f, 0, 'Dismiss').click();
  assert.equal(panel(f).hidden, true);
  assert.deepEqual(f.values().mainArtists, ['A, B']);
});

test('Suggested split: featuring in the artist moves to Featuring, version suggestion fills by, in one row', () => {
  const f = mk({ mainArtists: ['Kato feat. Jon'], featuredArtists: [], version: { type: 'remix', name: 'Alesso Remix', artists: [], releaseYear: null } });
  const rows = panel(f).querySelectorAll('.credits-suggest-row');
  assert.equal(rows.length, 1, 'one parse, one row');
  assert.equal(rows[0].querySelector('span').textContent, 'Artists: Kato \u00b7 Featuring: Jon \u00b7 Version: by Alesso');
  rowBtn(f, 0, 'Apply').click();
  const v = f.values();
  assert.deepEqual(v.mainArtists, ['Kato']);
  assert.deepEqual(v.featuredArtists, ['Jon']);
  assert.deepEqual(v.version.artists, ['Alesso']);
  assert.equal(v.version.name, 'Alesso Remix', 'the credited text is untouched');
  assert.equal(panel(f).hidden, true);
});

test('Suggested split is recomputed from the current field text', () => {
  const f = mk({ mainArtists: ['Solo'], featuredArtists: [] });
  assert.equal(panel(f).hidden, true);
  type(input(f, 'Version name'), 'x');
  f.setValues({ mainArtists: ['A x B'] });
  assert.equal(panel(f).hidden, false);
  assert.match(panel(f).textContent, /Artists: A \| B/);
});

test('Suggested split: a feat. credit in the title offers to move it, title text is the only change', () => {
  const f = mk({ title: 'Song (feat. Jon)', mainArtists: ['A'], featuredArtists: [] });
  assert.equal(panel(f).querySelectorAll('.credits-suggest-row').length, 1);
  assert.equal(panel(f).querySelector('.credits-suggest-row span').textContent, 'Title: Song \u00b7 Featuring: Jon');
  rowBtn(f, 0, 'Apply').click();
  assert.equal(f.values().title, 'Song');
  assert.deepEqual(f.values().featuredArtists, ['Jon'], 'Apply sets every field of the row');
  assert.equal(panel(f).hidden, true);
});

test('Suggested split: Dismiss drops the whole combined row and nothing is applied', () => {
  const f = mk({ title: 'In The End (feat. Fleurie)', mainArtists: ['A'], featuredArtists: [] });
  assert.equal(panel(f).querySelector('.credits-suggest-row span').textContent, 'Title: In The End \u00b7 Featuring: Fleurie');
  rowBtn(f, 0, 'Dismiss').click();
  assert.equal(panel(f).hidden, true);
  assert.equal(f.values().title, 'In The End (feat. Fleurie)');
  assert.deepEqual(f.values().featuredArtists, []);
});

test('Suggested split: the cover readings stay separate rows, one per reading', () => {
  const f = mk({ title: 'A - Song', mainArtists: [], featuredArtists: [], version: { type: 'cover', name: 'B Cover', artists: [], releaseYear: null } });
  const rows = panel(f).querySelectorAll('.credits-suggest-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /^Reading 1:/);
  assert.match(rows[1].textContent, /^Reading 2:/);
  rowBtn(f, 1, 'Apply').click();
  assert.equal(f.values().version.type, 'cover');
  assert.equal(f.values().title, 'Song');
});

test('With is a pill field: loaded from the song, edited, sent, and part of the preview line', () => {
  const f = mk({ title: 'T', mainArtists: ['A'], featuredArtists: ['C'], withArtists: ['W', 'X'] });
  assert.deepEqual(pills(f, 'With'), ['W', 'X']);
  assert.deepEqual(f.values().withArtists, ['W', 'X']);
  assert.equal(preview(f).textContent, 'A feat. C with W & X - T');
  f.setValues({ withArtists: ['Z'] });
  assert.deepEqual(f.values().withArtists, ['Z']);
  f.reset();
  assert.deepEqual(f.values().withArtists, ['W', 'X']);
  assert.deepEqual(mk({ mainArtists: ['A'], featuredArtists: [] }).values().withArtists, []);
});

test('Add preview data fills the credit fields and keeps the version of the preview text', () => {
  const f = mk({ title: 'T', artist: 'A feat. C', mainArtists: ['A'], featuredArtists: ['C'], withArtists: ['W'], remixer: 'Foo Remix', year: null }, 'add');
  assert.deepEqual(pills(f, 'Artists'), ['A']);
  assert.deepEqual(pills(f, 'Featuring'), ['C']);
  assert.deepEqual(pills(f, 'With'), ['W']);
  assert.equal(f.values().version.type, 'remix');
  assert.equal(f.values().version.name, 'Foo Remix');
});

test('add mode: a pasted title with a feat or with group moves it to the fields and Restore puts it back', () => {
  const f = mk({ title: 'T', mainArtists: ['A'], featuredArtists: [] }, 'add');
  const title = f.node.querySelectorAll('.token-field').find((n) => n.getAttribute('aria-label') === 'Title');
  title.querySelector('.token-entry').value = '';
  f.setValues({ title: 'Go (feat. Q-Tip) (with Bob)' });
  fire(title, 'focusout');
  assert.equal(f.values().title, 'Go');
  assert.deepEqual(f.values().featuredArtists, ['Q-Tip']);
  assert.deepEqual(f.values().withArtists, ['Bob']);
  const restore = f.node.querySelectorAll('button').find((b) => b.textContent === 'Restore');
  restore.click();
  assert.equal(f.values().title, 'Go (feat. Q-Tip) (with Bob)');
  assert.deepEqual(f.values().featuredArtists, []);
  assert.deepEqual(f.values().withArtists, []);
});

test('warning when a Remix by name is not in the Version name; never blocks', () => {
  const f = mk({ mainArtists: ['A'], featuredArtists: [], version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'], releaseYear: null } });
  assert.equal(warn(f).hidden, true);
  f.setValues({ version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso', 'Nobody'], releaseYear: null } });
  assert.equal(warn(f).hidden, false);
  assert.match(warn(f).textContent, /"Nobody"/);
  assert.ok(!/"Alesso"/.test(warn(f).textContent));
  assert.equal(f.values().version.artists.length, 2, 'values are still returned');
});

test('no warning without a version name or without by names', () => {
  const f = mk({ mainArtists: ['A'], featuredArtists: [], version: { type: 'remix', name: null, artists: ['Alesso'], releaseYear: null } });
  assert.equal(warn(f).hidden, true);
  f.setValues({ version: { type: 'remix', name: 'Alesso Remix', artists: [], releaseYear: null } });
  assert.equal(warn(f).hidden, true);
});

test('legacy songs are mapped: artist string to pills, remixer to a version, years kept', () => {
  assert.deepEqual(initialCredits({ artist: 'A - B', remixer: 'Mixed By DJ Gvozd', remix_year: 2012, year: 2000 }), { mainArtists: ['A', 'B'], featuredArtists: [], withArtists: [], version: { type: 'other', name: 'Mixed By DJ Gvozd', artists: [], releaseYear: 2012 }, releaseYear: 2000 });
  assert.equal(kindFor('Alesso Remix'), 'remix');
  assert.equal(kindFor('Mixed By X'), 'other');
  assert.equal(kindFor('Mixed By X Remix'), 'remix');
  assert.deepEqual(initialCredits({ artist: 'A', remix_year: 2012 }).version, { type: 'other', name: null, artists: [], releaseYear: 2012 });
  assert.equal(initialCredits({ artist: 'A' }).version, null);
});

test('First released sits beside Album and is empty when nothing gave a year', () => {
  const f = mk({ mainArtists: ['A'], featuredArtists: [] }, 'add');
  assert.equal(input(f, 'First released').value, '');
  assert.equal(f.values().releaseYear, '');
});

test('Suggested split words a cover as Cover of the original or Cover performed by the performer', () => {
  const a = mk({ title: 'Crazy (Gnarls Barkley Cover)', mainArtists: ['Teemid'], featuredArtists: [] });
  assert.match(panel(a).textContent, /Cover of Gnarls Barkley/);
  const b = mk({ title: 'Writings On The Wall (Sofia Karlberg Cover)', mainArtists: ['Sofia Karlberg'], featuredArtists: [] });
  assert.match(panel(b).textContent, /Cover performed by Sofia Karlberg/);
});

test('Mashup of: context-aware label, several source pills, shown only for Cover and Mashup', () => {
  const f = mk({ title: 'Song', mainArtists: ['Maker'], featuredArtists: [], version: { type: 'mashup', name: null, artists: [], releaseYear: null, originalArtists: ['S1', 'S2'] } });
  assert.equal(fieldOf(f, 'Mashup of').hidden, false);
  assert.deepEqual(pills(f, 'Mashup of'), ['S1', 'S2']);
  assert.deepEqual(f.values().version.originalArtists, ['S1', 'S2']);
  assert.equal(preview(f).textContent, 'Maker - Song (mashup)');
  setKind(f, 'cover');
  assert.ok(fieldOf(f, 'Cover of'));
  setKind(f, 'live');
  assert.equal(fieldOf(f, 'Cover of').hidden, true);
  assert.ok(!('originalArtists' in f.values().version));
});

test('a legacy string of loads as a pill', () => {
  const f = mk({ mainArtists: ['B'], featuredArtists: [], version: { type: 'cover', name: null, artists: [], releaseYear: null, originalArtists: 'Orig' } });
  assert.deepEqual(pills(f, 'Cover of'), ['Orig']);
});

test('mashup suggestion asks who made it and applies nothing by itself', () => {
  const f = mk({ title: 'Кончится лето - Yaukoshi, LXST CXNTURY, Цой (mashup)', mainArtists: ['Repost Channel'], featuredArtists: [] });
  assert.match(panel(f).textContent, /Who made this mashup\? Confirm or edit Artists; sources go in Mashup of/);
  assert.match(panel(f).textContent, /Artists: Yaukoshi \| LXST CXNTURY \| Цой/);
  assert.deepEqual(f.values().mainArtists, ['Repost Channel']);
  assert.equal(f.values().version, null);
});

test('kindFor reads the known version words of the preview text', () => {
  assert.equal(kindFor('Special Extended Version'), 'extended');
  assert.equal(kindFor('Slowed'), 'other');
  assert.equal(kindFor('Sped Up'), 'other');
  assert.equal(kindFor('Live at Wembley'), 'live');
  assert.equal(kindFor('2011 Remaster'), 'remaster');
  assert.equal(kindFor('Foo Cover'), 'cover');
  assert.equal(kindFor('Moreno J Remix'), 'remix');
  assert.equal(kindFor('Something else'), 'remix');
});

test('the version artists label and aria-label follow the Version type live', () => {
  const want = { remix: 'Remix by', remaster: 'Remaster by', edit: 'Edit by', live: 'Live by', acoustic: 'Acoustic by', extended: 'Extended by', instrumental: 'Instrumental by', mashup: 'Mashup by', cover: 'Cover by', other: 'Version by' };
  const f = mk({ mainArtists: ['A'], featuredArtists: [], version: { type: 'remix', name: 'R', artists: ['X'], releaseYear: null } });
  for (const [k, label] of Object.entries(want)) {
    setKind(f, k);
    assert.ok(fieldOf(f, label), label);
    assert.equal(f.node.querySelectorAll('.field').filter((d) => /^(Remix|Remaster|Edit|Live|Acoustic|Extended|Instrumental|Mashup|Cover|Version) by$/.test(d.children[0].textContent)).length, 1, label);
    assert.deepEqual(pills(f, label), ['X'], label);
  }
  setKind(f, '');
  assert.ok(fieldOf(f, 'Version by'));
});

test('an existing remaster opens with Remaster by', () => {
  const f = mk({ mainArtists: ['A'], featuredArtists: [], version: { type: 'remaster', name: 'Remastered', artists: ['M'], releaseYear: 2011 } });
  assert.ok(fieldOf(f, 'Remaster by'));
  assert.equal(fieldOf(f, 'Remix by'), undefined);
});
