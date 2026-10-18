import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, stubFetch, flush } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { songForm } = await import('./song-form.js');
const { planVersionYear, planRemixYear } = await import('./remix-year.js');

const next = new Date().getFullYear() + 1;
const btn = (f, text) => f.node.querySelectorAll('button').find((b) => b.textContent === text);
const fieldOf = (f, label) => f.node.querySelectorAll('.field').find((d) => d.children[0].textContent === label);
const vy = (f) => fieldOf(f, 'Version year').querySelector('input');
const kind = (f) => f.node.querySelector('select');
const setKind = (f, k) => { kind(f).value = k; fire(kind(f), 'input'); };
const typeVersionYear = (f, v) => { vy(f).value = v; fire(vy(f), 'input'); };
const getMeta = async (f, body) => { stubFetch(() => ({ body })); btn(f, 'Get metadata').click(); await flush(); };

test('planVersionYear: platform year fills an empty field when a version is chosen', () => {
  assert.deepEqual(planVersionYear({ kind: 'remix', name: 'DJ X', current: '', auto: false, published: 2014 }), { value: '2014', auto: true });
  assert.deepEqual(planVersionYear({ kind: 'live', current: '', auto: false, published: 2014 }), { value: '2014', auto: true });
});

test('planVersionYear: a typed value is never overwritten', () => {
  assert.deepEqual(planVersionYear({ kind: 'remix', current: '2020', auto: false, published: 2014, specific: 2019 }), { value: '2020', auto: false });
});

test('planVersionYear: a specific source beats the platform year and replaces an auto value', () => {
  assert.deepEqual(planVersionYear({ kind: 'remix', current: '', auto: false, published: 2014, specific: 2012 }), { value: '2012', auto: true });
  assert.deepEqual(planVersionYear({ kind: 'remix', current: '2014', auto: true, published: 2014, specific: 2012 }), { value: '2012', auto: true });
});

test('planVersionYear: no version means no year; an auto value is dropped, a typed one stays', () => {
  assert.deepEqual(planVersionYear({ kind: '', current: '', auto: false, published: 2014 }), { value: '', auto: false });
  assert.deepEqual(planVersionYear({ kind: '', current: '2014', auto: true, published: 2014 }), { value: '', auto: false });
  assert.deepEqual(planVersionYear({ kind: '', current: '2020', auto: false, published: 2014 }), { value: '2020', auto: false });
});

test('planVersionYear: out-of-range dates are discarded', () => {
  for (const bad of [1899, next + 1, 0, null, 'x']) {
    assert.deepEqual(planVersionYear({ kind: 'remix', current: '', auto: false, published: bad }), { value: '', auto: false });
  }
  assert.deepEqual(planVersionYear({ kind: 'remix', current: '', auto: false, published: next }), { value: String(next), auto: true });
  assert.deepEqual(planVersionYear({ kind: 'remix', current: '', auto: false, published: 1899, specific: 2001 }), { value: '2001', auto: true });
});

test('planRemixYear stays as an alias driven by the remixer text', () => {
  assert.deepEqual(planRemixYear({ remixer: 'DJ X', current: '', auto: false, published: 2014 }), { value: '2014', auto: true });
  assert.deepEqual(planRemixYear({ remixer: ' ', current: '', auto: false, published: 2014 }), { value: '', auto: false });
});

test('add form: a legacy remixer and published_year fill Version year, marked as a suggestion, First released untouched', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 2014, year: 2001, tags: [] } });
  assert.equal(f.values().version.type, 'remix');
  assert.equal(String(f.values().version.releaseYear), '2014');
  assert.equal(String(f.values().releaseYear), '2001');
  assert.ok(vy(f).classList.contains('suggested'));
});

test('add form: no version leaves Version year empty', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', published_year: 2014, tags: [] } });
  assert.equal(f.values().version, null);
  assert.equal(vy(f).value, '');
  assert.ok(!vy(f).classList.contains('suggested'));
});

test('add form: published_year never reaches First released', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', published_year: 2014, tags: [] } });
  assert.equal(f.values().releaseYear, '');
  setKind(f, 'remix');
  assert.equal(f.values().releaseYear, '');
  assert.equal(String(f.values().version.releaseYear), '2014');
});

test('add form: choosing a version suggests the year, clearing it removes the suggestion', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', published_year: 2014, tags: [] } });
  setKind(f, 'live');
  assert.equal(String(f.values().version.releaseYear), '2014');
  assert.ok(vy(f).classList.contains('suggested'));
  setKind(f, '');
  assert.equal(f.values().version, null);
  assert.equal(vy(f).value, '');
  assert.ok(!vy(f).classList.contains('suggested'));
});

test('add form: a typed version year is kept and survives clearing the version', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 2014, tags: [] } });
  typeVersionYear(f, '2020');
  assert.ok(!vy(f).classList.contains('suggested'));
  setKind(f, '');
  assert.equal(vy(f).value, '2020');
  setKind(f, 'edit');
  assert.equal(String(f.values().version.releaseYear), '2020');
});

test('add form: a user who cleared the field is not re-suggested', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 2014, tags: [] } });
  typeVersionYear(f, '');
  setKind(f, '');
  setKind(f, 'remix');
  assert.equal(f.values().version.releaseYear, '');
});

test('add form: an out-of-range published year is ignored', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 1850, tags: [] } });
  assert.equal(f.values().version.releaseYear, '');
});

test('Get metadata: a version-specific date beats the platform year', async () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 2014, tags: [] } });
  await getMeta(f, { year: 2001, published_year: 2014, version_year: 2012 });
  assert.equal(String(f.values().version.releaseYear), '2012');
  assert.equal(String(f.values().releaseYear), '2001');
});

test('Get metadata: remix_year from an older server still works', async () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 2014, tags: [] } });
  await getMeta(f, { published_year: 2014, remix_year: 2012 });
  assert.equal(String(f.values().version.releaseYear), '2012');
});

test('Get metadata: a typed value is never changed on re-fetch', async () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X Remix', published_year: 2014, tags: [] } });
  typeVersionYear(f, '2020');
  await getMeta(f, { published_year: 2014, version_year: 2012 });
  assert.equal(String(f.values().version.releaseYear), '2020');
});

test('Get metadata: a year from lookups fills an empty First released, a typed one is kept', async () => {
  const f = songForm({ mode: 'add', song: { title: 'T', tags: [] } });
  await getMeta(f, { year: 1993, published_year: 2014 });
  assert.equal(String(f.values().releaseYear), '1993');
  const g = songForm({ mode: 'add', song: { title: 'T', year: 1990, tags: [] } });
  await getMeta(g, { year: 1993 });
  assert.equal(String(g.values().releaseYear), '1990');
});

test('edit dialog: empty version year with a version is filled from the fetched publish year', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', mainArtists: ['A'], featuredArtists: [], releaseYear: null, version: { type: 'remix', name: 'DJ X Remix', artists: [], releaseYear: null }, tags: [] } });
  assert.equal(f.values().version.releaseYear, '');
  await getMeta(f, { published_year: 2016 });
  assert.equal(String(f.values().version.releaseYear), '2016');
  assert.ok(vy(f).classList.contains('suggested'));
});

test('edit dialog: a stored version year is kept', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', mainArtists: ['A'], featuredArtists: [], version: { type: 'remix', name: 'R', artists: [], releaseYear: 2009 }, tags: [] } });
  await getMeta(f, { published_year: 2016, version_year: 2012 });
  assert.equal(String(f.values().version.releaseYear), '2009');
});

test('edit dialog: no version, no version year from a fetch', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', mainArtists: ['A'], featuredArtists: [], tags: [] } });
  await getMeta(f, { published_year: 2016, year: 2016 });
  assert.equal(f.values().version, null);
});

test('reset drops a suggestion', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', mainArtists: ['A'], featuredArtists: [], version: { type: 'remix', name: 'R', artists: [], releaseYear: null }, tags: [] } });
  await getMeta(f, { published_year: 2016 });
  f.reset();
  assert.equal(f.values().version.releaseYear, '');
});

test('add form: a preview version_year (remaster year in the title) is the marked suggestion and beats the upload year', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: '2011 Remaster', version_year: 2011, published_year: 2019, tags: [] } });
  assert.equal(kind(f).value, 'remaster');
  assert.equal(vy(f).value, '2011');
  assert.ok(vy(f).classList.contains('suggested'));
  assert.equal(f.values().releaseYear, '');
});

test('add form: a preview version without version_year keeps the upload-year suggestion', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'Slowed', published_year: 2019, tags: [] } });
  assert.equal(kind(f).value, 'other');
  assert.equal(vy(f).value, '2019');
  assert.ok(vy(f).classList.contains('suggested'));
});
