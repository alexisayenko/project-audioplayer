# Genre levels (draft data, served and drawn)

Terminology (ADR-0030): every node of the vocabulary is a **genre**; level 1 is a **family** (the 11 kept Discogs level-1 names, which Discogs calls genres); level 2 is a sub-genre and level 3 a sub-sub-genre. A Discogs genre (Discogs calls it a style) is a genre of ours at level 2 or 3; the word "style" is not used for our genres, and the Discogs API names (`styles`, `style=`) stay in code that talks to Discogs.

`server/data/genre_levels.json` places every vocabulary genre and extra (`genre_discogs.json`, `genre_extras.json`) in a three-level tree. The server serves it in `GET /genres/vocabulary` as `levels` and `family_synonyms` (GEN-051, GEN-052, API-119) and the rework map (`#/genres-rework`, WEB-085 to WEB-087, GEN-054) draws it. Tracked in [task-0037](../tasks/task-0037.md).

Only Electronic is drafted. Entry fields added later: `status`, `flavours`, `display` (sections below). The other 10 families are provisional placeholders (every genre level 2, `parents` just the family, `"provisional": true`) until Alex reviews them.

## Format

Level 1 is the 11 kept families (not listed as entries; four of the 15 Discogs level-1 names are removed, see Removed families). Each entry: `"<genre key>": {"parents", "family"?, "provisional"?, "discogs", ...}`.

- `parents`: a non-empty list of unique names, each a family (a level 1 name, capitalised as in the `families` block) or the key of another entry. `parents[0]` is the primary parent. Level rule: level = 2 if `parents[0]` is a family, else 1 + the level of `parents[0]`; hard cap three levels. The family of a genre is the family of `parents[0]` (for a family parent, itself). `parents[0]` also drives the main tree position, the counts per family and the default outline. The remaining entries are extra parents, drawn as cross-links: an extra parent that is a genre is the old `also_under` (the genre also shows under it as a link, its songs are not counted there); an extra parent that is a family is the old `also_in_genres` (the genre also appears as a node, with its children, in that family's tree).
- `family`: optional override, only for a level 3 genre whose primary parent sits in several families (the disco children): it names which of those families the genre belongs to, so it must be one of them. All other entries derive the family.
- `discogs`: true when the key is in `genre_discogs.json`, false when it exists only in `genre_extras.json`.
- `_meta`: rules and counts per family (`total`, `level2`, `level3`, counted by family and level as above). Test: `server/tests/test_genre_levels.py`.
- Validation (`genre_vocab.parse_levels`): every parent resolves, parents are unique and never the entry itself, no cycle through any parent edge (so an extra parent is never a descendant), `parents[0]` gives at most level 3, an explicit `family` is one of the primary parent's families.

## Genre names and synonyms

The top-level `families` block holds each of the 11 families as `{"name", "synonyms"}` (lowercase; typos such as "electrnic" are input normalisation, not stored). Genre entries may carry an optional `synonyms` list, filled only from `ALIASES` in `app/genre_filter.py` (copied read-only; 27 aliases whose target is a vocabulary genre). A synonym never equals a vocabulary key, a family name or another synonym (test). Agent judgement, awaiting Alex's review, except Electronic (Alex's list).

- Electronic: electronic dance music, edm, dance music, club music, electronic music. The ALIASES entries "electronic dance music" and "edm" currently map to the genre `electronic dance`; here they sit on the family instead, so they are not on that genre.
- Classical: classical music. Folk, World, & Country: folk world and country, folk, world and country, world music, folk and country, world and country
- Funk / Soul: funk and soul, soul/funk, funk soul, soul and funk, funk & soul, rnb, r and b
- Hip Hop: hip-hop, hiphop, hip hop music, rap, hip-hop & rap, hip hop and rap
- Jazz: jazz music. Latin: latin music, latino. Pop: pop music, popular music. Reggae: reggae music. Rock: rock music. Blues: none.

Dropped candidates because they equal a vocabulary key or a family name: r&b (a genre). The ALIASES entry "pop and chart" is not carried (target is a family, not a genre). "rap" is not a vocabulary key here (only cloud rap, pop rap, thug rap and similar), so it is kept as a Hip Hop synonym.

Decided: "dance music" and "club music" fold into Electronic (see Decisions).

## Counts (Electronic drafted; others provisional)

Electronic 145 (50 level 2, 95 level 3, 22 not in Discogs; after the 2026-10-16 removals, the psytrance branch below and the two edits of 2026-10-19; before them 141, 55 and 86). Others, all level 2 and provisional: Rock 102, Folk, World, & Country 66, Latin 57, Pop 32, Jazz 26, Classical 25 (includes `epic`), Hip Hop 24, Funk / Soul 23, Blues 16, Reggae 13. Total 529 (476 Discogs genres and 53 extras; the family counts in `_meta` are the reference). Non-Discogs elsewhere: Rock 14, Pop 7, Funk / Soul 6, Folk, World, & Country 3, Classical 1 (`epic`).

## Electronic umbrellas (16, level-3 children)

All placements below are agent judgement, awaiting Alex's review.

- house (22): acid house, afro house, ambient house, big room house, deep house, electro house, euro house, french house, future house, garage house, ghetto house, hard house, hip house, italo house, melodic house, microhouse, progressive house, sunshine house, tech house, tribal house, tropical house
- trance (11): acid, deep, dream, euro, hard, neo, nu-nrg, progressive, tech, uplifting, vocal
- psytrance (6): dark psytrance, forest psytrance, progressive psytrance, full-on psytrance, goa trance, psybient
- techno (6): deep, dub, hard, melodic, minimal, schranz
- drum and bass (4): jungle, liquid funk, neurofunk, techstep
- breakbeat (7): big beat, breaks, progressive breaks, baltimore club, jersey club, breakbeat hardcore, breakcore
- hardcore (8): doomcore, donk, gabber, happy hardcore, makina, speedcore, hardstyle, jumpstyle (rave, raggacore and breakbeat hardcore no longer fold here, BA2)
- ambient (6): dark ambient, drone, illbient, berlin-school, lowercase, dungeon synth
- downtempo (2): chillout, trip hop
- synthwave (6): darksynth, dreamsynth, dreamwave, chillwave, vaporwave, soviet wave
- synthpop (3): electroclash, electropop, techno pop
- industrial (5): ebm, dark electro, rhythmic noise, power electronics, harsh noise wall
- eurodance (3): bubblegum dance, hands up, italodance
- uk garage (2): speed garage, bassline
- bass music (4): dubstep, future bass, glitch hop, moombahton
- experimental (5): musique concrete, plunderphonics, sound collage, sound art, glitch

Rule applied: an umbrella with fewer than 2 children is a standalone level 2 genre (italo disco and electronica; indietronica became level 2 with an extra parent; spacesynth was level 2 with an extra parent until Alex moved it under synthwave on 2026-10-19, see Parents and the two edits of 2026-10-19).

## Extras placement

nu-nrg under trance (Discogs-less; extras parent hard trance would be level 4); darksynth, dreamsynth, dreamwave under synthwave (synthwave itself is a Discogs genre); neurofunk, liquid funk, techstep under drum and bass; melodic techno under techno, melodic house under house; chillout under downtempo; electronica, dance, electronic dance, alternative dance are level 2 (indietronica under electronica).

## Electronic entries not in Discogs (14 now; the list below is from before the 2026-10-16 removals, see Decisions)

acid trance, afro house, alternative dance, big room house, breakbeat hardcore, bubblegum dance, chillout, dance, darksynth, deep trance, dreamsynth, dreamwave, electronic dance, electronica, electropop, french house, french touch, indietronica, jersey club, liquid funk, melodic house, melodic techno, neurofunk, nu-nrg, psybient, raggacore, rave, spacesynth, sunshine house, techno pop, techstep, uplifting trance, vocal trance.

## Judgement calls (agent judgement, awaiting Alex's review)

- jungle: parents drum and bass (primary), breakbeat.
- jersey club, baltimore club: both under breakbeat, also under house.
- psybient: under psytrance (Alex, 2026-10-16), also under ambient. nu-nrg: under trance (not hard trance).
- spacesynth: parents synthwave (primary), italo disco (Alex, 2026-10-19; level 3, it was standalone level 2 with italo disco as the only extra parent). indietronica: standalone level 2, extra parent electronica.
- hands up: under eurodance, also trance. hardstyle: under hardcore, also trance. donk: under hardcore, also house. jumpstyle: under hardcore.
- chillwave, vaporwave: under synthwave, also downtempo. dungeon synth: under ambient, also synthwave.
- ebm: under industrial, also synthpop. dark electro: under industrial, also electro. rhythmic noise: under industrial, also noise.
- hard trance: also hardcore. melodic techno: also trance. tech trance: also techno. tech house: also techno. hard house: also hardcore. microhouse: also techno. minimal techno: also house. speed garage: also house. glitch hop: also breakbeat. future bass: also house. neurofunk: also industrial. darksynth: also industrial.
- Standalone level 2, no umbrella clearly fits: darkwave, tribal (also house), acid (also techno, house), minimal (also techno, house), witch house (also industrial).

## Decisions of 2026-10-16 (Alex)

Data change, built, tested and deployed: the startup migration rewrites the owner's tags on deploy (backup first, `backups-genre-merge/<uid>/library.json`).

Removed genres (gone from `genre_extras.json` and `genre_levels.json`; the old name stays an input alias in `ALIASES` and a synonym of the target, so old tags, picker input and share links still resolve):

| removed | folds to | songs |
|---|---|---|
| electronic dance, dance, electronica, indietronica, alternative dance (also "dance music", "edm", "dance & edm") | electronic (family) | 21, 15, 9, 2, 2 |
| chillout | downtempo | 4 |
| afro house, big room house, melodic house | house | 2, 1, 2 |
| bubblegum dance | eurodance | 2 |
| techstep | drum and bass | 2 |
| liquid funk | liquid drum and bass (new) | 1 |
| rave | electronic (family; corrected 2026-10-16, BA2) | 1 |
| breakbeat hardcore | breakbeat (its earlier reviewed parent; corrected BA2) | 1 |
| raggacore | dropped, not folded (the Russian "raggakor" means ragga-pop, not hardcore; BA2, the tag is in `DROP`) | 1 |
| jersey club | breakbeat | 1 |
| techno pop, electropop (incl. "russian electro pop", "electronic pop") | synthpop | 1, 9 |

Songs counted are distinct songs of the owner's live library (199 songs, guest `GET /library`, 2026-10-16); 65 songs change in all. 39 of them end up with fewer genre tags because the target tag was already there (a merge, not a loss); 3 of those merge into an existing synthpop tag. No song is left without a `genre:` tag. `club` and `club music` fold into `electronic` (decision AP1): `club` left `DROP` (TAG-073) and both are `ALIASES` to `electronic` and Electronic search synonyms; songs that lost `genre:club` in the earlier deployed clean-up are not restored. No song of the live library carries a club tag now (only `jersey club`, folded to breakbeat). The ONE_OFF fix for `soundcloud-122880128` now adds `genre:house` (french house is gone). `downtempo` keeps `trip hop` as its only level-3 child (the two-child rule is not applied to Discogs umbrellas).

Statuses (`status` on an entry; absent means unreviewed; the web shows a badge):

| status | genres |
|---|---|
| approved (badge "Alex approved") | vocal trance, melodic techno, psybient, darksynth, uplifting trance, dreamsynth, dreamwave, neurofunk, spacesynth, nu-nrg, sunshine house, liquid drum and bass, soviet wave, dream trance |
| question (badge "under question") | deep trance, acid trance |

Precedence rule: Discogs outranks Alex's approval. `approved` is only stored on entries with `discogs: false`; for a Discogs genre it is ignored and not stored (tropical house and chillwave are Discogs genres: approval ignored). `question` is allowed on any entry. Tests: `server/tests/test_genre_levels.py`.

Added 2026-10-18: `dream trance` (extras, level 3 under trance, approved, not Discogs; synonyms dream house, dream dance, both also `ALIASES`; source https://en.wikipedia.org/wiki/Dream_trance).

Added 2026-10-18: `anthem trance`, `epic trance` and `euphoric trance` are synonyms of `uplifting trance` (also `ALIASES`); `commercial trance` and `stadium trance` stay out as too broad; the separate `epic` (Classical since 2026-10-18, see Removed families) is unaffected.

Added: `liquid drum and bass` (extras, level 3 under drum and bass, approved, display "Liquid Drum & Bass"; synonyms liquid dnb, liquid d&b, liquid drum & bass, liquid drum n bass, liquid drum'n'bass, liquid drum and bass music, liquid drum & bass music, liquid funk).

`french house` came back on 2026-10-17 (DQ1): an extra (level 3 under house, `discogs: false`, not Discogs), and `french touch` is an `ALIASES` entry and a synonym of it, no longer a house fold. Stored `french touch` is rewritten to `french house` by the startup migration; stored `french house` stays (songs folded to house earlier stay house).

`melodic house` is intentionally not a genre any more; the `melodic` flavour stays (used by melodic techno). `french` is not a flavour for now.

## Flavours

Status: defined, not attached (decision of 2026-10-16). The top-level `flavours` block exists and is served, but no genre entry carries a `flavours` list yet; every `levels[<genre>].flavours` is `[]`, and the map hides the Flavour selector and chips while no genre carries one. The earlier assignment (genres per flavour, kept so nothing is lost) is in [genre-flavours-proposal.md](genre-flavours-proposal.md), not loaded by any code, awaiting Alex. The per-genre lists described below and the counts listed under them are therefore the proposal, not the data.

A flavour is a modifier that runs alongside the tree, not a level. Top-level `flavours` block in `genre_levels.json`: `{"<key>": {"name", "kind": "sound" | "scene", "description"}}` (lowercase unique keys; a flavour key may equal a genre key, e.g. `acid`, they are separate namespaces). A genre entry may carry `"flavours": ["<key>", ...]` (no repeats, every key in the block). Only Electronic entries carry them so far; stored tags do not change.

Served by `GET /genres/vocabulary`: top-level `flavours` (the block as is) and per genre `levels[<genre>].flavours` (always a list, `[]` when none).

Flavours and the genres that carry them:

- acid (sound, 2): acid house, acid trance
- progressive (sound, 3): progressive breaks, progressive house, progressive trance
- melodic (sound, 1): melodic techno
- vocal (sound, 1): vocal trance
- deep (sound, 3): deep house, deep techno, deep trance
- hard (sound, 3): hard house, hard techno, hard trance
- dark (sound, 3): dark ambient, dark electro, darksynth
- uplifting (sound, 1): uplifting trance
- minimal (sound, 1): minimal techno
- tech (sound, 2): tech house, tech trance
- baltimore (scene, 1): baltimore club
- berlin (scene, 1): berlin-school

Uncertain assignments (agent judgement): darksynth (dark: the dark side of synthwave, could be none); dark electro (dark: also a genre of its own under industrial); minimal techno (minimal, one use only); uplifting trance and vocal trance (one use each, kept because they are the clearest sound words); baltimore club and berlin-school (scene: the name already is the place; kept so the map can group scenes); progressive breaks (progressive). Left out on purpose: darkwave, tech inside techno, hard inside hardcore and hardstyle, dub techno, microhouse (minimal?), italo disco and euro disco (genres, not scenes), tropical house.

## Display names

An entry may carry `"display": "<string>"`: the name to show in the UI instead of the key (default: the key). The stored tag stays the key. Served as `levels[<genre>].display` (`null` when absent). A display lowercased may not equal another vocabulary key. Set so far: `drum and bass` shows as "Drum & Bass", `liquid drum and bass` as "Liquid Drum & Bass". Every other spelling of drum and bass is a synonym of the key (dnb, d&b, drum n bass, drum'n'bass, drum & bass, drum and bass music, drum & bass music), and `ALIASES` maps them to the key.

## Disco umbrella across two families (AO1)

`disco` is a Discogs genre under two families. Its primary family stays `Funk / Soul` (per `genre_discogs.json`) and it is a level 2 entry there, still provisional: `parents: ["Funk / Soul", "Electronic"]`. The extra parent `Electronic` (a family) means: show this entry as a level 2 node in that family's tree too, because children of it hang under it. Its children keep `Electronic` as their own family through the `family` override and name the umbrella as their primary parent: `parents: ["disco"]`, `family: "Electronic"` (without the override the family would be derived from `disco` as Funk / Soul, and the Electronic map would lose them). Depth stays at most three. For the Electronic map: root Electronic, then `disco` (the entry that lists Electronic among its parents), then its children `euro disco`, `italo disco`, `hi-nrg`, `nu-disco` and, since 2026-10-19, `space disco` (level 3). `disco polo` stays a standalone level 2 genre (a Polish dance-pop genre, not a disco descendant). `post-disco` (Funk / Soul, not in Discogs) belongs under disco by meaning, but Funk / Soul is undrafted, so it stays a provisional level 2 until that family is drafted.

An extra parent may be any other entry, not only a level 2 one: `italo disco` is level 3 and the extra parent of `spacesynth`. The radial map draws a cross-link only between level 2 nodes, so that one is not drawn.

## Parents (ADR-0030, 2026-10-19)

The three relations of the old format became one list, `parents`, with no change in behaviour. Mapping of the old data: `parent: null` (family F) became `[F]`; `parent: P` became `[P]`; `parent: P` with `also_under: [A, B]` became `[P, A, B]`; `parent: null` with `also_under: [A, B]` (acid, minimal, spacesynth, tribal, witch house) became `[F, A, B]`; disco (`also_in_genres: ["Electronic"]`) became `["Funk / Soul", "Electronic"]`. The old `genre` key became the derived `family`, kept only as the override of the four disco children (euro disco, hi-nrg, italo disco, nu-disco); `space disco` of 2026-10-19 carries it too. Proof: a snapshot of the tree, family counts, cross-links, outline rows and radial layouts taken from HEAD before the change equals the tree built from the new data (`web/js/genre-parents.test.mjs`, `server/tests/test_genre_parents_snapshot.py`). Ambiguities of the mapping: for extras the old `parent` was either null or the lowercase family entry (`pop`: alternative pop, art pop, estrada, middle of the road, new romantic, orchestral pop, progressive pop; null: epic, r&b), both now `[<Family>]`, and nothing read the difference.

## Two owner edits (Alex, 2026-10-19)

- `spacesynth`: `parents: ["synthwave", "italo disco"]`; it is level 3 under synthwave (family Electronic) with italo disco as a cross-link; status approved stays.
- `space disco` (new extra, display "Space Disco", synonym `space-disco`, `discogs` false, status approved): `parents: ["disco"]`, `family: "Electronic"`, level 3 under disco. Wikipedia: a subgenre of disco from the mid-1970s in Europe, France and Canada, with synthesizer and space themes (https://en.wikipedia.org/wiki/Space_disco). No other parents.

## Psytrance branch (Alex, 2026-10-16)

Alex: "trance and psy-trance are way too different". `psytrance` (display "Psy-Trance", a Discogs genre) is a plain level 2 umbrella, a sibling of `trance`: `parents: ["Electronic"]`, no extra parent, no link of any kind to trance. The three-level cap is unchanged (a fourth level was considered and rejected). Children (level 3, `parents` start with `"psytrance"`): `dark psytrance`, `forest psytrance`, `progressive psytrance`, `full-on psytrance` (new extras, `discogs` false, status approved, displays "Dark Psy-Trance" and so on; the Discogs search `style=<name>` (the Discogs API parameter) returned no results for any of them on 2026-10-16), `goa trance` (Discogs; moved from trance) and `psybient` (approved; also under ambient; moved from trance). Flavours: dark psytrance `dark`, progressive psytrance `progressive`. Synonyms: darkpsy, dark psy, dark psy-trance; forest psy, forest psy-trance; prog psy, progressive psy, progressive psy-trance; full on, fullon, full-on psy, full on psytrance, full-on psy-trance.

Judgement call: `goa trance` sits under psytrance only (no extra parent trance), so trance's children and counts no longer include goa trance or psytrance songs. `progressive trance` stays under trance and is not merged with `progressive psytrance`. Known psy genres not added: hi-tech psytrance, suomisaundi, psychill.

## Removed families (Alex, 2026-10-18)

Alex decided that the genre list describes how music sounds, not where or how it is used or what format it is. Four of the 15 Discogs families are removed from the vocabulary, the graph, the web and macOS copies and the tests, with every genre, synonym and extra under them, and nothing is re-parented:

- Stage & Screen: score (synonym film score), musical, theme, incidental music, vaudeville, video game music, soundtrack, trailer; synonyms stage and screen, soundtracks, film and tv, stage, screen.
- Children's: educational, lullaby, nursery rhymes, story; synonyms childrens, children, kids, kids music, children music.
- Brass & Military: brass band, concert band, marches, military, pipe & drum; synonyms brass and military, military and brass, military & brass.
- Non-Music: audiobook, dialogue, education, field recording, interview, karaoke, medical, monolog, poetry, political, promotional, public service announcement, radioplay, religious, sermon, sound poetry, speech, spoken word, technical, therapy; synonyms non music, nonmusic, spoken.

One exception: `epic` stays, as a level 2 genre of Classical next to `modern classical` (extras entry: parents `["Classical"]`; the `epic trance` synonym of `uplifting trance` is unchanged).

Songs: every removed name, the family names and their synonyms are in `genre_filter.REMOVED_GENRES`, which joins `DROP` (TAG-073). The existing genre-tag migration (`migrate_tags`, run at startup) sees the stored tag change under `clean_tags`, backs the file up once (`backups-genre-merge/<uid>/library.json`) and rewrites it, so each song loses these genres on the next start; a song left without a genre stays valid. No new migration step and no `credits_schema` change. The ALIASES entry "film score" to "score" is gone.


## Soviet Wave (Alex, 2026-10-17)

`soviet wave` (display "Soviet Wave"): extra, `discogs` false, status approved, level 3 under `synthwave` (Wikipedia, https://en.wikipedia.org/wiki/Sovietwave, calls Sovietwave a synthwave subgenre from the post-Soviet region, early 2010s). Synonyms: sovietwave, soviet-wave, советская волна, советская-волна (the Cyrillic forms are also in `ALIASES`, since lookups only fold case, spaces and hyphens).
