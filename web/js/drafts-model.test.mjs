import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage } from './test-dom.mjs';

await installPage();
const M = await import('./drafts-model.js');

const CASES = JSON.parse(readFileSync(new URL('../../server/tests/fixtures/draft_lines.json', import.meta.url), 'utf8'));

for (const c of CASES) {
  test(`a line is split into text and a cleaned link: ${c.line}`, () => {
    const { text, url } = M.lineParts(c.line);
    assert.deepEqual([text, url, M.sourceOfUrl(url)], [c.text, c.url, c.source]);
  });
}

test('lines are split on any newline, trimmed and empty ones dropped', () => {
  assert.deepEqual(M.splitLines('  a \r\n\r\n b\rc\n   \n'), ['a', 'b', 'c']);
  assert.deepEqual(M.splitLines(null), []);
});

test('prepare keeps the first 100 lines, skips lines over 300 characters and returns the rest', () => {
  const many = Array.from({ length: 130 }, (_, i) => `A - Song ${i}`);
  many[3] = 'x'.repeat(301);
  const prep = M.prepare(many.join('\n'));
  assert.equal(prep.lines.length, 99);
  assert.equal(prep.rest.length, 30);
  assert.equal(prep.rest[0], 'A - Song 100');
  assert.deepEqual(prep.counts, { lines: 130, overLineCap: 30, tooLong: 1 });
  assert.equal(M.prepare('y'.repeat(300)).lines.length, 1);
  assert.deepEqual(M.prepare('   \n').lines, []);
});

test('source of a link: YouTube, SoundCloud track or short link, other http(s) link, none', () => {
  assert.equal(M.sourceOfUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(M.sourceOfUrl('https://soundcloud.com/a/b'), 'soundcloud');
  assert.equal(M.sourceOfUrl('https://on.soundcloud.com/AbC123'), 'soundcloud');
  assert.equal(M.sourceOfUrl('https://soundcloud.com/discover'), 'link');
  assert.equal(M.sourceOfUrl('https://vimeo.com/1'), 'link');
  assert.equal(M.sourceOfUrl('ftp://x'), null);
  assert.equal(M.sourceOfUrl(''), null);
});

test('rawLine joins the text and the link; titleOf falls back to the link, then the raw line', () => {
  assert.equal(M.rawLine({ text: 'A - B', url: 'https://x.org/a' }), 'A - B https://x.org/a');
  assert.equal(M.rawLine({ text: '', url: '' }), '');
  assert.equal(M.titleOf({ title: 'Song', url: 'https://x.org/a' }), 'Song');
  assert.equal(M.titleOf({ title: '', url: 'https://www.x.org/a/b' }), 'x.org/a/b');
  assert.equal(M.titleOf({ title: '', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(M.titleOf({ title: '', url: '', text: 'raw' }), 'raw');
  assert.equal(M.linkLabel('not a url'), 'not a url');
});

test('status marks: in library, fetched, not fetched, failed, link only, text only', () => {
  const kinds = (d) => M.statusOf(d).kind;
  assert.equal(kinds({ inLibrary: true, state: 'new', source: 'youtube' }), 'library');
  assert.equal(M.statusOf({ state: 'fetched', source: 'youtube' }).label, 'Fetched');
  assert.equal(M.statusOf({ state: 'new', source: 'soundcloud' }).label, 'Not fetched yet');
  assert.equal(M.statusOf({ state: 'failed', source: 'youtube' }).label, 'Could not fetch');
  assert.equal(M.statusOf({ state: 'new', source: 'link' }).label, 'Link only');
  assert.equal(M.statusOf({ state: 'new', source: null }).label, 'Text only');
});

test('only unfetched YouTube and SoundCloud drafts can be refreshed', () => {
  assert.equal(M.canRefresh({ source: 'youtube', state: 'new' }), true);
  assert.equal(M.canRefresh({ source: 'youtube', state: 'failed' }), true);
  assert.equal(M.canRefresh({ source: 'youtube', state: 'fetched' }), false);
  assert.equal(M.canRefresh({ source: 'link', state: 'new' }), false);
  assert.equal(M.canRefresh({ source: null, state: 'new' }), false);
});

test('Add properly: a supported link is loaded as pasted; otherwise a note and the draft credits wait for the link', () => {
  const link = { id: 'd_1', source: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', text: 'A - B', title: 'B', mainArtists: ['A'], featuredArtists: [], withArtists: [], version: null };
  const plan = M.addPlan(link);
  assert.equal(plan.url, link.url);
  assert.equal(plan.credits, null);
  assert.match(plan.note, /^From your drafts: A - B\.$/);
  const text = M.addPlan({ ...link, source: null, url: '' });
  assert.equal(text.url, '');
  assert.deepEqual(text.credits, { title: 'B', mainArtists: ['A'], featuredArtists: [], withArtists: [], version: null });
  assert.match(text.note, /Paste its YouTube or SoundCloud link to continue\. Title and Artists start from your text\.$/);
  const bare = M.addPlan({ id: 'd_2', source: 'link', url: 'https://x.org/a', text: '', title: '' });
  assert.equal(bare.credits, null);
  assert.match(bare.note, /https:\/\/x\.org\/a\./);
});

test('a paste puts new drafts first and gives updated rows their place back', () => {
  const items = [{ id: 'a', text: '' }, { id: 'b', text: 'x' }];
  const merged = M.mergePaste(items, { created: [{ id: 'n1' }, { id: 'n2' }], updated: [{ id: 'a', text: 'new' }] });
  assert.deepEqual(merged.map((d) => d.id), ['n1', 'n2', 'a', 'b']);
  assert.equal(merged[2].text, 'new');
  assert.deepEqual(M.mergePaste(items, {}).map((d) => d.id), ['a', 'b']);
  assert.deepEqual(M.replaceDraft(items, { id: 'b', text: 'y' }).map((d) => d.text), ['', 'y']);
});

test('the paste summary says how many were added and why others were left out', () => {
  assert.equal(M.summarize({ created: 1 }), 'Added 1 draft.');
  assert.equal(M.summarize({ created: 0 }), 'Nothing new to add.');
  const text = M.summarize(
    { created: 3, updated: 2, duplicates: 4, tooLong: 1, overCap: 5, unfetched: 2, rateLimited: true },
    { tooLong: 1, overLineCap: 30 },
  );
  assert.match(text, /^Added 3 drafts\./);
  assert.match(text, /2 drafts updated with the pasted text\./);
  assert.match(text, /4 already in your drafts\./);
  assert.match(text, /2 lines skipped \(over 300 characters\)\./);
  assert.match(text, /Only 100 lines are added at once: 30 left in the box\./);
  assert.match(text, /The draft limit is reached: 5 not added\./);
  assert.match(text, /2 not fetched yet \(YouTube is limiting requests\)\. Use Refresh on a row later\./);
  assert.match(M.summarize({ created: 1, unfetched: 1, rateLimited: false }), /lookup incomplete/);
  assert.equal(M.countText(1), '1 draft');
  assert.equal(M.countText(0), '0 drafts');
});

test('the empty-state text and the placeholder are the specified ones', () => {
  assert.equal(M.EMPTY_TEXT, 'No drafts yet. Paste "Artist - Title" or links above to collect songs to add later.');
  assert.equal(M.PLACEHOLDER, 'Paste "Artist - Title" or links, one per line');
});
