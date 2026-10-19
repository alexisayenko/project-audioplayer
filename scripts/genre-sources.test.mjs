import test from "node:test";
import assert from "node:assert/strict";
import { flattenApple, indexByNorm, matchSource, normalise } from "./genre-sources-lib.mjs";

test("normalise folds case, accents, & and and, hyphens, spaces and a music suffix", () => {
  assert.equal(normalise("Drum & Bass"), normalise("drum and bass"));
  assert.equal(normalise("Hip-Hop"), normalise("hip hop"));
  assert.equal(normalise("House Music"), normalise("house"));
  assert.equal(normalise("Bossa Nová"), normalise("bossa nova"));
  assert.equal(normalise("Rock 'n' Roll"), normalise("rock n roll"));
  assert.notEqual(normalise("music box"), normalise("box"));
});

const catalogue = [
  { id: "1", name: "House" },
  { id: "2", name: "Hip-Hop/Rap" },
  { id: "3", name: "Drum & Bass" },
  { id: "4", name: "Dance" },
  { id: "5", name: "Dance" },
  { id: "6", name: "Techno" },
];
const idx = indexByNorm(catalogue, (x) => x.name);
const run = (genres) => matchSource(genres, idx, (x) => x.id, (x) => `${x.name} (${x.id})`);

test("a name match is exact after normalisation", () => {
  const r = run([{ name: "house", synonyms: [] }, { name: "drum and bass", synonyms: [] }, { name: "trance", synonyms: [] }]);
  assert.deepEqual(Object.keys(r.matches).sort(), ["drum and bass", "house"]);
  assert.equal(r.matches.house.match, "name");
  assert.equal(r.review.length, 0);
});

test("a synonym matches only when the name does not", () => {
  const r = run([{ name: "house", synonyms: ["techno"] }, { name: "hip hop", synonyms: ["hip-hop/rap"] }]);
  assert.equal(r.matches.house.item.id, "1");
  assert.equal(r.matches["hip hop"].match, "synonym");
});

test("a fuzzy near-name is not matched", () => {
  const r = run([{ name: "deep house", synonyms: [] }, { name: "technos", synonyms: [] }]);
  assert.deepEqual(r.matches, {});
});

test("several candidates for one genre go to the review list, not the data", () => {
  const r = run([{ name: "dance", synonyms: [] }]);
  assert.deepEqual(r.matches, {});
  assert.equal(r.review.length, 2);
  assert.match(r.review[0].reason, /several name candidates/);
});

test("a target claimed by two genres goes to the winner by name, the other to review", () => {
  const r = run([{ name: "techno", synonyms: [] }, { name: "minimal techno", synonyms: ["techno"] }]);
  assert.equal(r.matches.techno.item.id, "6");
  assert.equal(r.matches["minimal techno"], undefined);
  assert.equal(r.review.length, 1);
  assert.match(r.review[0].reason, /already matched by name to "techno"/);
});

test("a target claimed by two synonyms is reviewed for both", () => {
  const r = run([{ name: "a", synonyms: ["house"] }, { name: "b", synonyms: ["house"] }]);
  assert.deepEqual(r.matches, {});
  assert.equal(r.review.length, 2);
});

test("flattenApple walks nested subgenres with depth and path", () => {
  const doc = { 34: { name: "Music", id: "34", subgenres: { 21: { name: "Rock", id: "21", subgenres: { 1: { name: "Hard Rock", id: "1" } } } } } };
  assert.deepEqual(flattenApple(doc).map((x) => [x.id, x.depth, x.path.join(">")]), [["21", 1, "Music>Rock"], ["1", 2, "Music>Rock>Hard Rock"]]);
});
