import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songSearchText } from './search-text.js';

const has = (s, q) => songSearchText(s).includes(q.toLocaleLowerCase());

const mashup = { title: 'Кончится лето', mainArtists: ['Yaukoshi'], featuredArtists: [], version: { type: 'mashup', name: 'Mashup', artists: [], originalArtists: ['Цой', 'LXST CXNTURY'] } };
const tsoi = { title: 'Дети минут', mainArtists: ['Виктор Цой'], featuredArtists: [] };
const remix = { title: 'Running Up That Hill', mainArtists: ['Kate Bush'], featuredArtists: [], version: { type: 'remix', name: 'Orkidea Remix', artists: ['Orkidea'] } };
const v2 = { title: 'Song', mainArtists: ['Main'], featuredArtists: [], version: { type: 'cover', name: 'Acoustic Cover', artists: ['Remixer X'], originalArtists: ['Original Y'] } };
const legacy = { title: 'Plain', artist: 'Solo', album: 'Alb', remixer: '' };
const adr24Ver = { title: 'Mid', artist: 'Solo', version: { kind: 'mashup', name: 'M', by: ['Cee'], of: ['Src One'] } };
const legacyVer = { title: 'Old', artist: 'Solo', version: { of: 'Single Name', by: ['Bee'] } };

test('cyrillic version artists are found, case-insensitively', () => {
  assert.ok(has(mashup, 'цой'));
  assert.ok(has(mashup, 'ЦОЙ'));
  assert.ok(has(mashup, 'lxst cxntury'));
  assert.ok(has(tsoi, 'цой'));
});

test('remixer and version name are found', () => {
  assert.ok(has(remix, 'orkidea'));
  assert.ok(has(remix, 'kate bush'));
});

test('v2 names are read', () => {
  assert.ok(has(v2, 'remixer x'));
  assert.ok(has(v2, 'original y'));
  assert.ok(has(v2, 'acoustic cover'));
});

test('song without a version and legacy-only songs', () => {
  assert.ok(!has(tsoi, 'lxst'));
  assert.ok(has(legacy, 'solo'));
  assert.ok(has(legacy, 'alb'));
  assert.ok(has(legacyVer, 'single name'));
  assert.ok(has(legacyVer, 'bee'));
  assert.ok(has(adr24Ver, 'cee'));
  assert.ok(has(adr24Ver, 'src one'));
});

test('extra text is appended', () => {
  assert.ok(songSearchText(tsoi, ['rock']).includes('rock'));
});
