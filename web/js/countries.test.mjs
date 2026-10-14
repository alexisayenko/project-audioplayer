import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_NAMES, COUNTRY_ALIASES, HISTORICAL_COUNTRIES } from './countries-data.js';
import { COUNTRY_CODES, normCountry, canonicalCountry, countryName, filterCountries, isKnownCountry, isHistoricalCountry } from './countries.js';

test('normCountry strips accents, punctuation, articles and case', () => {
  assert.equal(normCountry("  The Côte d'Ivoire "), 'cote divoire');
  assert.equal(normCountry('U.S.A.'), 'usa');
  assert.equal(normCountry('the Netherlands'), 'netherlands');
  assert.equal(normCountry(null), '');
  assert.equal(normCountry(undefined), '');
  assert.equal(normCountry('Guinea-Bissau'), 'guinea bissau');
});

test('canonicalCountry resolves codes, names and aliases, rejects unknown', () => {
  assert.equal(canonicalCountry('UK'), 'gb');
  assert.equal(canonicalCountry('Deutschland'), 'de');
  assert.equal(canonicalCountry('de'), 'de');
  assert.equal(canonicalCountry('Atlantis'), null);
  assert.equal(canonicalCountry(''), null);
  assert.equal(isKnownCountry('Narnia'), false);
  assert.equal(isKnownCountry('France'), true);
});

test('every alias points to a known code and every code is its own alias', () => {
  const codes = new Set(Object.keys(COUNTRY_NAMES));
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    assert.ok(codes.has(code), `alias ${alias} -> unknown ${code}`);
    assert.equal(alias, normCountry(alias), `alias ${alias} is not normalised`);
  }
  for (const c of codes) assert.equal(COUNTRY_ALIASES[c], c, `code ${c} must resolve to itself`);
  assert.equal(COUNTRY_CODES.length, codes.size);
});

test('historical countries are known and named from the table', () => {
  for (const h of HISTORICAL_COUNTRIES) {
    assert.ok(COUNTRY_NAMES[h]);
    assert.ok(isHistoricalCountry(h.toUpperCase()));
    assert.equal(countryName(h), COUNTRY_NAMES[h]);
  }
  assert.equal(isHistoricalCountry('de'), false);
});

test('countryName names known codes; unknown codes still yield a string', () => {
  assert.equal(typeof countryName('zz'), 'string');
  assert.match(countryName('de'), /German/);
});

test('filterCountries ranks exact first, honours the limit, empty on junk', () => {
  assert.equal(filterCountries('de')[0].code, 'de');
  assert.equal(filterCountries('', 5).length, 5);
  assert.equal(filterCountries('zzzzzz').length, 0);
  assert.ok(filterCountries('uni').some((c) => c.code === 'gb'));
  assert.ok(filterCountries('a', 3).length <= 3);
});
