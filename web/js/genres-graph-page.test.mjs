import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { VOCAB, SONGS } = await import('./genre-levels-fixture.mjs');
const { buildTree, applyCounts } = await import('./genre-levels.js');
const TIP_VOCAB = {
  ...VOCAB,
  levels: { ...VOCAB.levels, 'full tip': { parents: ['Electronic', 'Rock'], discogs: false, synonyms: [], provisional: false } },
};
const { FUSION_VOCAB, FUSION_SONGS } = await import('./genre-fusion-fixture.mjs');
const REL_VOCAB = { ...VOCAB, levels: { ...VOCAB.levels, 'dark house': { parents: ['house'], discogs: true, related: ['afro house', 'Rock'] } } };
const SRC_VOCAB = { ...VOCAB, levels: { ...VOCAB.levels, 'soviet wave': { parents: ['house'], discogs: true, source_links: [{ source: 'Discogs', url: 'https://www.discogs.com/search?q=soviet', kind: 'page' }, { source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Sovietwave', kind: 'page' }, { source: 'spotify', url: 'https://open.spotify.com/search/soviet', kind: 'search' }, { source: 'apple music', url: 'javascript:alert(1)', kind: 'page' }] } } };
const SUB_VOCAB = {
  ...VOCAB,
  subfamilies: [{ name: 'House and techno', family: 'Electronic', order: 1 }, { name: 'Breaks and bass', family: 'Electronic', order: 2 }],
  levels: {
    ...VOCAB.levels,
    house: { ...VOCAB.levels.house, subfamily: 'House and techno' },
    'deep house': { ...VOCAB.levels['deep house'], subfamily: 'House and techno' },
    'afro house': { ...VOCAB.levels['afro house'], subfamily: 'House and techno' },
    'drum and bass': { ...VOCAB.levels['drum and bass'], subfamily: 'Breaks and bass' },
    breakbeat: { ...VOCAB.levels.breakbeat, subfamily: 'Breaks and bass' },
    jungle: { ...VOCAB.levels.jungle, subfamily: 'Breaks and bass' },
  },
};
let mode = 'ok';
const calls = stubFetch((u) => {
  if (u.includes('vocabulary')) {
    if (mode === 'vocab-fail') return { status: 500, body: { error: 'x' } };
    return { body: mode === 'tips' ? TIP_VOCAB : mode === 'fusion' ? FUSION_VOCAB : mode === 'related' ? REL_VOCAB : mode === 'sources' ? SRC_VOCAB : mode === 'subs' ? SUB_VOCAB : VOCAB };
  }
  if (u.endsWith('/me')) return { body: { email: 'a@b.c', owner: mode === 'owner' || mode === 'layoutfile' } };
  if (u.includes('genre-layout.json')) return mode === 'layoutfile' ? { body: { version: 1, genres: { house: [1, 2] }, families: { Electronic: [0, 0] } } } : { status: 404, body: {} };
  return { body: { songs: mode === 'fusion' ? FUSION_SONGS : SONGS } };
});
const { renderGenresRework } = await import('./genres-rework.js');
const { player } = await import('./player.js');
let current = null;
Object.defineProperty(player, 'current', { get: () => current, configurable: true });

function spyViews() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const view = {
    setGraph: rec('setGraph'), setVisible: rec('setVisible'), setRelated: rec('setRelated'), select: rec('select'), setMatches: rec('setMatches'), focusNode: rec('focusNode'), flash: rec('flash'),
    setFocusInset: rec('setFocusInset'), resetLayout: rec('resetLayout'), useSavedLayout: rec('useSavedLayout'),
    exportPositions: () => [{ id: 'g:Electronic', x: 100, y: 50 }, { id: 's:house', x: 300, y: 250 }], reset: rec('reset'), zoomBy: rec('zoomBy'), resize: rec('resize'), destroy: rec('destroy'),
  };
  return { calls, factory: () => view, last: (name) => calls.filter((c) => c[0] === name).at(-1) };
}

async function mount(opts = {}) {
  const spy = spyViews();
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresRework(root, { forceViewFactory: spy.factory, ...opts });
  await flush();
  return { root, cleanup, spy };
}
const rowsOf = (root) => root.querySelectorAll('[role="treeitem"]');
const names = (root) => rowsOf(root).map((r) => r.querySelector('.gmr-name').textContent);
const row = (root, name) => rowsOf(root).find((r) => r.querySelector('.gmr-name').textContent === name);
const btn = (root, text) => root.querySelectorAll('button').find((b) => b.textContent === text);
const chipsOf = (root) => root.querySelectorAll('.gmr-family-row button');
const chip = (root, name) => chipsOf(root).find((c) => c.textContent === name);
const shown = (root) => ({ graph: !root.querySelector('.gmr-graph').hidden, radial: !root.querySelector('.gmr-canvas:not(.gmr-graph)').hidden });
const status = (root) => root.querySelector('[role="status"]').textContent;

test('Graph is the default view, with the Graph | Radial switch and the whole vocabulary on the map', async () => {
  mode = 'ok';
  const { root, cleanup, spy } = await mount();
  assert.deepEqual(shown(root), { graph: true, radial: false });
  const sw = root.querySelector('.gmr-view-row');
  assert.equal(sw.getAttribute('aria-label'), 'Map view');
  assert.deepEqual(sw.querySelectorAll('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['Graph', 'true'], ['Radial', 'false']]);
  const g = spy.last('setGraph')[1];
  assert.equal(g.nodes.length, 9);
  assert.ok(g.nodes.some((n) => n.id === 's:breakbeat' && n.em === 0), 'a genre with no library song is on the map');
  assert.ok(g.links.some((l) => l.kind === 'related' && l.source === 's:breakbeat' && l.target === 's:jungle'));
  assert.equal(spy.last('setVisible')[1], null);
  assert.equal(status(root), '7 genres, 5 in your library');
  assert.ok(root.querySelector('.gmr-graph').getAttribute('aria-label').includes('Drag a circle'));
  cleanup();
  assert.ok(spy.calls.some((c) => c[0] === 'destroy'));
});

test('the graph outline lists genres without library songs and the chips are All plus every family', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  btn(root, 'Expand all').click();
  const list = names(root);
  for (const n of ['Electronic', 'breakbeat', 'drum and bass', 'house', 'afro house', 'deep house', 'Rock', 'rock and roll']) assert.ok(list.includes(n), n);
  assert.deepEqual(chipsOf(root).map((c) => c.textContent), ['All', 'Electronic', 'Rock']);
  assert.deepEqual(chipsOf(root).map((c) => c.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  cleanup();
});

test('a family chip narrows the map and the outline, pressing it again shows everything', async () => {
  mode = 'ok';
  const { root, cleanup, spy } = await mount();
  chip(root, 'Rock').click();
  assert.deepEqual([...spy.last('setVisible')[1]].sort(), ['g:Rock', 's:rock and roll']);
  assert.deepEqual(chipsOf(root).map((c) => c.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  assert.deepEqual(names(root), ['Rock']);
  assert.equal(status(root), '7 genres (1 shown), 5 in your library');
  chip(root, 'Rock').click();
  assert.equal(spy.last('setVisible')[1], null);
  chip(root, 'Electronic').click();
  chip(root, 'All').click();
  assert.equal(spy.last('setVisible')[1], null);
  assert.equal(chip(root, 'All').getAttribute('aria-pressed'), 'true');
  cleanup();
});

test('Library only hides genres without songs and combines with a family', async () => {
  mode = 'ok';
  const { root, cleanup, spy } = await mount();
  const lib = btn(root, 'Library only');
  assert.equal(lib.getAttribute('aria-pressed'), 'false');
  lib.click();
  assert.equal(lib.getAttribute('aria-pressed'), 'true');
  const ids = spy.last('setVisible')[1];
  assert.ok(ids.has('s:house') && ids.has('s:jungle') && !ids.has('s:breakbeat'));
  btn(root, 'Expand all').click();
  assert.ok(!names(root).includes('breakbeat'));
  chip(root, 'Rock').click();
  assert.deepEqual([...spy.last('setVisible')[1]].sort(), ['g:Rock', 's:rock and roll']);
  lib.click();
  chip(root, 'All').click();
  assert.equal(spy.last('setVisible')[1], null);
  cleanup();
});

test('the Radial button swaps the canvases, keeps the radial map as it was and remembers the choice', async () => {
  mode = 'ok';
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { root, cleanup, spy } = await mount();
  btn(root, 'Radial').click();
  assert.deepEqual(shown(root), { graph: false, radial: true });
  assert.deepEqual(chipsOf(root).map((c) => [c.textContent, c.getAttribute('aria-pressed')]), [['Electronic', 'true'], ['Rock', 'false']], 'Radial has one family at a time and no All chip');
  assert.equal(store.get('electrophone.genresView'), 'radial');
  assert.equal(btn(root, 'Library only').hidden, true);
  assert.equal(status(root), '5 genres in Electronic');
  assert.deepEqual(names(root), ['Electronic', 'drum and bass', 'house', 'Rock']);
  btn(root, 'Graph').click();
  assert.deepEqual(shown(root), { graph: true, radial: false });
  assert.equal(status(root), '7 genres, 5 in your library');
  assert.equal(store.get('electrophone.genresView'), 'graph');
  btn(root, 'Radial').click();
  cleanup();
  const again = await mount();
  assert.deepEqual(shown(again.root), { graph: false, radial: true });
  again.cleanup();
  assert.ok(spy);
  globalThis.localStorage = saved;
});

test('a genre the map filters hide is revealed by search: filters clear and it is selected on the graph', async () => {
  mode = 'ok';
  const { root, cleanup, spy } = await mount();
  chip(root, 'Rock').click();
  const input = root.querySelector('input');
  input.value = 'jungle';
  fire(input, 'input');
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(spy.last('setVisible')[1], null);
  assert.equal(chip(root, 'All').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(spy.last('select').slice(1), ['s:jungle']);
  assert.equal(root.querySelector('.gmr-details').hidden, false);
  cleanup();
});

test('Now playing on the graph picks the playing genre in any family and flashes it', async () => {
  mode = 'ok';
  current = { id: 's5', tags: ['genre:rock and roll'] };
  const { root, cleanup, spy } = await mount();
  btn(root, 'Now playing').click();
  assert.deepEqual(spy.last('flash').slice(1), ['s:rock and roll']);
  assert.deepEqual(spy.last('focusNode').slice(1), ['s:rock and roll']);
  assert.equal(row(root, 'rock and roll').getAttribute('aria-selected'), 'true');
  cleanup();
  current = null;
});

test('a failed vocabulary clears the graph and leaves the failure text', async () => {
  mode = 'vocab-fail';
  const { root, cleanup, spy } = await mount();
  assert.equal(status(root), 'Vocabulary unavailable');
  assert.deepEqual(spy.last('setGraph')[1].nodes, []);
  assert.equal(chipsOf(root).length, 0);
  cleanup();
  mode = 'ok';
});

test('the hover tooltip on the graph names only the other families of a cross-linked genre', async () => {
  mode = 'tips';
  let opts = null;
  const spy = spyViews();
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = renderGenresRework(root, { forceViewFactory: (c, o) => { opts = o; return spy.factory(); } });
  await flush();
  const tree = buildTree(TIP_VOCAB);
  applyCounts(tree, [{ id: 't', tags: ['genre:full tip'] }]);
  opts.onHover({ node: tree.byId.get('s:full tip') }, { x: 5, y: 5 });
  const tip = root.querySelector('[role="tooltip"]').textContent;
  assert.ok(tip.includes('also in Rock') && !tip.includes('also in Electronic') && !tip.includes('null'), tip);
  assert.equal(root.querySelector('.gmr-details').hidden, true, 'hover never opens the panel');
  assert.equal(rowsOf(root).filter((r) => r.getAttribute('aria-selected') === 'true').length, 0, 'hover never selects');
  assert.deepEqual(spy.calls.filter((c) => c[0] === 'select' && c[1]), []);
  cleanup();
  mode = 'ok';
});

test('the Fusion genres switch is off by default, remembers its state, rebuilds the map and the outline counts', async () => {
  mode = 'fusion';
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const { root, cleanup, spy } = await mount();
    const sw = btn(root, 'Fusion genres');
    assert.equal(sw.getAttribute('role'), 'switch');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    const links = () => spy.last('setGraph')[1].links;
    const node = () => spy.last('setGraph')[1].nodes.find((n) => n.id === 's:blues rock');
    assert.ok(!links().some((l) => l.source === 'g:Rock' && l.target === 's:blues rock'));
    assert.equal(node().fis.length, 1);
    chip(root, 'Rock').click();
    assert.deepEqual([...spy.last('setVisible')[1]], ['g:Rock'], 'with fusion off Rock has no blues rock');
    sw.click();
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.equal(store.get('electrophone.genresFusion'), '1');
    assert.ok(links().some((l) => l.source === 'g:Rock' && l.target === 's:blues rock'), 'cross-link to the second family');
    assert.equal(node().fis.length, 2);
    assert.deepEqual([...spy.last('setVisible')[1]].sort(), ['g:Rock', 's:blues rock', 's:hard blues rock']);
    sw.click();
    assert.equal(store.get('electrophone.genresFusion'), '0');
    assert.equal(node().fis.length, 1);
    sw.click();
    cleanup();
    const again = await mount();
    assert.equal(btn(again.root, 'Fusion genres').getAttribute('aria-checked'), 'true', 'the choice is restored');
    again.cleanup();
  } finally { globalThis.localStorage = saved; mode = 'ok'; }
});

test('the Fusion switch works when storage is blocked and changes the radial counts too', async () => {
  mode = 'fusion';
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    const { root, cleanup } = await mount({ view: 'radial' });
    const sw = btn(root, 'Fusion genres');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    chip(root, 'Rock')?.click();
    assert.equal(chip(root, 'Rock'), undefined, 'Rock has no library genre while fusion is off');
    assert.doesNotThrow(() => sw.click());
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.ok(chip(root, 'Rock'), 'Rock gets a chip once blues rock counts there');
    cleanup();
  } finally { globalThis.localStorage = saved; mode = 'ok'; }
});

test('the header: status is plain text above one non-wrapping button row, the family chips follow', async () => {
  mode = 'ok';
  const { root, cleanup } = await mount();
  const bar = root.querySelector('.gmr-bar');
  assert.deepEqual(bar.children.map((c) => c.getAttribute('role') || c.className.split(' ')[0]), ['status', 'gmr-btns', 'gmr-btns', 'group', 'group']);
  const rows = bar.querySelectorAll('.gmr-btns');
  assert.deepEqual(rows[0].querySelectorAll('button').map((b) => b.textContent), ['Show legend', 'Now playing', 'Reload']);
  assert.deepEqual(rows[1].querySelectorAll('button').map((b) => b.textContent), ['Graph', 'Radial', 'Library only', 'Fusion genres', 'Related', 'Reset layout', 'Use saved layout', 'Export layout']);
  const labels = rows.flatMap((r) => r.querySelectorAll('button').map((b) => b.textContent));
  for (const l of ['Show legend', 'Reload', 'Graph', 'Radial', 'Library only', 'Fusion genres']) assert.ok(labels.includes(l), l);
  assert.equal(root.querySelector('.gmr-family-row').parentNode, bar);
  cleanup();
});

test('selection syncs between map, outline and the separate infobox; hover never opens it', async () => {
  mode = 'ok';
  const { root, cleanup, spy } = await mount();
  const info = root.querySelector('#gmr-info');
  assert.equal(info.hidden, true);
  assert.equal(root.querySelector('#gmr-outline').contains(info), false);
  const input = root.querySelector('input');
  input.value = 'house';
  fire(input, 'input');
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(info.hidden, false);
  assert.deepEqual(spy.last('select').slice(1), ['s:house']);
  assert.ok(info.textContent.includes('Parents'));
  assert.ok(!info.textContent.includes('Children') && !info.textContent.includes('Level') && !info.textContent.includes('Families') && !info.textContent.includes('Parent chain'), 'no Children, Level, Families or Parent chain row');
  assert.ok(!/also under|primary|secondary|extra/i.test(info.textContent));
  info.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Close details').click();
  assert.equal(info.hidden, true);
  assert.deepEqual(spy.last('select').slice(1), [null]);
  cleanup();
});

test('the Related switch is off by default, persists, reaches the graph, and the infobox lists clickable related genres', async () => {
  mode = 'related';
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const { root, cleanup, spy } = await mount();
    const sw = btn(root, 'Related');
    assert.equal(sw.getAttribute('role'), 'switch');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.equal(spy.last('setRelated')[1], false);
    sw.click();
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.equal(store.get('electrophone.genresRelated'), '1');
    assert.equal(spy.last('setRelated')[1], true);
    assert.ok(spy.last('setGraph')[1].links.some((l) => l.kind === 'assoc' && l.source === 's:dark house' && l.target === 's:afro house'));
    assert.ok(root.querySelector('#gmr-legend').textContent.includes('Dotted: related (influence, not a parent)'));
    const input = root.querySelector('input');
    input.value = 'dark house';
    fire(input, 'input');
    fire(input, 'keydown', { key: 'Enter' });
    const info = root.querySelector('#gmr-info');
    assert.ok(info.textContent.includes('Related'));
    const chips = info.querySelectorAll('.gm-chip').map((c) => c.textContent);
    assert.ok(chips.includes('afro house') && chips.includes('Rock'));
    info.querySelectorAll('.gm-chip').find((c) => c.textContent === 'Rock').click();
    assert.deepEqual(spy.last('select').slice(1), ['g:Rock'], 'a family name selects the family');
    cleanup();
  } finally { globalThis.localStorage = saved; mode = 'ok'; }
});

test('the infobox Sources row shows only the icons the vocabulary links, filled for pages and muted for searches, with safe link attributes', async () => {
  mode = 'sources';
  const { root, cleanup } = await mount();
  const input = root.querySelector('input');
  const open = (name) => { input.value = name; fire(input, 'input'); fire(input, 'keydown', { key: 'Enter' }); };
  open('soviet wave');
  const info = root.querySelector('#gmr-info');
  assert.ok(!info.textContent.includes('In Discogs'), 'the old In Discogs row is gone');
  const slot = info.querySelector('[data-slot="source-icons"]');
  const links = slot.querySelectorAll('a');
  assert.deepEqual(links.map((a) => a.getAttribute('data-source')), ['wikipedia', 'spotify', 'discogs'], 'fixed order, only linked sources');
  const wiki = links[0];
  assert.equal(wiki.getAttribute('href'), 'https://en.wikipedia.org/wiki/Sovietwave');
  assert.equal(wiki.getAttribute('target'), '_blank');
  assert.equal(wiki.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(wiki.getAttribute('aria-label'), 'Wikipedia: soviet wave');
  assert.equal(wiki.getAttribute('title'), 'Open on Wikipedia');
  assert.ok(wiki.classList.contains('page') && !wiki.classList.contains('search'));
  const spot = links[1];
  assert.ok(spot.classList.contains('search'));
  assert.equal(spot.getAttribute('title'), 'Search on Spotify');
  assert.ok(wiki.querySelector('svg'));
  assert.equal(info.textContent.includes('javascript'), false, 'a non-http link is dropped');
  open('house');
  assert.equal(info.querySelector('[data-slot="source-icons"]'), null, 'no row without links');
  cleanup();
  mode = 'ok';
});

test('layout actions: Reset layout is a Graph action, Use saved layout needs a layout file, Export layout is for the owner only', async () => {
  mode = 'ok';
  const plain = await mount();
  assert.equal(btn(plain.root, 'Reset layout').hidden, false);
  assert.equal(btn(plain.root, 'Use saved layout').hidden, true, 'no layout file');
  assert.equal(btn(plain.root, 'Export layout').hidden, true, 'not the owner');
  btn(plain.root, 'Reset layout').click();
  assert.ok(plain.spy.calls.some((c) => c[0] === 'resetLayout'));
  btn(plain.root, 'Radial').click();
  assert.equal(btn(plain.root, 'Reset layout').hidden, true, 'Graph only');
  plain.cleanup();
  mode = 'layoutfile';
  const owner = await mount({ view: 'graph' });
  await flush();
  assert.equal(btn(owner.root, 'Export layout').hidden, false);
  assert.equal(btn(owner.root, 'Use saved layout').hidden, false);
  const saved = owner.spy.last('setGraph')[2].saved;
  assert.deepEqual(saved.get('s:house'), [1, 2]);
  assert.deepEqual(saved.get('g:Electronic'), [0, 0]);
  btn(owner.root, 'Use saved layout').click();
  assert.ok(owner.spy.calls.some((c) => c[0] === 'useSavedLayout'));
  owner.cleanup();
  mode = 'ok';
});

test('Export layout copies the normalised layout JSON to the clipboard and falls back to a download', async () => {
  mode = 'owner';
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedUrl = { c: URL.createObjectURL, r: URL.revokeObjectURL };
  let copied = null;
  let downloads = 0;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copied = t; } } }, configurable: true });
  URL.createObjectURL = () => { downloads++; return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  try {
    const { root, cleanup } = await mount();
    await flush();
    btn(root, 'Export layout').click();
    await flush();
    const data = JSON.parse(copied);
    assert.equal(data.version, 1);
    assert.deepEqual(data.families, { Electronic: [-500, -500] });
    assert.deepEqual(data.genres, { house: [500, 500] });
    assert.equal(downloads, 0);
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => { throw new Error('denied'); } } }, configurable: true });
    btn(root, 'Export layout').click();
    await flush();
    assert.equal(downloads, 1, 'the download fallback runs');
    cleanup();
  } finally {
    if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete globalThis.navigator;
    URL.createObjectURL = savedUrl.c;
    URL.revokeObjectURL = savedUrl.r;
    mode = 'ok';
  }
});

test('subfamily chips appear for Electronic only, filter the map and the outline, persist, and the legend and infobox name the subfamilies', async () => {
  mode = 'subs';
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const { root, cleanup, spy } = await mount({ view: 'graph' });
    const row = root.querySelector('.gmr-sub-row');
    const legendSub = () => root.querySelector('.gmr-legend-sub');
    assert.equal(row.hidden, true, 'no subfamily row while all families are shown');
    assert.equal(legendSub().hidden, false, 'the legend lists the subfamilies while Electronic is visible');
    assert.deepEqual(legendSub().querySelectorAll('li').map((li) => li.textContent), ['House and techno', 'Breaks and bass']);
    chip(root, 'Rock').click();
    assert.equal(row.hidden, true);
    assert.equal(legendSub().hidden, true, 'Electronic is not visible');
    chip(root, 'Electronic').click();
    assert.equal(row.hidden, false);
    assert.equal(row.getAttribute('aria-label'), 'Subfamily');
    const subs = () => row.querySelectorAll('button');
    assert.deepEqual(subs().map((b) => b.textContent), ['All', 'House and techno', 'Breaks and bass']);
    assert.deepEqual(subs().map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false']);
    subs()[2].click();
    assert.deepEqual(subs().map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    const ids = spy.last('setVisible')[1];
    assert.ok(ids.has('s:jungle') && ids.has('s:drum and bass') && ids.has('g:Electronic'));
    assert.ok(!ids.has('s:house') && !ids.has('s:deep house'));
    btn(root, 'Expand all').click();
    assert.ok(names(root).includes('jungle') && !names(root).includes('house'), 'the outline follows the filter');
    assert.deepEqual(JSON.parse(store.get('electrophone.genresSubfamilies')), ['Breaks and bass']);
    subs()[1].click();
    assert.ok(spy.last('setVisible')[1].has('s:house'), 'multi-select adds a subfamily');
    subs()[0].click();
    assert.equal(spy.last('setVisible')[1].has('s:house') && spy.last('setVisible')[1].has('s:jungle'), true);
    assert.deepEqual(JSON.parse(store.get('electrophone.genresSubfamilies')), []);
    subs()[1].click();
    const input = root.querySelector('input');
    input.value = 'jungle';
    fire(input, 'input');
    fire(input, 'keydown', { key: 'Enter' });
    const info = root.querySelector('#gmr-info');
    assert.ok(info.textContent.includes('Subfamily'));
    assert.ok(info.textContent.includes('Breaks and bass'));
    cleanup();
    const again = await mount({ view: 'graph' });
    chip(again.root, 'Electronic').click();
    assert.deepEqual(again.root.querySelector('.gmr-sub-row').querySelectorAll('button').map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false'], 'the choice is restored');
    again.cleanup();
  } finally { globalThis.localStorage = saved; mode = 'ok'; }
});

test('without subfamily data there is no subfamily row and no legend section; Radial shows the row for Electronic', async () => {
  mode = 'ok';
  const plain = await mount({ view: 'graph' });
  chip(plain.root, 'Electronic').click();
  assert.equal(plain.root.querySelector('.gmr-sub-row').hidden, true);
  assert.equal(plain.root.querySelector('.gmr-legend-sub').hidden, true);
  assert.equal(plain.root.querySelector('.gmr-sub-row').children.length, 0);
  plain.cleanup();
  mode = 'subs';
  const radial = await mount({ view: 'radial' });
  assert.equal(radial.root.querySelector('.gmr-sub-row').hidden, false, 'Electronic is the radial family');
  assert.equal(radial.root.querySelector('.gmr-legend-sub').hidden, false);
  radial.cleanup();
  mode = 'ok';
});
