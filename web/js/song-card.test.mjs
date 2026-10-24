import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
initPlayer();
const { cardModel, cardTags, openSongCard, listeningNode, isPlayingNow } = await import('./song-card.js');
const { icon } = await import('./icons.js');
const { resetGenreTree } = await import('./genre-tree.js');
const { buildTree } = await import('./genre-levels.js');
const { VOCAB } = await import('./genre-levels-fixture.mjs');

const FULL = {
  id: 'a', title: 'Alpha', remixer: 'Kav', artist: 'Zed', album: 'LP', year: 1999, bpm: 120.4, duration: 125, file: 'a.mp3', cover: true,
  tags: ['genre:rock', 'decade:90s', 'country:de', 'lang:de', 'chill'],
  source_url: 'https://youtu.be/jNQXAC9IVRw', musicbrainz_url: 'https://musicbrainz.org/recording/1', wikipedia_artist: 'https://en.wikipedia.org/wiki/Zed',
};
const BARE = { id: 'n', title: 'Bare', file: null, audio_state: 'none', tags: [] };
const publish = (songs) => { store.songs = songs; store.loaded = true; store.listeners.forEach((fn) => fn()); };
const $ = (id) => document.getElementById(id);
const names = (dlg) => dlg.querySelectorAll('.card-actions button').map((b) => b.getAttribute('aria-label') || b.textContent);

test('cardModel builds title, sub line, grouped tags, BPM, duration and links', () => {
  const m = cardModel(FULL, { kind: 'none' });
  assert.equal(m.title, 'Alpha');
  assert.equal(m.remix, 'Kav');
  assert.equal(m.sub, 'Zed · 1999');
  assert.equal(m.album, 'LP');
  assert.deepEqual(m.groups.map((g) => g.name), ['Genre', 'Country', 'Tags']);
  assert.ok(!JSON.stringify(m.groups).includes('lang:'), 'lang tags stay hidden as in Playback');
  assert.ok(!JSON.stringify(m.groups).includes('decade'), 'decade tags stay hidden');
  assert.equal(m.bpm, '120');
  assert.equal(m.duration, '2:05');
  assert.deepEqual(Object.keys(m.links).sort(), ['musicbrainz', 'wikipedia', 'youtube']);
  assert.equal('download' in m, false);
});

test('the card by-row label follows the version type', () => {
  const m = cardModel({ ...FULL, mainArtists: ['Zed'], version: { type: 'remaster', name: 'Remastered', artists: ['Kav'] } });
  assert.ok(m.details.includes('Remaster by: Kav'));
  assert.ok(!m.details.some((d) => d.startsWith('Remix by')));
});

test('the card hides the version type and version name lines and keeps the other details', () => {
  const m = cardModel({ ...FULL, mainArtists: ['Zed'], version: { type: 'remix', name: 'MKJ Remix', artists: ['Kav'] } });
  assert.deepEqual(m.details.filter((d) => /^Version/.test(d)), []);
  assert.ok(m.details.includes('Remix by: Kav'));
  const y = cardModel({ ...FULL, mainArtists: ['Zed'], releaseYear: 1985, version: { type: 'remix', name: 'X', artists: ['Kav'], releaseYear: 2023 } });
  assert.deepEqual(y.details.filter((d) => /^(Remix year|First released)/.test(d)), [], 'years are folded into the Year fact');
  assert.equal(y.yearFact, '2023 · original 1985');
});

test('cardModel copes with missing fields', () => {
  const m = cardModel(BARE, { kind: 'none' });
  assert.deepEqual([m.sub, m.bpm, m.duration, m.groups.length, Object.keys(m.links).length], ['', '', '', 0, 0]);
  assert.equal(cardModel(undefined, undefined).title, '');
  assert.deepEqual(cardTags(undefined), []);
});

test('the card opens read-only with links, actions and returns focus to the row on Close', () => {
  publish([FULL, BARE]);
  const list = document.createElement('ul');
  list.className = 'songs';
  const row = document.createElement('li');
  row.className = 'song';
  row.dataset.id = 'a';
  const open = document.createElement('button');
  open.className = 'open';
  row.append(open);
  list.append(row);
  document.body.append(list);
  const before = store.listeners.size;
  openSongCard(FULL, open);
  const dlg = $('song-card');
  assert.equal(dlg.open, true);
  assert.equal(dlg.querySelector('h2').textContent, 'Alpha (Kav)');
  assert.equal(dlg.querySelector('img.card-cover').localName, 'img');
  const hrefs = dlg.querySelectorAll('a.svc').map((a) => a.getAttribute('href'));
  assert.equal(hrefs.length, 3);
  assert.ok(dlg.querySelectorAll('a.svc').every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel') === 'noopener'));
  assert.deepEqual(names(dlg), ['Play next', 'Add to queue', 'Share link', 'Download', 'Edit']);
  assert.ok(dlg.querySelectorAll('.card-icons button').every((b) => b.getAttribute('aria-label') && b.title), 'icon buttons are labelled');
  assert.ok(document.activeElement === dlg, 'opening focuses the dialog itself, not an action button');
  assert.equal(dlg.getAttribute('tabindex'), '-1');
  assert.ok(!dlg.querySelectorAll('.card-actions button').includes(document.activeElement), 'no action button shows a focus ring on open');
  const x = dlg.querySelector('.card-close');
  assert.equal(x.getAttribute('aria-label'), 'Close');
  assert.equal(x.title, 'Close');
  assert.equal(x.textContent, '');
  assert.equal(dlg.querySelector('.card-bar'), null, 'no header row');
  assert.ok(x.parentElement === dlg || x.parentElement.classList.contains('card-art'), 'floats over the cover or the card corner');
  assert.equal(dlg.querySelector('.card-actions .btn'), null, 'no text button in the action row');
  assert.equal(dlg.querySelector('.card-icons .key'), null, 'no dock key on the card');
  assert.equal(dlg.querySelectorAll('.card-icons .icon.round').length, 5, 'every card action is a round icon button');
  assert.equal(dlg.querySelectorAll('.card-icons button').length, 5, 'all actions sit in one row');
  assert.match(dlg.textContent, /Zed · 1999/);
  assert.equal(dlg.querySelector('.card-full').textContent, 'Zed - Alpha (Kav)');
  assert.equal(store.listeners.size, before + 1);
  dlg.querySelector('.card-close').click();
  assert.equal(dlg.open, false);
  assert.equal(store.listeners.size, before, 'subscriptions are released');
  assert.ok(document.activeElement === open, 'focus returns to the row title');
  list.remove();
});

test('the card opens when querySelectorAll returns a real NodeList (no indexOf or find), as in browsers', () => {
  publish([FULL, BARE]);
  const list = document.createElement('ul');
  list.className = 'songs';
  const row = document.createElement('li');
  row.className = 'song';
  row.dataset.id = 'a';
  const open = document.createElement('button');
  open.className = 'open';
  row.append(open);
  list.append(row);
  document.body.append(list);
  const dlg = $('song-card');
  const nodeList = (arr) => Object.assign(Object.create(null), arr, { length: arr.length, item: (i) => arr[i], forEach: (f) => arr.forEach(f), [Symbol.iterator]: () => arr[Symbol.iterator]() });
  const origDlg = dlg.querySelectorAll;
  const origDoc = document.querySelectorAll;
  dlg.querySelectorAll = (sel) => nodeList(origDlg.call(dlg, sel));
  document.querySelectorAll = (sel) => nodeList(origDoc.call(document, sel));
  try {
    openSongCard(FULL, open);
    assert.equal(dlg.open, true);
    dlg.querySelectorAll('.card-actions button')[0]?.focus?.();
    publish([FULL, BARE]);
    assert.equal(dlg.open, true);
    dlg.querySelector('.card-close').click();
    assert.equal(dlg.open, false);
    assert.ok(document.activeElement === open);
  } finally {
    dlg.querySelectorAll = origDlg;
    document.querySelectorAll = origDoc;
    list.remove();
  }
});

test('pressing the pressed queue button removes the song from the queue and the card repaints', () => {
  publish([FULL, BARE]);
  while (player.current) player.removeAt(0);
  openSongCard(FULL);
  const dlg = $('song-card');
  const btn = (t) => dlg.querySelectorAll('.card-actions button').find((b) => b.getAttribute('aria-label') === t);
  btn('Add to queue').click();
  assert.equal(player.inQueue('a'), true);
  btn('In queue, position 1 of 1 - click to remove').click();
  assert.equal(player.inQueue('a'), false);
  const off = btn('Add to queue');
  assert.ok(off, 'the card repaints to the unpressed button');
  assert.equal(off.getAttribute('aria-pressed'), 'false');
  assert.equal(off.classList.contains('on'), false);
  dlg.close();
});

test('the queue button toggles, Play next queues the song after the current one, Edit hands over to the edit dialog', () => {
  publish([FULL, BARE, { ...FULL, id: 'o', title: 'Other', file: 'o.mp3' }]);
  while (player.current) player.removeAt(0);
  openSongCard(FULL);
  const dlg = $('song-card');
  const btn = (t) => dlg.querySelectorAll('.card-actions button').find((b) => (b.getAttribute('aria-label') || b.textContent) === t);
  const off = btn('Add to queue');
  assert.equal(off.getAttribute('aria-pressed'), 'false');
  assert.equal(off.classList.contains('on'), false);
  off.click();
  assert.equal(player.inQueue('a'), true);
  const on = btn('In queue, position 1 of 1 - click to remove');
  assert.ok(on, 'the card repaints after the toggle');
  assert.equal(btn('Add to queue'), undefined, 'one toggle: the label follows the state');
  assert.equal(on.getAttribute('aria-pressed'), 'true');
  assert.ok(on.classList.contains('on') && on.classList.contains('pl-toggle') && on.classList.contains('icon'), 'the same pressed round button as the Library row');
  assert.equal(on.title, 'In queue, position 1 of 1 - click to remove');
  assert.notEqual(on.querySelector('svg').innerHTML, off.querySelector('svg').innerHTML, 'the pressed state swaps to the playlist icon');
  assert.equal(on.querySelector('svg').innerHTML, icon('playlist').innerHTML);
  assert.equal(dlg.querySelector('.card-actions .btn'), null);
  assert.equal(btn('Play'), undefined, 'no Play/Pause toggle on the card');
  on.click();
  assert.equal(player.inQueue('a'), false);
  player.playNow('o');
  assert.equal(player.current.id, 'o');
  const next = btn('Play next');
  assert.ok(next.classList.contains('icon') && next.classList.contains('round'));
  assert.equal(next.querySelector('svg').innerHTML, icon('playPlus').innerHTML, 'a play triangle with a plus, not the list icon');
  next.click();
  assert.equal(player.inQueue('a'), true, 'queued');
  assert.equal(player.current.id, 'o', 'the current song keeps playing');
  btn('Edit').click();
  assert.equal($('edit-dialog').open, true);
  assert.equal(dlg.open, true, 'the card stays under the edit dialog');
  $('edit-dialog').close();
  dlg.close();
  while (player.current) player.removeAt(0);
});

test('the card refreshes after an edit and closes when the song is deleted', () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  publish([{ ...FULL, title: 'Alpha 2', album: 'New LP' }]);
  assert.equal(dlg.querySelector('h2').textContent, 'Alpha 2 (Kav)');
  assert.equal(dlg.querySelector('.card-full').textContent, 'Zed - Alpha 2 (Kav)');
  publish([]);
  assert.equal(dlg.open, false);
});

test('a backdrop click closes the card, a click inside does not', () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  dlg.onclick(makeEvent('click', { target: dlg.querySelector('h2') }));
  assert.equal(dlg.open, true);
  dlg.onclick(makeEvent('click', { target: dlg }));
  assert.equal(dlg.open, false);
});

test('songs without audio get Download to server, not Download, and no Play when Auto-download is off', () => {
  publish([BARE]);
  openSongCard(BARE);
  const dlg = $('song-card');
  assert.deepEqual(names(dlg), ['Share link', 'Download to server', 'Edit']);
  dlg.close();
});

test('card Year fact: version year plus the original when they differ, else one year; the original year without a version year; none without any year', () => {
  assert.equal(cardModel({ ...FULL, remix_year: 2024 }, { kind: 'none' }).yearFact, '2024 · original 1999');
  assert.equal(cardModel(FULL, { kind: 'none' }).yearFact, '1999');
  assert.equal(cardModel({ ...FULL, remix_year: null }, { kind: 'none' }).yearFact, '1999');
  assert.equal(cardModel({ ...FULL, year: null, releaseYear: null, remix_year: null }, { kind: 'none' }).yearFact, '');
});

test('the sub line shows the version year', () => {
  assert.equal(cardModel({ ...FULL, remix_year: 2024 }, { kind: 'none' }).sub, 'Zed · 2024');
});

test('with a cover the title and the artist line sit inside the cover box; without one they follow as plain text', () => {
  publish([FULL, BARE]);
  openSongCard(FULL);
  const dlg = $('song-card');
  const art = dlg.querySelector('.card-art');
  assert.ok(art.querySelector('img.card-cover'));
  assert.equal(art.querySelector('.cover-text h2#song-card-title').textContent, 'Alpha (Kav)');
  assert.equal(art.querySelector('.cover-text .card-sub').textContent, 'Zed · 1999');
  assert.equal(dlg.querySelector('.card-full').textContent, 'Zed - Alpha (Kav)');
  assert.ok(!art.contains(dlg.querySelector('.card-full')));
  dlg.close();
  openSongCard(BARE);
  assert.equal(dlg.querySelector('.card-art'), null);
  assert.equal(dlg.querySelector('.card-head h2').textContent, 'Bare');
  dlg.close();
});

test('BPM, length and the credit details share one details block under the title line, in order', () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  assert.ok(!dlg.querySelector('.card-top') && !dlg.querySelector('.card-side'));
  const details = dlg.querySelector('.card-details');
  assert.ok(details);
  const texts = details.querySelectorAll('.detail').map((n) => n.textContent);
  assert.ok(!texts.some((t) => t.startsWith('Country')) && !details.querySelector('.tag'), 'the country is not in the card details');
  assert.ok(details.querySelector('.bpm-badge'));
  assert.ok(texts.some((t) => t.startsWith('Length: ')));
  assert.ok(!details.contains(dlg.querySelector('.card-tags')));
  dlg.close();
});

test('the Albums row lists every album after the version credits, "Album" for one, and is absent without albums', () => {
  const rows = (song) => {
    publish([song]);
    openSongCard(song);
    const dlg = $('song-card');
    const out = [...(dlg.querySelector('.card-details')?.querySelectorAll('.detail') ?? [])].map((n) => n.textContent);
    dlg.close();
    return out;
  };
  const one = rows({ ...FULL, albums: ['First LP'], version: { type: 'remix', name: 'Kav Remix', artists: ['Kav'] }, mainArtists: ['Zed'], featuredArtists: [], releaseYear: 1999 });
  assert.equal(one[one.length - 1], 'Album: First LP');
  assert.ok(one.indexOf('Remix by: Kav') < one.indexOf('Album: First LP'));
  const many = rows({ ...FULL, albums: ['First LP', 'Reissue'] });
  assert.equal(many[many.length - 1], 'Albums: First LP, Reissue');
  assert.equal(rows({ ...FULL, album: '', albums: [] }).filter((t) => /^Albums?:/.test(t)).length, 0);
  assert.equal(rows({ ...BARE, tags: ['country:de'] }).filter((t) => /^Albums?:/.test(t)).length, 0);
  assert.equal(rows(FULL).at(-1), 'Album: LP');
});

const withNavigator = async (nav, run) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  try { await run(); } finally { if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator; }
};

test('Copy title writes exactly the displayed line to the clipboard and toasts', async () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  const copy = dlg.querySelector('.card-copy');
  assert.equal(copy.getAttribute('aria-label'), 'Copy title');
  const written = [];
  await withNavigator({ clipboard: { writeText: async (t) => { written.push(t); } } }, async () => {
    copy.click();
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(written, ['Zed - Alpha (Kav)']);
  assert.equal(dlg.querySelector('.card-copy-note').textContent, 'Title copied');
  assert.ok(copy.classList.contains('icon') && copy.classList.contains('round'));
  assert.equal(copy.textContent, '');
  assert.ok(copy.querySelector('svg'));
  assert.equal(dlg.querySelector('.card-full').children.at(-1).children.at(-1), copy);
  dlg.close();
});

test('Copy title falls back to a hidden textarea when the clipboard API is missing', async () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  const copied = [];
  const append = document.body.append;
  const exec = document.execCommand;
  document.body.append = (n) => { copied.push(n.value); };
  document.execCommand = () => true;
  await withNavigator({}, async () => {
    dlg.querySelector('.card-copy').click();
    await new Promise((r) => setTimeout(r, 0));
  });
  document.body.append = append;
  document.execCommand = exec;
  assert.deepEqual(copied, ['Zed - Alpha (Kav)']);
  assert.equal(dlg.querySelector('.card-copy-note').textContent, 'Title copied');
  dlg.close();
});

const lineTexts = (dlg) => dlg.querySelectorAll('.card-genre-line').map((l) => l.querySelectorAll('.tag').map((t) => t.textContent));

test('the Genre row shows one line per inferred family, family chip first, then its genres by level', () => {
  resetGenreTree(buildTree(VOCAB));
  try {
    const song = { ...BARE, id: 'g', tags: ['genre:deep house', 'genre:rock and roll', 'genre:house', 'genre:zzz thing', 'country:de'] };
    publish([song]);
    openSongCard(song);
    const dlg = $('song-card');
    assert.deepEqual(lineTexts(dlg), [['Electronic', 'house', 'deep house'], ['Rock', 'rock and roll'], ['zzz thing']]);
    assert.equal(dlg.querySelectorAll('.card-genre-line .group-name').length, 0, 'no Genre caption');
    assert.equal(dlg.querySelector('[aria-label="Genres"]').getAttribute('role'), 'group');
    assert.ok(dlg.querySelectorAll('.card-genre-line .tag').every((t) => t.className === 'tag ns t-caption'), 'inferred and tagged chips share the chip style');
    dlg.querySelector('.card-close').click();
  } finally {
    resetGenreTree(null);
  }
});

test('the Genre row falls back to one line of tagged genres without a vocabulary, and is absent with none', () => {
  const song = { ...BARE, id: 'g2', tags: ['genre:trap', 'genre:house'] };
  publish([song, BARE]);
  openSongCard(song);
  let dlg = $('song-card');
  assert.deepEqual(lineTexts(dlg), [['house', 'trap']]);
  dlg.querySelector('.card-close').click();
  openSongCard(BARE);
  dlg = $('song-card');
  assert.deepEqual(lineTexts(dlg), []);
  assert.equal(dlg.querySelector('.card-genre-line'), null);
  dlg.querySelector('.card-close').click();
});

test('song card dialog width is derived from --cover-max plus its padding', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rules = css.split('\n').filter((l) => l.includes('dialog.card-dlg {'));
  assert.ok(rules.length >= 2);
  for (const r of rules) assert.match(r, /var\(--cover-max\) \+ 2 \* var\(--card-pad\)/);
  assert.equal((css.match(/--cover-max: \d+px;/g) || []).length, 1);
});


test('every round card button has hover, focus and pressed rules in one place, and the Close X is dark like the visualizer exit', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.card-dlg \.icon\.round:hover \{[^}]*hover-wash/);
  assert.match(css, /\.card-dlg \.icon\.round:focus-visible \{[^}]*hover-wash/);
  assert.match(css, /\.card-dlg \.icon\.round:active \{[^}]*pressed-wash/);
  assert.match(css, /\.card-dlg \.card-close \{[^}]*background-color: var\(--vinyl\)/);
  assert.match(css, /\.card-dlg \.card-close:hover \{[^}]*close-wash/);
});

const ENTRY = { listened: { today: 2, d7: 3, d30: 4, all: 5 }, skipped: { today: 1, d7: 1, d30: 1, all: 2 }, total_listened_s: 600 };

test('LIB-206 listeningNode shows real Skipped numbers by default', () => {
  const node = listeningNode(ENTRY);
  assert.ok(!node.querySelector('.card-listen-note'));
  const rows = node.querySelectorAll('tbody tr');
  assert.deepEqual(rows[1].querySelectorAll('td').map((c) => c.textContent), ['1', '1', '1', '2']);
});

test('LIB-206 for the song playing now the Skipped cells are a dot and a note explains it', () => {
  const node = listeningNode(ENTRY, true);
  const rows = node.querySelectorAll('tbody tr');
  assert.deepEqual(rows[0].querySelectorAll('td').map((c) => c.textContent), ['2', '3', '4', '5']);
  assert.deepEqual(rows[1].querySelectorAll('td').map((c) => c.textContent), ['·', '·', '·', '·']);
  assert.equal(node.querySelector('.card-listen-note').textContent, 'Playing now: the result counts when the song ends.');
  assert.match(node.textContent, /Total listened: 10 min/);
});

test('LIB-206 isPlayingNow is false for a song that is not the current one', () => {
  assert.equal(isPlayingNow('not-in-the-queue'), false);
});
