import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanUrl, cleanPasted, classifySoundcloud, sourceOf } from './url-clean.js';
import { splitTag, decadeTag, decadeRank } from './tagname.js';
import { completeTag, splitInput } from './tag-input.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../server/tests/fixtures/${name}`, import.meta.url), 'utf8'));
const urls = read('url_clean_cases.json');
const tags = read('tag_cases.json');

test('cleanUrl matches the shared cases', () => {
  for (const c of urls.clean) assert.equal(cleanUrl(c.input), c.output, JSON.stringify(c.input));
});

test('cleanPasted matches the shared cases', () => {
  for (const c of urls.pasted) assert.equal(cleanPasted(c.input), c.output, JSON.stringify(c.input));
});

test('classifySoundcloud matches the shared cases', () => {
  for (const c of urls.soundcloud) {
    const got = classifySoundcloud(c.input);
    if (c.kind === null) assert.equal(got, null, c.input);
    else assert.deepEqual(got, { kind: c.kind, url: c.url }, c.input);
  }
});

test('sourceOf matches the shared cases', () => {
  for (const c of urls.source_of) assert.equal(sourceOf(c.id), c.source, c.id);
});

test('the tag helpers match the shared cases', () => {
  for (const c of tags.split_tag) assert.deepEqual(splitTag(c.tag), { key: c.key, value: c.value }, c.tag);
  const now = new Date('2026-06-01T00:00:00Z');
  for (const c of tags.decade_tag) assert.equal(decadeTag(c.year, now), c.tag, String(c.year));
  for (const c of tags.decade_rank) assert.equal(decadeRank(c.tag), c.rank, c.tag);
  for (const c of tags.complete_tag) assert.equal(completeTag(c.input), c.output, JSON.stringify(c.input));
  for (const c of tags.split_input) assert.deepEqual(splitInput(c.input), { tags: c.tags, rest: c.rest }, JSON.stringify(c.input));
});
