import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage, makeEvent, stubFetch, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { initPlayer } = await import('./player.js');
initPlayer();
const { openSongCard } = await import('./song-card.js');
const { prefs } = await import('./library-data.js');

const SONG = { id: 's1', title: 'Pressure', mainArtists: ['Nadia Ali', 'Starkillers'], featuredArtists: [], releaseYear: 2010, albums: ['LP'], genres: ['house'], tags: [], version: { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'], releaseYear: 2012 }, file: null, audio_state: 'none' };
const BARE = { id: 's2', title: 'Bare', mainArtists: ['Solo'], featuredArtists: [], tags: [], file: null, audio_state: 'none' };
const publish = (songs) => { store.songs = songs; store.loaded = true; store.listeners.forEach((fn) => fn()); };
const dlg = () => document.getElementById('song-card');
const parts = () => dlg().querySelectorAll('.tp-part');
const pops = () => dlg().querySelectorAll('.tp-pop');
const open = (song) => { publish([song]); openSongCard(song); };

test('parts are buttons, hover and focus open nothing, click opens the popover', () => {
  open(SONG);
  assert.equal(parts().length, 4);
  assert.equal(dlg().querySelector('.card-full').textContent, 'Nadia Ali & Starkillers - Pressure (Alesso Remix)');
  const [a] = parts();
  assert.equal(a.getAttribute('type'), 'button');
  fire(a, 'mouseover');
  fire(a, 'mouseenter');
  fire(a, 'focus');
  assert.equal(pops().length, 0);
  a.click();
  assert.equal(pops().length, 1);
  assert.equal(a.getAttribute('aria-expanded'), 'true');
  const pop = pops()[0];
  assert.equal(pop.getAttribute('role'), 'dialog');
  const head = pop.querySelector('.tp-head');
  assert.equal(pop.getAttribute('aria-labelledby'), head.id);
  assert.equal(head.textContent, 'Nadia Ali');
  assert.ok(pop.querySelector('.tp-link'));
  dlg().close();
});

test('a second click on the same part closes it; another part replaces it (one at a time)', () => {
  open(SONG);
  const [a, , title, ver] = parts();
  a.click();
  a.click();
  assert.equal(pops().length, 0);
  a.click();
  title.click();
  assert.equal(pops().length, 1);
  assert.equal(a.getAttribute('aria-expanded'), 'false');
  assert.equal(pops()[0].querySelector('.tp-head').textContent, 'Pressure');
  assert.deepEqual(pops()[0].querySelectorAll('.tp-label').map((n) => n.textContent), ['Year of release', 'Album', 'Genres']);
  assert.equal(pops()[0].querySelector('.tp-link'), null);
  ver.click();
  assert.equal(pops().length, 1);
  assert.equal(pops()[0].querySelector('.tp-val').textContent, '2012');
  dlg().close();
});

test('artist popover shows the stub rows and a filter link that sets the library search', () => {
  open(SONG);
  parts()[1].click();
  assert.deepEqual(pops()[0].querySelectorAll('.tp-label').map((n) => n.textContent), ['Country', 'Genres', 'Years of activity']);
  pops()[0].querySelector('.tp-link').click();
  assert.equal(prefs.query, 'Starkillers');
  assert.equal(dlg().open, false);
  assert.equal(pops().length, 0);
  prefs.query = '';
});

test('Escape closes the popover and refocuses the part without closing the card; outside click closes', () => {
  open(SONG);
  const [a] = parts();
  a.click();
  const ev = makeEvent('keydown', { key: 'Escape', bubbles: true, target: a });
  document.dispatchEvent(ev);
  assert.equal(pops().length, 0);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(document.activeElement, a);
  assert.equal(dlg().open, true);
  a.click();
  document.dispatchEvent(makeEvent('click', { target: dlg().querySelector('h2'), bubbles: true }));
  assert.equal(pops().length, 0);
  a.click();
  document.dispatchEvent(makeEvent('click', { target: pops()[0], bubbles: true }));
  assert.equal(pops().length, 1);
  dlg().close();
  assert.equal(document.querySelectorAll('.tp-pop').length, 0);
});

test('a song without data says No details yet and the copy button stays last in the line', () => {
  open(BARE);
  const title = parts().find((p) => p.classList.contains('tp-title'));
  title.click();
  assert.equal(pops()[0].querySelector('.tp-empty').textContent, 'No details yet');
  const copy = dlg().querySelector('.card-copy');
  assert.ok(copy);
  assert.equal(dlg().querySelector('.card-full').children.at(-1).children.at(-1), copy);
  dlg().close();
});

test('css: title parts turn azure on hover, focus and while open, never underlined', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rules = css.split('\n').filter((l) => l.startsWith('.tp-part'));
  assert.ok(rules.length >= 3);
  assert.ok(!rules.some((l) => /underline/.test(l)));
  assert.match(css, /\.tp-part:hover, \.tp-part:focus-visible \{ color: var\(--accent-ink\); \}/);
  assert.match(css, /\.tp-part\[aria-expanded="true"\] \{ color: var\(--accent-strong\); \}/);
  assert.match(css, /\.tp-part \{[^}]*transition: color var\(--dur-fast\)/);
  assert.match(css, /\.card-full-tail \{ white-space: nowrap; \}/);
});

test('the copy icon shares a nowrap tail with the last glued words and stays last in the DOM', () => {
  publish([SONG, BARE]);
  open(SONG);
  const p = dlg().querySelector('.card-full');
  const tail = p.querySelector('.card-full-tail');
  assert.ok(tail);
  assert.equal(p.lastChild, tail);
  assert.equal(tail.lastChild, dlg().querySelector('.card-copy'));
  assert.equal(tail.textContent.replace(/\s/g, ''), '(AlessoRemix)');
  dlg().close();
});

test('a remaster version is plain text, other versions and a line with no artist keep their parts', () => {
  const mk = (id, version, extra = {}) => ({ id, title: 'Minor Earth, Major Sky', mainArtists: ['A-ha'], featuredArtists: [], tags: [], version, file: null, audio_state: 'none', ...extra });
  const cases = [
    [mk('r1', { type: 'remaster', name: '2019 Remaster' }), false],
    [mk('r2', { type: 'other', name: 'Remastered 2011' }), false],
    [mk('r3', { type: 'edit', name: 'Radio Edit' }), true],
    [mk('r4', { type: 'remix', name: 'Alesso Remix', artists: ['Alesso'] }), true],
  ];
  for (const [song, versionPart] of cases) {
    open(song);
    const kinds = [...parts()].map((p) => p.className.replace('tp-part ', ''));
    assert.equal(kinds.includes('tp-version'), versionPart, song.version.name);
    assert.ok(kinds.includes('tp-title'));
    assert.ok(dlg().querySelector('.card-full').textContent.includes(`(${song.version.name})`));
    dlg().close();
  }
  open(mk('r5', { type: 'remaster', name: 'Remaster' }, { mainArtists: [] }));
  const only = [...parts()];
  assert.equal(only.length, 1);
  only[0].click();
  assert.equal(pops().length, 1);
  dlg().close();
});
