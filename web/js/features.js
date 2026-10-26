import { el } from './dom.js';
import { loadingNote } from './loading-note.js';

export const DATA_URL = 'features/data';
export const TASK_URL = 'https://github.com/alexisayenko/project-audioplayer/blob/main/docs/tasks/';
export const TAB_KEY = 'electrophone.featuresTab';
export const PAGE_SIZE = 30;
export const FAIL_TEXT = 'Could not load the features. Reload to try again.';
export const NO_RELEASES = 'No releases yet.';
export const UNAVAILABLE = 'The release history is not available on this server.';
export const NO_PLANNED = 'Nothing is planned.';
const TABS = [['released', 'Released'], ['in_progress', 'In progress'], ['planned', 'Planned']];
export const NO_PROGRESS = 'Nothing in progress right now.';

const tasksOf = (list) => (Array.isArray(list) ? list : []).filter((t) => t && /^task-\d+$/.test(t.id))
  .sort((a, b) => {
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });

export async function loadFeatures(fetchFn = globalThis.fetch) {
  const res = await fetchFn(DATA_URL);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.releases) || !Array.isArray(data.planned)) throw new Error('bad data');
  return {
    unavailable: data.unavailable === true,
    releases: data.releases.filter((r) => r && typeof r.hash === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) && Array.isArray(r.items))
      .map((r) => ({ ...r, date: r.date.slice(0, 10) })),
    planned: tasksOf(data.planned),
    in_progress: tasksOf(data.in_progress),
  };
}

const taskLink = (id) => el('a', { class: 'ft-task', href: `${TASK_URL}${id}.md`, target: '_blank', rel: 'noopener' }, id);

const textOf = (i) => (typeof i.url === 'string' && i.url.startsWith('https://')
  ? el('a', { href: i.url, target: '_blank', rel: 'noopener' }, i.text)
  : i.text);

export function releaseBlock(r) {
  return el('li', { class: 'ft-rel' },
    el('ul', { class: 'ft-items' }, ...r.items.map((i) =>
      el('li', { class: 'ft-item t-body' }, i.task ? taskLink(i.task) : el('span', { class: 'ft-task', 'aria-hidden': 'true' }), el('span', { class: 'ft-text' }, textOf(i))))));
}

export function groupDays(releases) {
  const days = [];
  for (const r of releases) {
    if (!r.items.length) continue;
    const last = days.at(-1);
    if (last && last.date === r.date) {
      const seen = new Set(last.releases[0].items.map((i) => i.text));
      last.releases[0].items.push(...r.items.filter((i) => !seen.has(i.text)));
    } else days.push({ date: r.date, releases: [{ ...r, items: [...r.items] }] });
  }
  return days;
}

export function dayBlock(day) {
  return el('section', { class: 'ft-day' },
    el('h3', { class: 'ft-dayhead t-subhead' }, el('time', { datetime: day.date }, day.date)),
    el('ol', { class: 'ft-list' }, ...day.releases.map(releaseBlock)));
}

export function plannedRow(t) {
  return el('li', { class: 'ft-plan' },
    taskLink(t.id),
    el('div', { class: 'ft-pbody' },
      el('span', { class: 'ft-ptitle t-body' }, t.title || t.id),
      el('span', { class: 'ft-pmeta t-caption muted' }, ...(t.tags || []).map((g) => el('span', { class: 'ft-tag' }, g)))));
}

function panelFor(current, data) {
  if (current === 'released') return releasesPanel(data.releases, data.unavailable);
  if (current === 'planned') return plannedPanel(data.planned);
  return plannedPanel(data.in_progress, NO_PROGRESS);
}

function releasesPanel(releases, unavailable) {
  const days = groupDays(releases);
  if (unavailable && !days.length) return el('p', { class: 'muted t-body', role: 'status' }, UNAVAILABLE);
  if (!days.length) return el('p', { class: 'muted t-body', role: 'status' }, NO_RELEASES);
  let next = 0;
  let count = 0;
  const list = el('div', { class: 'ft-days' });
  const more = el('button', { class: 'btn ft-more', type: 'button' }, 'Show older');
  const fill = () => {
    const target = count + PAGE_SIZE;
    while (next < days.length && count < target) {
      list.append(dayBlock(days[next]));
      count += days[next].releases.length;
      next += 1;
    }
    more.hidden = next >= days.length;
  };
  more.addEventListener('click', fill);
  fill();
  return el('div', {}, list, more);
}

function plannedPanel(planned, empty = NO_PLANNED) {
  if (!planned.length) return el('p', { class: 'muted t-body', role: 'status' }, empty);
  return el('ul', { class: 'ft-list ft-planned' }, ...planned.map(plannedRow));
}

function readTab() {
  try {
    let v = globalThis.localStorage?.getItem(TAB_KEY);
    if (v === 'releases') v = 'released';
    return TABS.some(([k]) => k === v) ? v : TABS[0][0];
  } catch {
    return TABS[0][0];
  }
}
function saveTab(v) { try { globalThis.localStorage?.setItem(TAB_KEY, v); } catch { /* storage may be blocked */ } }

export function renderFeatures(root) {
  const panel = el('div', { class: 'ft-panel', role: 'tabpanel', tabindex: '0' }, loadingNote());
  let data = null;
  let failed = false;
  let current = readTab();
  const tabs = TABS.map(([key, label]) => el('button', { class: 'ft-tab t-subhead', type: 'button', role: 'tab', id: `ft-tab-${key}`, 'aria-controls': 'ft-panel' }, label));
  const show = () => {
    TABS.forEach(([key], i) => {
      const on = key === current;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `ft-tab-${current}`);
    if (failed) panel.replaceChildren(el('p', { class: 'muted t-body', role: 'status' }, FAIL_TEXT));
    else if (data) panel.replaceChildren(panelFor(current, data));
    if (data) TABS.forEach(([key, label], i) => { tabs[i].textContent = `${label} ${key === 'released' ? groupDays(data.releases).length : data[key].length}`; });
  };
  const pick = (i, focus) => {
    current = TABS[i][0];
    saveTab(current);
    show();
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(i, false));
    t.addEventListener('keydown', (e) => {
      const n = TABS.length;
      const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      pick(next, true);
    });
  });
  panel.id = 'ft-panel';
  root.append(
    el('header', { class: 'page-head' }, el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'), el('h1', { class: 't-display' }, 'Features')),
    el('div', { class: 'ft-tabs', role: 'tablist', 'aria-label': 'Features' }, ...tabs),
    panel);
  show();
  loadFeatures().then((d) => { data = d; show(); }).catch(() => { failed = true; show(); });
}
