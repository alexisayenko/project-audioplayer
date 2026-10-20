import { el } from './dom.js';

export const DATA_URL = 'features/data';
export const TASK_URL = 'https://github.com/alexisayenko/project-audioplayer/blob/main/docs/tasks/';
export const TAB_KEY = 'electrophone.featuresTab';
export const PAGE_SIZE = 30;
export const FAIL_TEXT = 'Could not load the features. Reload to try again.';
export const NO_RELEASES = 'No releases yet.';
export const UNAVAILABLE = 'The release history is not available on this server.';
export const NO_PLANNED = 'Nothing is planned.';
const TABS = [['releases', 'Releases'], ['planned', 'Planned']];

export async function loadFeatures(fetchFn = globalThis.fetch) {
  const res = await fetchFn(DATA_URL);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.releases) || !Array.isArray(data.planned)) throw new Error('bad data');
  return {
    unavailable: data.unavailable === true,
    releases: data.releases.filter((r) => r && typeof r.hash === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) && Array.isArray(r.items))
      .map((r) => ({ ...r, date: r.date.slice(0, 10) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    planned: data.planned.filter((t) => t && /^task-\d+$/.test(t.id))
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
  };
}

const taskLink = (id) => el('a', { class: 'ft-task', href: `${TASK_URL}${id}.md`, target: '_blank', rel: 'noopener' }, id);

export function releaseBlock(r) {
  return el('li', { class: 'ft-rel' },
    el('h3', { class: 'ft-head t-subhead' },
      el('span', { class: 'ft-hash', title: r.full || r.hash }, r.hash),
      el('time', { class: 'ft-date', datetime: r.date }, r.date)),
    el('ul', { class: 'ft-items' }, ...r.items.map((i) =>
      el('li', { class: 'ft-item t-body' }, i.text, i.task ? [' ', taskLink(i.task)] : null))));
}

export function plannedRow(t) {
  return el('li', { class: 'ft-plan' },
    el('span', { class: 'ft-ptitle t-body' }, t.title || t.id),
    el('span', { class: 'ft-pmeta t-caption muted' },
      taskLink(t.id), t.status ? ` ${t.status}` : null, ...(t.tags || []).map((g) => el('span', { class: 'ft-tag' }, g))));
}

function releasesPanel(releases, unavailable) {
  if (unavailable && !releases.length) return el('p', { class: 'muted t-body', role: 'status' }, UNAVAILABLE);
  if (!releases.length) return el('p', { class: 'muted t-body', role: 'status' }, NO_RELEASES);
  let shown = 0;
  const list = el('ol', { class: 'ft-list' });
  const more = el('button', { class: 'btn ft-more', type: 'button' }, 'Show older');
  const fill = () => {
    list.append(...releases.slice(shown, shown + PAGE_SIZE).map(releaseBlock));
    shown += PAGE_SIZE;
    more.hidden = shown >= releases.length;
  };
  more.addEventListener('click', fill);
  fill();
  return el('div', {}, list, more);
}

function plannedPanel(planned) {
  if (!planned.length) return el('p', { class: 'muted t-body', role: 'status' }, NO_PLANNED);
  return el('ul', { class: 'ft-list ft-planned' }, ...planned.map(plannedRow));
}

function readTab() {
  try { const v = globalThis.localStorage?.getItem(TAB_KEY); return TABS.some(([k]) => k === v) ? v : TABS[0][0]; } catch { return TABS[0][0]; }
}
function saveTab(v) { try { globalThis.localStorage?.setItem(TAB_KEY, v); } catch { /* storage may be blocked */ } }

export function renderFeatures(root) {
  const panel = el('div', { class: 'ft-panel', role: 'tabpanel', tabindex: '0' }, el('p', { class: 'muted t-body', role: 'status' }, 'Loading...'));
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
    else if (data) panel.replaceChildren(current === 'releases' ? releasesPanel(data.releases, data.unavailable) : plannedPanel(data.planned));
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
