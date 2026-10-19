import test from "node:test";
import assert from "node:assert/strict";
import { buildResolver, diffGenre, leadSentence, linkTargets, parseInfobox, parseLead, stripWikitext } from "./genre-hierarchy-lib.mjs";

const TECH_HOUSE = `{{Short description|Subgenre of house music}}
{{Infobox music genre
| name = Tech house
| bgcolor = crimson
| stylistic_origins = {{hlist|[[House music|House]]|[[Techno]]|[[Minimal techno]]}}<ref>x</ref>
| cultural_origins = Mid-1980s, [[Chicago]]
| derivatives = [[Deep tech]]
}}
'''Tech house''' is a [[subgenre]] of [[house music]] and [[techno]] that [[Music of Detroit|emerged]] in the early 1990s.<ref>y</ref> It is more.
`;

test("stripWikitext removes nested templates, refs and comments", () => {
  assert.equal(stripWikitext("a{{b|{{c}}}}d<!-- x -->e<ref>r</ref>f"), "adef");
});

test("linkTargets drops anchors, labels, files, categories and generic names", () => {
  assert.deepEqual(linkTargets("[[House music|House]], [[Techno#History]] [[File:x.jpg|thumb]] [[Category:Y]] [[Music genre]] [[Deep_house]]"), ["House music", "Techno", "Deep house"]);
});

test("the lead sentence skips templates and stops at the first full stop", () => {
  const s = leadSentence(TECH_HOUSE);
  assert.match(s, /^Tech house is a/);
  assert.ok(!s.includes("It is more"));
});

test("parseLead reads 'subgenre of' with a link list and ignores links after the stop word", () => {
  const got = parseLead(TECH_HOUSE);
  assert.deepEqual(got.map((x) => [x.label, x.phrase_kind]), [["house music", "subgenre"], ["techno", "subgenre"]]);
});

test("parseLead reads fusion, genre-of and offshoot phrases", () => {
  assert.deepEqual(parseLead("'''Jazz fusion''' is a [[music genre]] that is a fusion of [[jazz]] and [[rock music|rock]].").map((x) => [x.label, x.phrase_kind]), [["jazz", "fusion"], ["rock music", "fusion"]]);
  assert.deepEqual(parseLead("'''Dub''' is a genre of [[reggae]] from [[Jamaica]].").map((x) => x.label), ["reggae"]);
  assert.deepEqual(parseLead("'''Grime''' is an offshoot of [[UK garage]] and [[jungle]].").map((x) => [x.label, x.phrase_kind]), [["UK garage", "offshoot"], ["jungle", "offshoot"]]);
  assert.deepEqual(parseLead("'''Trap''' evolved from [[Southern hip hop]].").map((x) => x.phrase_kind), ["offshoot"]);
});

test("parseLead returns nothing when no phrase is present", () => {
  assert.deepEqual(parseLead("'''Foo''' is a thing with [[Bar]]."), []);
  assert.deepEqual(parseLead(""), []);
});

test("parseInfobox reads origins and derivatives and drops refs", () => {
  assert.deepEqual(parseInfobox(TECH_HOUSE), { origins: ["House music", "Techno", "Minimal techno"], derivatives: ["Deep tech"] });
  assert.deepEqual(parseInfobox("no infobox"), { origins: [], derivatives: [] });
});

const vocab = [
  { name: "house", synonyms: ["house music"] },
  { name: "techno", synonyms: [] },
  { name: "electronic", synonyms: ["electronic dance music"] },
  { name: "deep house", synonyms: ["deep"] },
  { name: "hip hop", synonyms: ["rap"] },
  { name: "dup a", synonyms: ["shared"] },
  { name: "dup b", synonyms: ["shared"] },
];
const sources = { techno: { wikipedia: { title: "Techno", wikidata: "Q42", match: "name" } }, "deep house": { wikipedia: { title: "Deep house", wikidata: "Q43", match: "name" } } };

test("the resolver maps a title, a name, a synonym and a Wikidata id back to a key", () => {
  const r = buildResolver(vocab, sources);
  assert.equal(r.label("House music"), "house");
  assert.equal(r.label("Electronic dance music"), "electronic");
  assert.equal(r.label("Rap music"), "hip hop");
  assert.equal(r.label("Techno"), "techno");
  assert.equal(r.label("Deep house (music)"), "deep house");
  assert.equal(r.qid("Q42"), "techno");
  assert.equal(r.resolve("whatever", "Q43"), "deep house");
});

test("the resolver gives null for an unknown label and for an ambiguous synonym", () => {
  const r = buildResolver(vocab, sources);
  assert.equal(r.label("Chicago"), null);
  assert.equal(r.label("shared"), null);
  assert.equal(r.qid("Q999"), null);
});

const tree = { "tech house": ["house"], house: ["electronic"], techno: ["electronic"], "minimal techno": ["techno"], electronic: [] };
const parentsOf = (k) => tree[k] || [];
const ref = (key, extra = {}) => ({ label: key, key, ...extra });

test("diffGenre grades additions by the sources that agree", () => {
  const ev = { subclass_of: [ref("house"), ref("techno")], instance_of: [], lead_parents: [ref("techno", { phrase_kind: "subgenre" })], origins: [ref("minimal techno")] };
  const d = diffGenre("tech house", ev, ["house"], parentsOf);
  assert.deepEqual(d.additions.map((a) => [a.key, a.strength]).sort(), [["minimal techno", "WEAK"], ["techno", "STRONG"]]);
  assert.deepEqual(d.removals, []);
  assert.equal(d.noEvidence, false);
});

test("diffGenre skips ancestors, flags descendants as contradictions and lists unsupported parents", () => {
  const ev = { subclass_of: [ref("electronic")], instance_of: [], lead_parents: [], origins: [] };
  assert.deepEqual(diffGenre("tech house", ev, ["house"], parentsOf).additions, []);
  assert.deepEqual(diffGenre("tech house", ev, ["house"], parentsOf).removals, [{ key: "house", strength: "MEDIUM" }]);
  const bad = { subclass_of: [ref("tech house")], instance_of: [], lead_parents: [], origins: [] };
  const d = diffGenre("house", bad, ["electronic"], parentsOf);
  assert.deepEqual(d.contradictions, [{ key: "tech house" }]);
  const off = { subclass_of: [ref("techno")], instance_of: [], lead_parents: [ref("techno")], origins: [] };
  assert.deepEqual(diffGenre("tech house", off, ["house"], parentsOf).removals, [{ key: "house", strength: "STRONG" }]);
});

test("diffGenre reports no evidence for an empty entry and ignores unmatched labels", () => {
  assert.equal(diffGenre("tech house", { subclass_of: [], instance_of: [], lead_parents: [], origins: [] }, ["house"], parentsOf).noEvidence, true);
  const ev = { subclass_of: [{ q: "Q1", label: "Chicago", key: null }], instance_of: [], lead_parents: [], origins: [] };
  const d = diffGenre("tech house", ev, ["house"], parentsOf);
  assert.deepEqual(d.additions, []);
  assert.deepEqual(d.removals, [{ key: "house", strength: "MEDIUM" }]);
});
