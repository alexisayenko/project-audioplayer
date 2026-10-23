import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptGenresV2, hasStructure } from './genres-v2-adapter.js';

const payload = {
  version: 2,
  clusters: [{ id: 'edm-dance', name: 'EDM / Dance', colour: '#D52633' }],
  genres: [
    { id: 'house', name: 'House', level: 1, cluster: 'edm-dance', parents: [], v1: 'house', description: 'Four on the floor.', source_links: [{ source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/House_music', kind: 'page' }] },
    { id: 'drum-n-bass', name: "Drum 'n' Bass", level: 1, cluster: 'edm-dance', parents: [], v1: 'drum and bass', description: null, source_links: [] },
    { id: 'lonely', name: 'Lonely', level: 1, cluster: 'edm-dance', parents: [], v1: null, description: null, source_links: [] },
  ],
};

test('level 1 genres become families and forms without levels', () => {
  const v = adaptGenresV2(payload);
  assert.deepEqual(v.families, ['House', "Drum 'n' Bass", 'Lonely']);
  assert.deepEqual(Object.keys(v.forms), v.families);
  assert.deepEqual(v.levels, {});
  assert.equal(v.forms.House.description, 'Four on the floor.');
  assert.deepEqual(v.hex, { House: '#D52633' });
  assert.equal(v.forms.House.colour, null);
  assert.equal(v.forms["Drum 'n' Bass"].colour, 'House');
  assert.equal(v.forms.Lonely.colour, 'House');
  assert.deepEqual(v.forms["Drum 'n' Bass"].synonyms, ['drum and bass']);
  assert.deepEqual(v.forms.House.synonyms, []);
  assert.deepEqual(v.forms.House.parents, []);
});

test('the dock data keeps the cluster name, the v1 mapping and the links', () => {
  const v = adaptGenresV2(payload);
  assert.equal(v.v2.byName.House.clusterName, 'EDM / Dance');
  assert.equal(v.v2.byName.House.v1, 'house');
  assert.equal(v.v2.byName.Lonely.v1, null);
  assert.equal(v.v2.byName.House.source_links.length, 1);
});

test('a genre with parents goes to levels with parent names', () => {
  const v = adaptGenresV2({ ...payload, genres: [...payload.genres, { id: 'deep', name: 'Deep', level: 2, cluster: 'edm-dance', parents: ['house'], v1: null }] });
  assert.deepEqual(v.levels.Deep.parents, ['House']);
  assert.deepEqual(v.families.includes('Deep'), false);
});

test('hasStructure needs at least one level 1 genre', () => {
  assert.equal(hasStructure(payload), true);
  assert.equal(hasStructure({ version: 2, clusters: [], genres: [] }), false);
  assert.equal(hasStructure(null), false);
});

test('a cluster without a colour gives no hex and no colour link', () => {
  const v = adaptGenresV2({ ...payload, clusters: [{ id: 'edm-dance', name: 'EDM / Dance' }] });
  assert.deepEqual(v.hex, {});
  assert.equal(v.forms.House.colour, null);
});

test('the cluster colour reaches the map slot of every circle', async () => {
  const { buildTree } = await import('./genre-levels.js');
  const { familyIndex } = await import('./genre-data.js');
  const t = buildTree(adaptGenresV2(payload));
  const slots = new Set(t.roots.map((r) => familyIndex(r.name)));
  assert.equal(slots.size, 1);
});

test('a later v1 tree build for cards does not overwrite the map colours', async () => {
  const { buildTree } = await import('./genre-levels.js');
  const { claimMapColours, mapOwnsColours, familyIndex } = await import('./genre-data.js');
  const t = buildTree(adaptGenresV2(payload));
  claimMapColours();
  assert.equal(mapOwnsColours(), true);
  const slot = familyIndex(t.roots[0].name);
  const before = globalThis.document?.documentElement?.style?.getPropertyValue(`--chart-${slot}`);
  buildTree({ families: ['Rock'], levels: {}, forms: {}, hex: {} }, { colours: false });
  assert.equal(familyIndex(t.roots[0].name), slot);
  assert.equal(globalThis.document?.documentElement?.style?.getPropertyValue(`--chart-${slot}`), before);
});
