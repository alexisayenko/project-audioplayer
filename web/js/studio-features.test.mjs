import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './test-dom.mjs';

installDom();
const { FEATURES, STATUSES, AREAS, checkFeatures, groupFeatures, isDay } = await import('./studio-features.js');
const { featureItem, featuresSections, mountFeatures, mountHelp, mountAbout, buildLine } = await import('../../studio/help.js');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('STU-051: the features data is valid: required fields, known status and area, a task id that is a task file', () => {
  assert.deepEqual(checkFeatures(), []);
  for (const f of FEATURES) if (f.task) assert.ok(read(`../../docs/tasks/${f.task}.md`).includes(`task_id: ${f.task}`), f.task);
});

test('STU-051: released entries are dated and newest first; planned and in-progress entries have no date', () => {
  const released = FEATURES.filter((f) => f.status === 'released');
  assert.ok(released.length > 0 && released.every((f) => isDay(f.date)));
  assert.deepEqual(released.map((f) => f.date), [...released.map((f) => f.date)].sort().reverse());
  for (const f of FEATURES.filter((x) => x.status !== 'released')) assert.equal(f.date, undefined, f.title);
  assert.ok(FEATURES.filter((f) => f.status === 'planned').length > 0);
  assert.deepEqual([...STATUSES], ['in-progress', 'planned', 'released']);
});

test('STU-051: checkFeatures names each kind of problem', () => {
  const ok = { status: 'released', date: '2026-10-25', area: 'Site', title: 'A' };
  const bad = (f) => checkFeatures([f]).length;
  assert.equal(bad(ok), 0);
  assert.equal(bad({ ...ok, title: ' ' }), 1);
  assert.equal(bad({ ...ok, status: 'done' }), 1);
  assert.equal(bad({ ...ok, area: 'Nowhere' }), 1);
  assert.equal(bad({ ...ok, date: undefined }), 1);
  assert.equal(bad({ ...ok, task: 'task-12' }), 1);
  assert.equal(bad({ status: 'planned', area: 'Site', title: 'P', text: 'x', date: '2026-10-25' }), 1);
  assert.equal(bad({ status: 'planned', area: 'Site', title: 'P' }), 1);
  assert.equal(checkFeatures([ok, { ...ok, date: '2026-10-26' }]).length, 1);
});

test('STU-051: the open Studio tickets are listed with the right status', () => {
  const by = (task) => FEATURES.find((f) => f.task === task && f.status !== 'released');
  for (const t of ['task-0107', 'task-0108', 'task-0109', 'task-0111', 'task-0113']) assert.equal(by(t).status, 'in-progress', t);
  for (const t of ['task-0110', 'task-0112', 'task-0115', 'task-0116', 'task-0117', 'task-0118', 'task-0119']) assert.equal(by(t).status, 'planned', t);
  for (const f of FEATURES.filter((x) => x.task && x.status !== 'released')) {
    const status = /^status: (.*)$/m.exec(read(`../../docs/tasks/${f.task}.md`))[1];
    assert.equal(status.startsWith('in progress') ? 'in-progress' : status.startsWith('to do') ? 'planned' : status, f.status, f.task);
  }
});

test('STU-051: groupFeatures splits by status and groups released entries by date', () => {
  const g = groupFeatures([
    { status: 'planned', title: 'P' }, { status: 'in-progress', title: 'I' },
    { status: 'released', date: '2026-10-25', title: 'R1' }, { status: 'released', date: '2026-10-25', title: 'R2' }, { status: 'released', date: '2026-10-24', title: 'R3' },
  ]);
  assert.deepEqual(g['in-progress'].map((f) => f.title), ['I']);
  assert.deepEqual(g.planned.map((f) => f.title), ['P']);
  assert.deepEqual(g.released.map((d) => [d.date, d.items.map((f) => f.title)]), [['2026-10-25', ['R1', 'R2']], ['2026-10-24', ['R3']]]);
});

test('STU-051: the Features page lists In progress, Planned, then Released with a badge and a task link per entry', () => {
  const pane = document.createElement('div');
  mountFeatures(pane);
  assert.deepEqual([...pane.querySelectorAll('.fx-sec-h')].map((h) => h.textContent.replace(/ \(\d+\)$/, '')), ['In progress', 'Planned', 'Released']);
  assert.equal(pane.querySelectorAll('.fx-item').length, FEATURES.length);
  const days = [...pane.querySelectorAll('.fx-day-h time')].map((t) => t.textContent);
  assert.deepEqual(days, [...days].sort().reverse());
  const item = featureItem(FEATURES.find((f) => f.task === 'task-0110'));
  assert.equal(item.querySelector('.fx-badge').textContent, 'Planned');
  assert.equal(item.querySelector('time'), null);
  assert.equal(item.querySelector('a.fx-task').getAttribute('href'), 'https://github.com/alexisayenko/project-audioplayer/blob/main/docs/tasks/task-0110.md');
  const dated = featureItem(FEATURES.find((f) => f.status === 'released'));
  assert.equal(dated.querySelector('.fx-badge').textContent, 'Released');
  assert.match(dated.querySelector('time').getAttribute('datetime'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(featuresSections([]).length, 0);
});

test('STU-051: Help and About say what the site does and does not do', () => {
  const help = document.createElement('div');
  mountHelp(help);
  assert.match(help.textContent, /nothing is recorded, saved or uploaded/);
  assert.equal(help.querySelector('a[href="#/glossary"]') !== null && help.querySelector('a[href="https://electrophone.cc/"]') !== null, true);
  const about = document.createElement('div');
  mountAbout(about);
  assert.match(about.textContent, /Electrophone Studio by Alex Isayenko/);
  assert.match(about.textContent, /No sign-in, no cookies, no analytics/);
  assert.equal(buildLine({ hash: 'abc1234', date: '2026-10-25' }), 'Build abc1234, 2026-10-25.');
  assert.equal(buildLine(null), '');
  assert.equal(buildLine({ hash: '', date: '2026-10-25' }), '');
});

test('STU-051: every area used is declared', () => {
  assert.ok(FEATURES.every((f) => AREAS.includes(f.area)));
});
