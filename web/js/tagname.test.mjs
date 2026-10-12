import assert from 'node:assert/strict';
import { decadeTag, withDecade, tagLabel, tagText, tagSearchText, tagGroups, groupName } from './tagname.js';

for (const [y, t] of [[1949, null], [1950, 'decade:50s'], [1994, 'decade:90s'], [2000, 'decade:00s'], [2007, 'decade:00s'], [2013, 'decade:10s'], [2029, 'decade:20s'], [2030, null], [null, null], [NaN, null]]) {
  assert.equal(decadeTag(y), t, String(y));
}
assert.deepEqual(withDecade(['x', 'decade:80s'], 1994), ['x', 'decade:90s']);
assert.deepEqual(withDecade(['x'], 1994), ['x', 'decade:90s']);
assert.deepEqual(withDecade(['decade:80s'], 1949), ['decade:80s']);
assert.deepEqual(withDecade(['decade:80s'], null), ['decade:80s']);

assert.equal(tagLabel('decade:90s'), 'the 90s');
assert.equal(tagLabel('decade:00s'), 'the 00s');
assert.equal(tagLabel('decade:weird'), 'weird');
assert.equal(tagText('decade:90s'), 'decade:the 90s');
assert.ok(tagSearchText('decade:90s').includes('90s'));
assert.equal(groupName('decade'), 'Decade');

const g = tagGroups([{ tag: 'x', count: 1 }, { tag: 'lang:ru', count: 1 }, { tag: 'decade:10s', count: 1 }, { tag: 'decade:90s', count: 1 }, { tag: 'decade:00s', count: 1 }, { tag: 'country:lt', count: 1 }, { tag: 'genre:pop', count: 1 }]);
assert.deepEqual(g.map((x) => x.key), ['genre', 'decade', 'country', 'lang', '']);
assert.deepEqual(g[1].tags.map((t) => t.tag), ['decade:90s', 'decade:00s', 'decade:10s']);
