import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, stubFetch, flush } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { songForm } = await import('./song-form.js');
const { planRemixYear } = await import('./remix-year.js');

const next = new Date().getFullYear() + 1;
const btn = (f, text) => f.node.querySelectorAll('button').find((b) => b.textContent === text);
const remixer = (f) => f.node.querySelector('.remix-row').querySelector('.field').children[1];
const ry = (f) => f.node.querySelector('.remix-row').querySelectorAll('input').find((i) => i.type === 'number');
const setRemixer = (f, text) => { remixer(f).value = text; fire(remixer(f), 'input'); };
const typeRemixYear = (f, v) => { ry(f).value = v; fire(ry(f), 'input'); };
const getMeta = async (f, body) => { stubFetch(() => ({ body })); btn(f, 'Get metadata').click(); await flush(); };

test('planRemixYear: platform year fills an empty field when a remix is named', () => {
  assert.deepEqual(planRemixYear({ remixer: 'DJ X', current: '', auto: false, published: 2014 }), { value: '2014', auto: true });
});

test('planRemixYear: a typed value is never overwritten', () => {
  assert.deepEqual(planRemixYear({ remixer: 'DJ X', current: '2020', auto: false, published: 2014, specific: 2019 }), { value: '2020', auto: false });
});

test('planRemixYear: a specific source beats the platform year and replaces an auto value', () => {
  assert.deepEqual(planRemixYear({ remixer: 'DJ X', current: '', auto: false, published: 2014, specific: 2012 }), { value: '2012', auto: true });
  assert.deepEqual(planRemixYear({ remixer: 'DJ X', current: '2014', auto: true, published: 2014, specific: 2012 }), { value: '2012', auto: true });
});

test('planRemixYear: no remix means no year; an auto value is dropped, a typed one stays', () => {
  assert.deepEqual(planRemixYear({ remixer: '  ', current: '', auto: false, published: 2014 }), { value: '', auto: false });
  assert.deepEqual(planRemixYear({ remixer: '', current: '2014', auto: true, published: 2014 }), { value: '', auto: false });
  assert.deepEqual(planRemixYear({ remixer: '', current: '2020', auto: false, published: 2014 }), { value: '2020', auto: false });
});

test('planRemixYear: out-of-range dates are discarded', () => {
  for (const bad of [1899, next + 1, 0, null, 'x']) {
    assert.deepEqual(planRemixYear({ remixer: 'R', current: '', auto: false, published: bad }), { value: '', auto: false });
  }
  assert.deepEqual(planRemixYear({ remixer: 'R', current: '', auto: false, published: next }), { value: String(next), auto: true });
  assert.deepEqual(planRemixYear({ remixer: 'R', current: '', auto: false, published: 1899, specific: 2001 }), { value: '2001', auto: true });
});

test('add form: prefilled remixer and published_year fill the field, marked as a suggestion', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X', published_year: 2014, year: 2014, tags: [] } });
  assert.equal(String(f.values().remix_year), '2014');
  assert.equal(String(f.values().year), '2014', 'year is unchanged');
  assert.ok(ry(f).classList.contains('suggested'));
});

test('add form: no remixer leaves the remix year empty', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', published_year: 2014, tags: [] } });
  assert.equal(f.values().remix_year, '');
  assert.ok(!ry(f).classList.contains('suggested'));
});

test('add form: typing a remixer suggests the year, clearing it removes the suggestion', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', published_year: 2014, tags: [] } });
  setRemixer(f, 'DJ X Remix');
  assert.equal(String(f.values().remix_year), '2014');
  setRemixer(f, '');
  assert.equal(f.values().remix_year, '');
  assert.ok(!ry(f).classList.contains('suggested'));
});

test('add form: a typed remix year is kept and survives clearing the remix', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X', published_year: 2014, tags: [] } });
  typeRemixYear(f, '2020');
  assert.ok(!ry(f).classList.contains('suggested'));
  setRemixer(f, '');
  assert.equal(String(f.values().remix_year), '2020');
  setRemixer(f, 'Other');
  assert.equal(String(f.values().remix_year), '2020');
});

test('add form: a user who cleared the field is not re-suggested', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X', published_year: 2014, tags: [] } });
  typeRemixYear(f, '');
  setRemixer(f, 'Other');
  assert.equal(f.values().remix_year, '');
});

test('add form: an out-of-range published year is ignored', () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X', published_year: 1850, tags: [] } });
  assert.equal(f.values().remix_year, '');
});

test('Get metadata: a remix-specific date beats the platform year', async () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X', published_year: 2014, tags: [] } });
  await getMeta(f, { year: 2001, published_year: 2014, remix_year: 2012 });
  assert.equal(String(f.values().remix_year), '2012');
  assert.equal(String(f.values().year), '2001');
});

test('Get metadata: a typed value is never changed on re-fetch', async () => {
  const f = songForm({ mode: 'add', song: { title: 'T', remixer: 'DJ X', published_year: 2014, tags: [] } });
  typeRemixYear(f, '2020');
  await getMeta(f, { published_year: 2014, remix_year: 2012 });
  assert.equal(String(f.values().remix_year), '2020');
});

test('edit dialog: empty remix_year with a remix is filled from the fetched publish year', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', remixer: 'DJ X', remix_year: null, tags: [] } });
  assert.equal(f.values().remix_year, '');
  await getMeta(f, { published_year: 2016 });
  assert.equal(String(f.values().remix_year), '2016');
  assert.ok(ry(f).classList.contains('suggested'));
});

test('edit dialog: a stored remix_year is kept', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', remixer: 'DJ X', remix_year: 2009, tags: [] } });
  await getMeta(f, { published_year: 2016, remix_year: 2012 });
  assert.equal(String(f.values().remix_year), '2009');
});

test('edit dialog: no remixer, no remix year from a fetch', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', tags: [] } });
  await getMeta(f, { published_year: 2016, year: 2016 });
  assert.equal(f.values().remix_year, '');
});

test('reset drops a suggestion', async () => {
  const f = songForm({ mode: 'edit', song: { id: 's1', title: 'T', remixer: 'DJ X', tags: [] } });
  await getMeta(f, { published_year: 2016 });
  f.reset();
  assert.equal(f.values().remix_year, '');
});
