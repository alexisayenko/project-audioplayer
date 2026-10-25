import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch, flush, fire } from './test-dom.mjs';

installDom();
const { renderFeatures, loadFeatures, releaseBlock, groupDays, TASK_URL, PAGE_SIZE, FAIL_TEXT, NO_RELEASES, NO_PLANNED, NO_PROGRESS, TAB_KEY, UNAVAILABLE } = await import('./features.js');

const rel = (n) => ({ hash: `abc${String(n).padStart(4, '0')}`, full: `abc${String(n).padStart(4, '0')}${'0'.repeat(33)}`, date: `2026-01-${String(n % 28 + 1).padStart(2, '0')}`, items: [{ text: `Feature ${n}`, task: n % 2 ? 'task-0061' : null }] });
const DATA = {
  releases: [
    { hash: '2222222', full: '2'.repeat(40), date: '2026-10-20', items: [{ text: 'Newer one', task: 'task-0063' }, { text: 'No task here', task: null }] },
    { hash: '1111111', full: '1'.repeat(40), date: '2026-10-18', items: [{ text: 'Older', task: null }] },
  ],
  planned: [
    { id: 'task-0010', title: 'Old plan', tags: ['ios'], status: 'to do' },
    { id: 'task-0070', title: 'New plan', tags: ['web', 'audio'], status: 'to do' },
  ],
  in_progress: [
    { id: 'task-0067', title: 'Doing it', tags: ['web'], status: 'in progress' },
    { id: 'task-0068', title: 'Doing more', tags: [], status: 'in progress' },
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
  assert.equal(blocks[0].querySelector('.ft-hash'), null);
  const days = root.querySelectorAll('.ft-day');
  assert.equal(days.length, 2);
  const time = days[0].querySelector('h3 time');
  assert.equal(time.textContent, '2026-10-20');
  assert.equal(time.getAttribute('datetime'), '2026-10-20');
  assert.equal(days[1].querySelector('h3 time').textContent, '2026-10-18');
  assert.equal(root.querySelectorAll('time').length, 2);
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
  assert.equal(items[0].firstElementChild, a);
  assert.ok(items[0].textContent.startsWith('task-0063'));
  assert.equal(items[0].querySelector('.ft-text').textContent, 'Newer one');
  assert.equal(items[1].firstElementChild.className, 'ft-task');
  assert.equal(items[1].firstElementChild.textContent, '');
});

test('date with a time part is cut to the day', async () => {
  const data = await loadFeatures(async () => ({ ok: true, json: async () => ({ releases: [{ ...DATA.releases[0], date: '2026-10-18T22:30:00Z' }], planned: [] }) }));
  assert.equal(data.releases[0].date, '2026-10-18');
  assert.equal(groupDays(data.releases)[0].date, '2026-10-18');
});
test('planned tab holds only to do tasks, newest id first, with title, id, tags, link', async () => {
  const root = await mount(DATA);
  tab(root, 2).click();
  const rows = root.querySelectorAll('.ft-plan');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.ft-ptitle').textContent, 'New plan');
  assert.equal(rows[0].querySelector('a').textContent, 'task-0070');
  assert.equal(rows[0].querySelector('a').getAttribute('href'), `${TASK_URL}task-0070.md`);
  assert.deepEqual([...rows[0].querySelectorAll('.ft-tag')].map((n) => n.textContent), ['web', 'audio']);
  assert.equal(rows[1].querySelector('a').textContent, 'task-0010');
  assert.equal(rows[0].firstElementChild, rows[0].querySelector('a'));
});

test('in progress tab: its own list, newest id first, empty state', async () => {
  const root = await mount(DATA);
  tab(root, 1).click();
  assert.deepEqual([...root.querySelectorAll('.ft-plan a')].map((n) => n.textContent), ['task-0068', 'task-0067']);
  const empty = await mount({ releases: [], planned: [] });
  tab(empty, 1).click();
  assert.equal(empty.querySelector('[role="tabpanel"]').textContent, NO_PROGRESS);
});

test('tab labels carry counts computed from the data', async () => {
  const root = await mount(DATA);
  assert.deepEqual([0, 1, 2].map((i) => tab(root, i).textContent), ['Released 2', 'In progress 2', 'Planned 2']);
});

test('tabs: roles, aria-selected, arrow keys, the last tab is remembered', async () => {
  const root = await mount(DATA);
  assert.equal(root.querySelector('[role="tablist"]') !== null, true);
  assert.equal(root.querySelectorAll('[role="tab"]').length, 3);
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
  fire(tab(root, 0), 'keydown', { key: 'ArrowRight' });
  assert.equal(tab(root, 1).getAttribute('aria-selected'), 'true');
  assert.equal(tab(root, 1).tabIndex, 0);
  assert.equal(tab(root, 0).tabIndex, -1);
  assert.equal(globalThis.localStorage.getItem(TAB_KEY), 'in_progress');
  fire(tab(root, 1), 'keydown', { key: 'ArrowRight' });
  assert.equal(tab(root, 2).getAttribute('aria-selected'), 'true');
  fire(tab(root, 2), 'keydown', { key: 'ArrowRight' });
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
  fire(tab(root, 0), 'keydown', { key: 'End' });
  assert.equal(tab(root, 2).getAttribute('aria-selected'), 'true');
  fire(tab(root, 2), 'keydown', { key: 'Home' });
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
  globalThis.localStorage.setItem(TAB_KEY, 'planned');
  const again = document.createElement('div');
  renderFeatures(again);
  await flush();
  assert.equal(tab(again, 2).getAttribute('aria-selected'), 'true');
});

test('the stored value of the old version, releases, opens the Released tab', async () => {
  globalThis.localStorage.setItem(TAB_KEY, 'releases');
  const root = document.createElement('div');
  stubFetch(async () => ({ body: DATA }));
  renderFeatures(root);
  await flush();
  assert.equal(tab(root, 0).getAttribute('aria-selected'), 'true');
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
  tab(empty, 2).click();
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
  tab(root, 2).click();
  assert.equal(root.querySelectorAll('.ft-plan').length, 2);
});

test('same-date releases are merged into one entry, items newest first and de-duplicated', async () => {
  const same = [['3333333', 'Shared'], ['2222222', 'Shared'], ['1111111', 'Own']].map(([h, t], i) => ({ hash: h, date: '2026-10-20', items: [{ text: i === 2 ? t : `${t} ${h === '3333333' ? 'new' : ''}`.trim(), task: null }, { text: 'Common', task: null }] }));
  const root = await mount({ releases: same, planned: [] });
  assert.equal(root.querySelectorAll('section.ft-day').length, 1);
  assert.equal(root.querySelectorAll('.ft-rel').length, 1);
  assert.deepEqual([...root.querySelectorAll('.ft-item')].map((n) => n.textContent), ['Shared new', 'Common', 'Shared', 'Own']);
  assert.equal(tab(root, 0).textContent, 'Released 1');
});

const day = (date, hashes) => hashes.map((h) => ({ hash: h, full: h.repeat(6).slice(0, 40), date, items: [{ text: `Item ${h}`, task: null }] }));

test('released tab shows one entry per date with a single date heading', async () => {
  const releases = [...day('2026-10-20', ['ccccccc', 'bbbbbbb', 'aaaaaaa']), ...day('2026-10-19', ['eeeeeee', 'ddddddd'])];
  const root = await mount({ releases, planned: [] });
  const days = root.querySelectorAll('section.ft-day');
  assert.equal(days.length, 2);
  assert.equal(days[0].querySelectorAll('li.ft-rel').length, 1);
  assert.deepEqual([...days[0].querySelectorAll('.ft-item')].map((n) => n.textContent), ['Item ccccccc', 'Item bbbbbbb', 'Item aaaaaaa']);
  assert.deepEqual([...days[1].querySelectorAll('.ft-item')].map((n) => n.textContent), ['Item eeeeeee', 'Item ddddddd']);
  assert.equal(root.querySelectorAll('time').length, 2);
});

test('a day whose releases have no items does not appear', () => {
  const rs = [{ hash: 'aaaaaaa', date: '2026-10-20', items: [] }, ...day('2026-10-19', ['bbbbbbb'])];
  assert.deepEqual(groupDays(rs).map((d) => d.date), ['2026-10-19']);
});

test('paging counts dates', async () => {
  const releases = [...day('2026-10-20', ['aaaaaaa', 'bbbbbbb']), ...day('2026-10-19', ['ccccccc'])];
  const root = await mount({ releases, planned: [] });
  assert.equal(root.querySelectorAll('.ft-day').length, 2);
  assert.equal(root.querySelector('.ft-more').hidden, true);
});

test('a pointer item with an https url links its text; any other url is plain text', async () => {
  const items = [{ text: 'Studio moved', task: null, url: 'https://studio.electrophone.cc/#/help/features' }, { text: 'Plain', task: null, url: 'javascript:alert(1)' }];
  const root = await mount({ releases: [{ hash: 'note', full: '', date: '2026-10-25', items }], planned: [] });
  const [moved, plain] = root.querySelectorAll('.ft-item');
  assert.equal(moved.querySelector('.ft-text a').getAttribute('href'), 'https://studio.electrophone.cc/#/help/features');
  assert.equal(moved.querySelector('.ft-text a').getAttribute('rel'), 'noopener');
  assert.equal(moved.querySelector('.ft-text').textContent, 'Studio moved');
  assert.equal(plain.querySelector('a'), null);
});

test('an item without a task has no link and no separator text', async () => {
  const root = await mount({ releases: day('2026-10-20', ['aaaaaaa']), planned: [] });
  assert.equal(root.querySelector('.ft-item').textContent, 'Item aaaaaaa');
});
