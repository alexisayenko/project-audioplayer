import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songSearchText } from './search-text.js';

const has = (s, q) => songSearchText(s).includes(q.toLocaleLowerCase());

const mashup = { title: 'Кончится лето', artists: ['Yaukoshi'], featured: [], version: { kind: 'mashup', name: 'Mashup', by: [], of: ['Цой', 'LXST CXNTURY'] } };
const tsoi = { title: 'Дети минут', artists: ['Виктор Цой'], featured: [] };
const remix = { title: 'Running Up That Hill', artists: ['Kate Bush'], featured: [], version: { kind: 'remix', name: 'Orkidea Remix', by: ['Orkidea'], of: [] } };
const v2 = { title: 'Song', artists: ['Main'], featured: [], version: { kind: 'cover', name: 'Acoustic Cover', artists: ['Remixer X'], originalArtists: ['Original Y'] } };
const legacy = { title: 'Plain', artist: 'Solo', album: 'Alb', remixer: '' };
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
});

test('extra text is appended', () => {
  assert.ok(songSearchText(tsoi, ['rock']).includes('rock'));
});
