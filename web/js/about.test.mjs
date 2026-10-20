import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { renderAbout, ABOUT } = await import('./about.js');

const mount = () => { const root = document.createElement('div'); renderAbout(root); return root; };

test('about: page head and the section headings', () => {
  const root = mount();
  assert.equal(root.querySelector('h1').textContent, 'About');
  assert.deepEqual([...root.querySelectorAll('h2')].map((h) => h.textContent),
    ['How genres are organised', 'Genres, groups and modifiers', 'Examples', 'Read more']);
});

test('about: the axes table has a caption, scoped headers and one row per axis', () => {
  const root = mount();
  const t = root.querySelector('table');
  assert.equal(t.querySelector('caption').textContent, 'The four axes');
  assert.equal(t.querySelectorAll('th[scope="col"]').length, 3);
  assert.deepEqual([...t.querySelectorAll('tbody th[scope="row"]')].map((c) => c.textContent),
    ['Form', 'Medium', 'Purpose', 'Tradition']);
  assert.equal(t.querySelectorAll('tbody tr').length, 4);
  assert.ok(!t.textContent.includes('Mood'));
  assert.ok(root.textContent.includes('Mood stays personal: it is how a song feels to you, so it is not shared vocabulary.'));
});

test('about: four bullets, four examples', () => {
  const secs = mount().querySelectorAll('section');
  assert.equal(secs[1].querySelectorAll('li').length, 4);
  assert.equal(secs[2].querySelectorAll('li').length, 4);
});

test('about: documentation links open in a new tab with rel noopener', () => {
  const links = [...mount().querySelectorAll('a')];
  assert.equal(links.length, 2);
  for (const a of links) {
    assert.match(a.getAttribute('href'), /^https:\/\/github\.com\/alexisayenko\/project-audioplayer\/blob\/main\/docs\/tech\//);
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
  }
});

test('about: no placeholder text, no private details, works without a session', () => {
  const text = mount().textContent;
  assert.doesNotMatch(text, /coming soon/i);
  assert.doesNotMatch(text, /@|localhost/);
  assert.ok(text.includes(ABOUT.intro));
});

test('about: the prototype-category sentence is in the genres intro', () => {
  const sentence = 'Genres work like colour names: everyone agrees on the centre of green, but nobody can say exactly where blue turns into green, so a genre has a clear centre and a soft border.';
  assert.ok(ABOUT.genres.text.includes(sentence));
  assert.ok(mount().textContent.includes(sentence));
});
