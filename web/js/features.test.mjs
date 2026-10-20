import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch, flush, fire } from './test-dom.mjs';

installDom();
const { renderFeatures, loadFeatures, releaseBlock, TASK_URL, PAGE_SIZE, FAIL_TEXT, NO_RELEASES, NO_PLANNED, TAB_KEY, UNAVAILABLE } = await import('./features.js');

const rel = (n) => ({ hash: `abc${String(n).padStart(4, '0')}`, full: `abc${String(n).padStart(4, '0')}${'0'.repeat(33)}`, date: `2026-01-${String(n % 28 + 1).padStart(2, '0')}`, items: [{ text: `Feature ${n}`, task: n % 2 ? 'task-0061' : null }] });
const DATA = {
  releases: [
    { hash: '1111111', full: '1'.repeat(40), date: '2026-10-18', items: [{ text: 'Older', task: null }] },
    { hash: '2222222', full: '2'.repeat(40), date: '2026-10-20', items: [{ text: 'Newer one', task: 'task-0063' }, { text: 'No task here', task: null }] },
  ],
  planned: [
    { id: 'task-0010', title: 'Old plan', tags: ['ios'], status: 'to do' },
    { id: 'task-0067', title: 'New plan', tags: ['web', 'audio'], status: 'in progress' },
  ],
};

async function mount(body, status = 200) {
  stubFetch(async () => ({ status, body }));
  globalThis.localStorage?.removeItem?.(TAB_KEY);
  const root = document.createElement('div');
  renderFeatures(root);
  await flush();
  return root;
}
const tab = (root, i) => root.querySelectorAll('[role="tab"]')[i];

test('releases tab: newest on top, hash, date without time, task link', async () => {
  const root = await mount(DATA);
  const blocks = root.querySelectorAll('.ft-rel');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].querySelector('.ft-hash').textContent, '2222222');
  assert.equal(blocks[0].querySelector('.ft-hash').getAttribute('title'), '2'.repeat(40));
  const time = blocks[0].querySelector('time');
  assert.equal(time.textContent, '2026-10-20');
  assert.equal(time.getAttribute('datetime'), '2026-10-20');
  assert.equal(blocks[1].querySelector('time').textContent, '2026-10-18');
  assert.equal(root.querySelector('ol.ft-list') !== null && root.querySelector('ul.ft-items') !== null, true);
});

test('a task link opens the task file on GitHub in a new tab; no task, no link', async () => {
  const root = await mount(DATA);
  const items = root.querySelectorAll('.ft-rel')[0].querySelectorAll('.ft-item');
  const a = items[0].querySelector('a');
  assert.equal(a.getAttribute('href'), `${TASK_URL}task-0063.md`);
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener');
  assert.equal(items[1].querySelector('a'), null);
  assert.ok(items[0].textContent.startsWith('Newer one'));
});

test('date with a time part is cut to the day', async () => {
  const data = await loadFeatures(async () => ({ ok: true, json: async () => ({ releases: [{ ...DATA.releases[0], date: '2026-10-18T22:30:00Z' }], planned: [] }) }));
  assert.equal(data.releases[0].date, '2026-10-18');
  assert.equal(releaseBlock(data.releases[0]).querySelector('time').textContent, '2026-10-18');
});

test('planned tab: newest task id first, title, id, tags, link', async () => {
  const root = await mount(DATA);
  tab(root, 1).click();
  const rows = root.querySelectorAll('.ft-plan');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.ft-ptitle').textContent, 'New plan');
  assert.equal(rows[0].querySelector('a').textContent, 'task-0067');
  assert.equal(rows[0].querySelector('a').getAttribute('href'), `${TASK_URL}task-0067.md`);
  assert.deepEqual([...rows[0].querySelectorAll('.ft-tag')].map((n) => n.textContent), ['web', 'audio']);
  assert.equal(rows[1].querySelector('a').textContent, 'task-0010');
});

test('tabs: roles, aria-selected, arrow keys, the last tab is remembered', async () => {
  const root = await mount(DATA);
  assert.equal(root.querySelector('[role="tablist"]') !== null, true);
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
  assert.equal(tab(root, 1).getAttribute('aria-selected'), 'false');
  fire(tab(root, 0), 'keydown', { key: 'ArrowRight' });
  assert.equal(tab(root, 1).getAttribute('aria-selected'), 'true');
  assert.equal(tab(root, 1).tabIndex, 0);
  assert.equal(tab(root, 0).tabIndex, -1);
  assert.ok(root.querySelector('.ft-plan'));
  assert.equal(globalThis.localStorage.getItem(TAB_KEY), 'planned');
  fire(tab(root, 1), 'keydown', { key: 'ArrowRight' });
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
  fire(tab(root, 0), 'keydown', { key: 'End' });
  assert.equal(tab(root, 1).getAttribute('aria-selected'), 'true');
  fire(tab(root, 1), 'keydown', { key: 'Home' });
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
  globalThis.localStorage.setItem(TAB_KEY, 'planned');
  const again = document.createElement('div');
  renderFeatures(again);
  await flush();
  assert.equal(tab(again, 1).getAttribute('aria-selected'), 'true');
});

test('show older reveals the next page; the button goes away at the end', async () => {
  const many = { releases: Array.from({ length: 65 }, (_, i) => rel(i)), planned: [] };
  const root = await mount(many);
  assert.equal(root.querySelectorAll('.ft-rel').length, PAGE_SIZE);
  const more = root.querySelector('.ft-more');
  assert.equal(more.hidden, false);
  more.click();
  assert.equal(root.querySelectorAll('.ft-rel').length, 60);
  more.click();
  assert.equal(root.querySelectorAll('.ft-rel').length, 65);
  assert.equal(more.hidden, true);
});

test('loading, error and empty states are inline', async () => {
  stubFetch(() => new Promise(() => {}));
  const slow = document.createElement('div');
  renderFeatures(slow);
  assert.equal(slow.querySelector('[role="tabpanel"]').textContent, 'Loading...');
  assert.equal((await mount({}, 500)).querySelector('[role="tabpanel"]').textContent, FAIL_TEXT);
  assert.equal((await mount({ releases: [], planned: [] })).querySelector('[role="tabpanel"]').textContent, NO_RELEASES);
  const empty = await mount({ releases: [], planned: [] });
  tab(empty, 1).click();
  assert.equal(empty.querySelector('[role="tabpanel"]').textContent, NO_PLANNED);
});

test('the data comes from the server route and an unavailable history says so, planned still works', async () => {
  globalThis.localStorage?.removeItem?.(TAB_KEY);
  const calls = stubFetch(async () => ({ body: { releases: [], planned: DATA.planned, unavailable: true } }));
  const root = document.createElement('div');
  renderFeatures(root);
  await flush();
  assert.equal(calls[0].url, 'features/data');
  assert.equal(root.querySelector('[role="tabpanel"]').textContent, UNAVAILABLE);
  tab(root, 1).click();
  assert.equal(root.querySelectorAll('.ft-plan').length, 2);
});
