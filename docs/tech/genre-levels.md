# Genre levels (draft data, served and drawn)

See [genre-terminology.md](genre-terminology.md) for the glossary and the classification aspects.

Terminology (ADR-0030): every node of the vocabulary is a **genre**; level 1 is a **family** (the 11 kept Discogs level-1 names, which Discogs calls genres); level 2 is a sub-genre, level 3 a sub-sub-genre and so on (no depth cap since 2026-10-19; the interface says "genre" for every level). A Discogs genre (Discogs calls it a style) is a genre of ours at level 2 or 3; the word "style" is not used for our genres, and the Discogs API names (`styles`, `style=`) stay in code that talks to Discogs.

`server/data/genre_levels.json` places every vocabulary genre and extra (`genre_discogs.json`, `genre_extras.json`) in a three-level tree. The server serves it in `GET /genres/vocabulary` as `levels` and `family_synonyms` (GEN-051, GEN-052, API-119) and the rework map (`#/genres-rework`, WEB-085 to WEB-087, GEN-054) draws it. Tracked in [task-0037](../tasks/task-0037.md).

Electronic and Rock are drafted. Entry fields added later: `status`, `flavours`, `display` (sections below). The other 10 families are provisional placeholders (every genre level 2, `parents` just the family, `"provisional": true`) until Alex reviews them.

## Format

Level 1 is the 11 kept families (not listed as entries; four of the 15 Discogs level-1 names are removed, see Removed families). Each entry: `"<genre key>": {"parents", "family"?, "provisional"?, "discogs", ...}`.

- `parents`: a non-empty unordered set (stored as a list) of unique names, each a family (a level 1 name, capitalised as in the `families` block) or the key of another entry. All parents are equal: there is no primary parent and the order means nothing (ADR-0037, GEN-070). The families of a genre are every family it descends from through any parent (served in the fixed family order as `families`; `family` is the first of them, kept for old clients). The level is the shortest path depth to a family (2 when a parent is a family, else 1 + the smallest level among the parents); there is no depth cap (the cap of three levels was lifted on 2026-10-19), only a sanity bound of 12 levels. A genre appears under each of its parents in the Outline and the radial rings; the canvas draws it once with a line to each parent.
- `fusion`: optional boolean (GEN-061). Marks a blend of families (blues rock, trip hop, eurodance and 11 more, 14 in all after the edits of 2026-10-19): with the map's "Fusion genres" toggle off the genre keeps its genre parents (else the first family parent listed) and its other family parents are hidden; with it on all parents show. Allowed only when the genre belongs to at least two families. Served as `fusion: true` in `levels`, absent otherwise. Multi-family genres without the flag (disco, dub, experimental, electro, bossa nova, rhythm and blues, synthpop, darkwave and every genre that descends from a multi-family genre) always show all families.
- `related`: optional list of unique names (a family or the key of another entry; never the entry itself, one of its parents or one of its descendants), absent when empty (GEN-064). Associations and influences, not subgenre-of: no effect on the tree, counts or colours, levels, families or the outline; shown as information and a faint link in the map. Served as `levels[genre].related` when non-empty.
- `family`: not allowed any more (ADR-0037); the families are derived from all parents. The former override of the disco children is gone: they descend from disco, which is in Funk / Soul and Electronic.
- `discogs`: true when the key is in `genre_discogs.json`, false when it exists only in `genre_extras.json`.
- `_meta`: rules and counts per family (`total`, `level2`, `level3`, `level4`, counted by family membership and by shortest-path level, so a genre of two families counts in both; the top-level `total` is the number of genres). Test: `server/tests/test_genre_levels.py`.
- Validation (`genre_vocab.parse_levels`): every parent resolves, parents are unique and never the entry itself, no cycle through any parent edge, a `family` key is refused, the level stays within the sanity bound, `fusion` is a boolean on an entry that belongs to at least two families, `related` is a list of unique names (family or entry), not the entry, a parent or a descendant.

Decision DH2 (owner, 2026-10-19): 22 reviewed parent links that were only associations (influence, related scene; evidence in the electronic and cross-family parent reviews) left `parents` and went into `related`: minimal (house), witch house (industrial), breakcore (breakbeat), chillwave and vaporwave (downtempo; synthwave stays their only parent, because moving both would leave them parentless), dark electro (electro), dungeon synth (synthwave), future bass (house), jungle (drum and bass; backwards relation), melodic techno (trance), microhouse (techno), minimal techno (house), neurofunk and darksynth (industrial), hardcore and noise (Rock), grime (Hip Hop), trap, acid jazz, new wave and modern classical (Electronic), gospel (Funk / Soul). The `fusion` flag of trap and acid jazz is dropped (no extra family parent is left). Level or family changes: breakcore and jungle change only their primary parent (still level 3, Electronic); gospel's primary parent is now Folk, World, & Country, so its family changes from Funk / Soul to Folk, World, & Country (`_meta` counts: Funk / Soul 22, Folk, World, & Country 67; `genre_discogs.json` lists gospel under Folk, World, & Country first to match). Tree membership including cross-links: Electronic 151 to 147, Funk / Soul 26 to 25, Hip Hop 28 to 27, Rock 108 to 106. Held for the owner, not applied: disco -> Electronic (hosts space disco), speed garage -> house, glitch hop parents, spacesynth, every unsure verdict, all proposed additions.

Decision DI1 (owner, 2026-10-19): genres are displayed in lowercase everywhere, only families keep capitals: the nine `display` values are lowercase (dark psy-trance, drum & bass, forest psy-trance, full-on psy-trance, liquid drum & bass, progressive psy-trance, psy-trance), and the two that then equal the key (soviet wave, space disco) have no `display`. Decision DJ1: the key `soviet wave` is now `sovietwave` (like synthwave); `soviet wave`, `soviet-wave` and the Russian forms are synonyms, and stored tags are rewritten at the next startup by the genre-tag migration (backup in `backups-genre-merge/`).

Decision DY1 + EDM (owner, 2026-10-19): the Electronic family is grouped into eight subfamilies (our own grouping, merged from the sections of Wikipedia's list of electronic music genres; names live only in the top-level `subfamilies` block, `name -> {family, order}`, so renaming is a one-line data edit; the owner kept house, techno and trance separate): House (house with its children, acid, balearic, electro swing, ghetto, ghettotech, tribal, edm), Techno (techno, hardcore with its nine children, bleep, minimal, lento violento), Trance (trance, psytrance with its children), Breaks & bass (incl. kuduro), Synth & wave, Experimental, industrial & noise, Ambient & downtempo, Eurodance & disco (eurodance, freestyle, disco polo, disco and the children of those). Provisional placements by judgement: hardcore and its children in Techno (rave and hard side of techno; Wikipedia files them under Hardcore), edm in House (it spans several groups; the marker question DX is open), kuduro in Breaks & bass (Angolan dance music on breakbeat rhythms), disco polo in Eurodance & disco (Polish dance-pop), acid in House (acid house/techno ambiguous), ghettotech in House (Wikipedia lists it under Ghetto house), minimal and lento violento in Techno. Field `subfamily` (optional string): set on every Electronic level 2 genre and on `disco`; a genre without it inherits the one of its `parents[0]` chain (computed in the payload, not stored) when the declared family of that subfamily is one of the genre's families (its family or a family among its parents); a genre with no Electronic family gets none. Validation: the name is declared and its family is one of the genre's families. Served as `levels[genre].subfamily` (absent when none) and a top-level `subfamilies` list (`name`, `family`, `order`). Counts (genres per subfamily, own plus inherited): House 26, Techno 20, Trance 19, Breaks & bass 24, Synth & wave 14, Experimental, industrial & noise 22, Ambient & downtempo 10, Eurodance & disco 11 (146 in all: the 145 Electronic genres plus disco; later edits changed these counts, see the equal-parents section). `edm` is a new approved extra (level 2, subfamily House, not in Discogs, display equals the key) with the synonyms electronic dance music, dance music, club music, electronic dance and dance, which left the Electronic family synonyms (`ALIASES` now maps them to `edm`; stored `genre:electronic` tags are untouched, no migration is needed); house, techno and trance stay at level 2 under Electronic, not under edm. Decision ED1: `eurobeat` is no longer a genre but a synonym of `eurodance` (removed from `genre_discogs.json` and `genre_levels.json`; `ALIASES` maps it and the startup genre-tag migration rewrites stored tags with the usual backup); `freestyle` stays its own genre. The open question of marking edm across several subfamilies (DX) is not decided.

Decision DN3 (owner, 2026-10-19): nine missing parent genres were added as approved extras (not in Discogs, display equals the key, Wikipedia-reviewed, all family Rock; nothing was moved under them yet): hardcore punk [punk] (level 3; the key `hardcore` stays the Electronic genre, no synonym `hardcore`), experimental rock [Rock] (level 2), extreme metal [heavy metal] (3), noise rock [Rock] (2), roots rock [Rock] (2), neo-psychedelia [psychedelic rock] (3), glam metal [heavy metal] (3; synonyms hair metal, pop metal), college rock [alternative rock] (3), death-doom [death metal, doom metal] (3; synonyms death/doom, death doom). No level 4 arises. Rock now counts 111 genres (105 level 2, 6 level 3), total 530, 62 extras. Decision DO1: `electro` has synonyms electro-funk and electrofunk (`ALIASES` maps them; electropop, electro-pop and electronic pop stay on synthpop).

Decision DR1 (owner, 2026-10-19: "regarding rock genres do as you decide"): the Rock tree is drafted from a Wikipedia review of the 102 Rock genres plus the nine new parents of DN3 (evidence per genre: the lead sentence and infobox of the English Wikipedia article; a parent only where the lead says subgenre, offshoot, branch or fusion, origins alone go to `related`). Rock now has 41 level 2 and 69 level 3 genres (before: 105 and 6; `lo-fi` was removed on 2026-10-20, see below); 68 genres changed `parents`, 91 of the 110 are reviewed (`provisional` removed) and 19 are HELD at `[Rock]`, still `provisional: true`, because the review was unsure: acoustic, aor, arena rock, beat, british invasion, dance-rock, dark metal, jangle pop, mod, paisley underground, psychobilly, pub rock, rock opera, sadcore, shock rock, soft rock, southern rock, stoner rock and synth-rock. `_meta.drafted` lists Electronic and Rock. Rules used: the first parent is the closest level 2 genre (a level 3 parent such as hardcore punk, extreme metal, death-doom, neo-psychedelia, glam metal or college rock is never `parents[0]`, it goes in as an extra parent so no level 4 arises); exceptions that keep umbrella genres at level 2 with a cross-link: death metal and black metal `[Rock, heavy metal, extreme metal]`, post-punk `[Rock, punk]`, industrial rock `[Rock, industrial]`. New parents applied where Wikipedia says so: experimental rock holds krautrock and post-rock ("subgenre of experimental rock") and is an extra parent of math rock; hardcore punk is an extra parent of melodic hardcore, emo, metalcore, grindcore, sludge metal, mathcore and noisecore (it replaces `punk` where the article names hardcore punk); extreme metal is an extra parent of thrash, doom metal, death metal, black metal and crust (the article lists thrash, death, black and doom as extreme metal); funeral doom metal is `[death metal, death-doom, doom metal]` (a subgenre of death-doom, which is level 3, so the grandparent death metal is the placement); dream pop is `[alternative rock, neo-psychedelia]`; mathcore becomes `[heavy metal, metalcore, hardcore punk]`. Not moved although a new parent exists, because the lead does not say it: pub rock and southern rock (roots rock), paisley underground (neo-psychedelia), arena rock (glam metal), jangle pop (college rock), post-hardcore and screamo (hardcore punk), no wave (experimental rock, only `related`), the noise rock candidates (industrial rock, post-hardcore: `related` only). Blends of rock with another family carry that family as an extra parent and `fusion: true`: folk metal and folk punk (Folk, World, & Country), rap metal (Hip Hop), funk metal (Funk / Soul, already), electronic rock (Electronic); extra GENRE parents in other families (coldwave: darkwave; industrial metal and industrial rock: industrial) carry no flag. 11 genres gained `related` (krautrock, no wave, post-hardcore, mathcore, crust, melodic hardcore, groove metal, viking metal, dance-punk, industrial rock, nu metal), 33 in all. Multi-family genres: 20 (14 fusion). The family of every Rock genre is still Rock (from `parents[0]`; the cross-family parents add tree membership only). `genre_extras.json`: post-britpop and post-punk revival list their new placement parent first (the flat `genres` row must agree with the tree).

Decision DB1 (2026-10-19): the 23 Discogs genres that sit in two families but were filed in one (all except disco) got the second family appended to `parents` (hip house: `[house, Hip Hop]`, trip hop: `[downtempo, Hip Hop]`; the primary parent, level, family and `_meta` counts are unchanged). Tree membership (primary family level 2 / level 3, then the genres that also appear there through an extra family; fusion ones hidden until the toggle): Blues 16/0 + 1; Classical 25/0 + 0; Electronic 50/95 + 6 (2 fusion); Folk, World, & Country 66/0 + 1; Funk / Soul 23/0 + 3 (3 fusion); Hip Hop 24/0 + 4 (2 fusion); Jazz 26/0 + 1; Latin 57/0 + 1 (1 fusion); Pop 32/0 + 1 (1 fusion); Reggae 13/0 + 0; Rock 102/0 + 6 (3 fusion). Before this change only disco (in Electronic) was an extra-family member.

## Genre names and synonyms

The top-level `families` block holds each of the 11 families as `{"name", "synonyms"}` (lowercase; typos such as "electrnic" are input normalisation, not stored). Genre entries may carry an optional `synonyms` list, filled only from `ALIASES` in `app/genre_filter.py` (copied read-only; 27 aliases whose target is a vocabulary genre). A synonym never equals a vocabulary key, a family name or another synonym (test). Agent judgement, awaiting Alex's review, except Electronic (Alex's list).

- Electronic: electronic dance music, edm, dance music, club music, electronic music. The ALIASES entries "electronic dance music" and "edm" currently map to the genre `electronic dance`; here they sit on the family instead, so they are not on that genre.
- Classical: classical music. Folk, World, & Country: folk world and country, folk, world and country, world music, folk and country, world and country
- Funk / Soul: funk and soul, soul/funk, funk soul, soul and funk, funk & soul, rnb, r and b
- Hip Hop: hip-hop, hiphop, hip hop music, rap, hip-hop & rap, hip hop and rap
- Jazz: jazz music. Latin: latin music, latino. Pop: pop music, popular music. Reggae: reggae music. Rock: rock music. Blues: none.

Dropped candidates because they equal a vocabulary key or a family name: r&b (a genre). The ALIASES entry "pop and chart" is not carried (target is a family, not a genre). "rap" is not a vocabulary key here (only cloud rap, pop rap, thug rap and similar), so it is kept as a Hip Hop synonym.

Decided: "dance music" and "club music" fold into Electronic (see Decisions).

## Counts (Electronic and Rock drafted; others provisional)

Electronic 145 (50 level 2, 95 level 3, 22 not in Discogs; after the 2026-10-16 removals, the psytrance branch below and the two edits of 2026-10-19; before them 141, 55 and 86). Rock 110 (41 level 2, 69 level 3, drafted by DR1; 19 of them held and provisional; 14 not in Discogs plus the nine of DN3). Others, all level 2 and provisional: Folk, World, & Country 66, Latin 57, Pop 32, Jazz 26, Classical 25 (includes `epic`), Hip Hop 24, Funk / Soul 23, Blues 16, Reggae 13. Total 529 (476 Discogs genres and 53 extras; the family counts in `_meta` are the reference). Non-Discogs elsewhere: Rock 14, Pop 7, Funk / Soul 6, Folk, World, & Country 3, Classical 1 (`epic`).

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
- synthwave (6): darksynth, dreamsynth, dreamwave, chillwave, vaporwave, sovietwave
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

- jungle: parents breakbeat (drum and bass moved to `related`, DH2).
- jersey club, baltimore club: both under breakbeat, also under house.
- psybient: under psytrance (Alex, 2026-10-16), also under ambient. nu-nrg: under trance (not hard trance).
- spacesynth: parents synthwave (primary), italo disco (Alex, 2026-10-19; level 3, it was standalone level 2 with italo disco as the only extra parent). indietronica: standalone level 2, extra parent electronica.
- hands up: under eurodance, also trance. hardstyle: under hardcore, also trance. donk: under hardcore, also house. jumpstyle: under hardcore.
- chillwave, vaporwave: under synthwave, also downtempo. dungeon synth: under ambient, also synthwave.
- ebm: under industrial, also synthpop. dark electro: under industrial, also electro. rhythmic noise: under industrial, also noise.
- hard trance: also hardcore. melodic techno: also trance. tech trance: also techno. tech house: also techno. hard house: also hardcore. microhouse: also techno. minimal techno: also house. speed garage: also house. glitch hop: also breakbeat. future bass: also house. neurofunk: also industrial. darksynth: also industrial.
- Standalone level 2, no umbrella clearly fits: tribal (also house), acid (also techno, house), minimal (also techno, house), witch house (also industrial).

## Decisions of 2026-10-16 (Alex)

Data change, built, tested and deployed: the startup migration rewrites the owner's tags on deploy (backup first, `backups-genre-merge/<uid>/library.json`).

Removed genres (gone from `genre_extras.json` and `genre_levels.json`; the old name stays an input alias in `ALIASES` and a synonym of the target, so old tags, picker input and share links still resolve):

| removed | folds to | songs |
|---|---|---|
| electronica, indietronica, alternative dance, dance & edm | electronic (family) | 9, 2, 2 |
| electronic dance, dance, dance music, club music, electronic dance music (2026-10-19, DY1) | edm | 21, 15 |
| eurobeat (2026-10-19, ED1) | eurodance | |
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
| approved (badge "Alex approved") | vocal trance, melodic techno, psybient, darksynth, uplifting trance, dreamsynth, dreamwave, neurofunk, spacesynth, nu-nrg, sunshine house, liquid drum and bass, sovietwave, dream trance |
| question (badge "under question") | deep trance, acid trance |

Precedence rule: Discogs outranks Alex's approval. `approved` is only stored on entries with `discogs: false`; for a Discogs genre it is ignored and not stored (tropical house and chillwave are Discogs genres: approval ignored). `question` is allowed on any entry. Tests: `server/tests/test_genre_levels.py`.

Added 2026-10-18: `dream trance` (extras, level 3 under trance, approved, not Discogs; synonyms dream house, dream dance, both also `ALIASES`; source https://en.wikipedia.org/wiki/Dream_trance).

Added 2026-10-18: `anthem trance`, `epic trance` and `euphoric trance` are synonyms of `uplifting trance` (also `ALIASES`); `commercial trance` and `stadium trance` stay out as too broad; the separate `epic` (Classical since 2026-10-18, see Removed families) is unaffected.

Added: `liquid drum and bass` (extras, level 3 under drum and bass, approved, display "liquid drum & bass"; synonyms liquid dnb, liquid d&b, liquid drum & bass, liquid drum n bass, liquid drum'n'bass, liquid drum and bass music, liquid drum & bass music, liquid funk).

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

An entry may carry `"display": "<string>"`: the name to show in the UI instead of the key (default: the key). The stored tag stays the key. Served as `levels[<genre>].display` (`null` when absent). A display lowercased may not equal another vocabulary key. Set so far: `drum and bass` shows as "drum & bass", `liquid drum and bass` as "liquid drum & bass" (genres are lowercase, DI1). Every other spelling of drum and bass is a synonym of the key (dnb, d&b, drum n bass, drum'n'bass, drum & bass, drum and bass music, drum & bass music), and `ALIASES` maps them to the key.

## Disco umbrella across two families (AO1)

Since ADR-0037 the umbrella is plain data: `disco` has `parents: ["Funk / Soul", "Electronic"]`, both equal, so it is a level 2 entry in both families. Its children `euro disco`, `italo disco`, `hi-nrg`, `nu-disco` and `space disco` (level 3) have `parents: ["disco"]` and get both families by descent; the former `family` override is gone. `disco polo` stays a standalone level 2 genre (a Polish dance-pop genre, not a disco descendant). `post-disco` is under disco (level 3 in both families).

An extra parent may be any other entry, not only a level 2 one: `italo disco` is level 3 and the extra parent of `spacesynth`. The radial map draws a cross-link only between level 2 nodes, so that one is not drawn.

## Rock tree (DR1)

Genres at level 2 in alphabetical order with their level 3 children indented; `[...]` are the extra parents, "(held)" marks the 19 genres left at `[Rock]` and provisional.

```
acoustic (held)
alternative rock
  britpop
  college rock
  dream pop [neo-psychedelia]
  grunge
  post-britpop [britpop]
  post-grunge [grunge]
  shoegaze [indie rock]
aor (held)
arena rock (held)
art rock
beat (held)
black metal [heavy metal, extreme metal]
  atmospheric black metal
  blackgaze [shoegaze]
  depressive black metal
  viking metal
british invasion (held)
classic rock
dance-rock (held)
dark metal (held)
death metal [heavy metal, extreme metal]
  brutal death metal
  death-doom [doom metal]
  deathcore [metalcore]
  funeral doom metal [death-doom, doom metal]
  goregrind [grindcore]
  melodic death metal
  pornogrind [goregrind, grindcore]
  technical death metal
electronic rock [Electronic]
experimental rock
  krautrock
  post-rock
glam
hard rock
heavy metal
  alternative metal [alternative rock]
  doom metal [extreme metal]
  extreme metal
  folk metal [Folk, World, & Country]
  funk metal [Funk / Soul]
  glam metal
  gothic metal [goth rock]
  grindcore [hardcore punk]
  groove metal [thrash]
  industrial metal [industrial, industrial rock]
  mathcore [metalcore, hardcore punk]
  metalcore [hardcore punk]
  nu metal [alternative metal]
  post-metal [post-rock, sludge metal]
  power metal [speed metal]
  progressive metal [progressive rock]
  rap metal [Hip Hop]
  sludge metal [doom metal, hardcore punk]
  speed metal
  symphonic metal
  thrash [extreme metal]
indie rock
  math rock [experimental rock, progressive rock]
  post-punk revival [post-punk]
  slowcore
industrial rock [industrial]
jangle pop (held)
mod (held)
new wave
no wave
noise rock
paisley underground (held)
pop rock
  power pop
post-punk [punk]
  coldwave [darkwave]
  dance-punk
  goth rock
progressive rock
  symphonic rock
psychedelic rock
  acid rock
  neo-psychedelia
  space rock [progressive rock]
psychobilly (held)
pub rock (held)
punk
  anarcho-punk
  crust [anarcho-punk, extreme metal]
  deathrock [goth rock]
  emo [hardcore punk]
  folk punk [Folk, World, & Country]
  hardcore punk
  melodic hardcore [hardcore punk]
  midwest emo [emo, math rock]
  noisecore [grindcore, hardcore punk, noise rock]
  oi
  pop punk [power pop]
  post-hardcore [post-punk]
  screamo [emo, post-hardcore]
rock and roll
  garage rock
  rockabilly
  surf
rock opera (held)
roots rock
sadcore (held)
shock rock (held)
soft rock (held)
southern rock (held)
stoner rock (held)
synth-rock (held)
```

## Parents (ADR-0030, 2026-10-19)

The three relations of the old format became one list, `parents`, with no change in behaviour. Mapping of the old data: `parent: null` (family F) became `[F]`; `parent: P` became `[P]`; `parent: P` with `also_under: [A, B]` became `[P, A, B]`; `parent: null` with `also_under: [A, B]` (acid, minimal, spacesynth, tribal, witch house) became `[F, A, B]`; disco (`also_in_genres: ["Electronic"]`) became `["Funk / Soul", "Electronic"]`. The old `genre` key became the derived `family`, kept only as the override of the four disco children (euro disco, hi-nrg, italo disco, nu-disco); `space disco` of 2026-10-19 carries it too. Proof: a snapshot of the tree, family counts, cross-links, outline rows and radial layouts taken from HEAD before the change equals the tree built from the new data (`web/js/genre-parents.test.mjs`, `server/tests/test_genre_parents_snapshot.py`). Ambiguities of the mapping: for extras the old `parent` was either null or the lowercase family entry (`pop`: alternative pop, art pop, estrada, middle of the road, new romantic, orchestral pop, progressive pop; null: epic, r&b), both now `[<Family>]`, and nothing read the difference.

## Two owner edits (Alex, 2026-10-19)

- `spacesynth`: `parents: ["synthwave", "italo disco"]`; it is level 3 under synthwave (family Electronic) with italo disco as a cross-link; status approved stays.
- `space disco` (new extra, no display (equals the key after DI1), synonym `space-disco`, `discogs` false, status approved): `parents: ["disco"]`, `family: "Electronic"`, level 3 under disco. Wikipedia: a subgenre of disco from the mid-1970s in Europe, France and Canada, with synthesizer and space themes (https://en.wikipedia.org/wiki/Space_disco). No other parents.

## Psytrance branch (Alex, 2026-10-16)

Alex: "trance and psy-trance are way too different". `psytrance` (display "psy-trance", a Discogs genre) is a plain level 2 umbrella, a sibling of `trance`: `parents: ["Electronic"]`, no extra parent, no link of any kind to trance. The three-level cap is unchanged (a fourth level was considered and rejected). Children (level 3, `parents` start with `"psytrance"`): `dark psytrance`, `forest psytrance`, `progressive psytrance`, `full-on psytrance` (new extras, `discogs` false, status approved, displays "Dark Psy-Trance" and so on; the Discogs search `style=<name>` (the Discogs API parameter) returned no results for any of them on 2026-10-16), `goa trance` (Discogs; moved from trance) and `psybient` (approved; also under ambient; moved from trance). Flavours: dark psytrance `dark`, progressive psytrance `progressive`. Synonyms: darkpsy, dark psy, dark psy-trance; forest psy, forest psy-trance; prog psy, progressive psy, progressive psy-trance; full on, fullon, full-on psy, full on psytrance, full-on psy-trance.

Judgement call: `goa trance` sits under psytrance only (no extra parent trance), so trance's children and counts no longer include goa trance or psytrance songs. `progressive trance` stays under trance and is not merged with `progressive psytrance`. Known psy genres not added: hi-tech psytrance, suomisaundi, psychill.

## Removed families (Alex, 2026-10-18)

Alex decided that the genre list describes how music sounds, not where or how it is used or what format it is. Four of the 15 Discogs families are removed from the vocabulary, the graph, the web and macOS copies and the tests, with every genre, synonym and extra under them, and nothing is re-parented:

- Stage & Screen: score (synonym film score), musical, theme, incidental music, vaudeville, video game music, soundtrack, trailer; synonyms stage and screen, soundtracks, film and tv, stage, screen.
- Children's: educational, lullaby, nursery rhymes, story; synonyms childrens, children, kids, kids music, children music.
- Brass & Military: brass band, concert band, marches, military, pipe & drum; synonyms brass and military, military and brass, military & brass.
- Non-Music: audiobook, dialogue, education, field recording, interview, karaoke, medical, monolog, poetry, political, promotional, public service announcement, radioplay, religious, sermon, sound poetry, speech, spoken word, technical, therapy; synonyms non music, nonmusic, spoken.

`epic` was kept at first as a level 2 genre of Classical; it was removed on 2026-10-20 (see below). The `epic trance` synonym of `uplifting trance` is unchanged.

Songs: every removed name, the family names and their synonyms are in `genre_filter.REMOVED_GENRES`, which joins `DROP` (TAG-073). The existing genre-tag migration (`migrate_tags`, run at startup) sees the stored tag change under `clean_tags`, backs the file up once (`backups-genre-merge/<uid>/library.json`) and rewrites it, so each song loses these genres on the next start; a song left without a genre stays valid. No new migration step and no `credits_schema` change. The ALIASES entry "film score" to "score" is gone.


## lo-fi removed (owner, 2026-10-20)

`lo-fi` is a production aesthetic, not a form, so it is removed from the vocabulary like `industrial` and `ethereal`: the rows in `genre_discogs.json`, `genre_levels.json` (it was a provisional Rock genre held at `[Rock]`), `genre_sources.json` and `genre_hierarchy_evidence.json` (the evidence label keeps its text, its `key` is null), and the built-in list in `genres.py`. It is added to `genre_filter.REMOVED_GENRES`, which joins `DROP` (TAG-073), so the stored tag `genre:lo-fi` is dropped at startup by the existing genre-tag migration; the live library has three such songs (Pictures Of Purple Skies by Memorex Memories, Aurora by oDDling, Raindrops by Kupla & j'san). No removal-list row. `lo-fi hip hop`, `chillhop` and similar are not vocabulary genres and were not touched (`lo-fi hip hop` exists only in the built-in autocomplete list in `genres.py`). Rock has 110 genres (41 level 2, 69 level 3), 19 held.


## Sovietwave (Alex, 2026-10-17; key renamed 2026-10-19, DJ1)

`sovietwave` (was `soviet wave`; no `display`): extra, `discogs` false, status approved, level 3 under `synthwave` (Wikipedia, https://en.wikipedia.org/wiki/Sovietwave, calls Sovietwave a synthwave subgenre from the post-Soviet region, early 2010s). Synonyms: soviet wave, soviet-wave, советская волна, советская-волна (the Cyrillic forms are also in `ALIASES`, since lookups only fold case, spaces and hyphens).


## Equal parents and the edits of 2026-10-19 (ADR-0037, task-0055)

Owner decisions BY1, BX and CB2: all parents are equal, a genre belongs to every family it descends from, the level is the shortest path depth, there is no depth cap. Statements above that speak of `parents[0]` as the primary parent, of `also_under`, `also_in_genres` or of the `family` override describe the earlier model and are history. The sentences in the decision notes about "primary parent" and "level 3 parent is never `parents[0]`" no longer apply; no depth rule limits a parent.

Data edits that came with it (owner, 2026-10-19; nothing else in the vocabulary changed):

- The `family` override of euro disco, nu-disco, hi-nrg, italo disco and space disco (extras file too) is removed; `post-disco` moved from Funk / Soul to disco (level 3). These genres are in Funk / Soul and Electronic.
- `psytrance` is under `trance` (level 3, dropped the Electronic family parent); `goa trance`, `dark psytrance`, `forest psytrance`, `full-on psytrance` and `progressive psytrance` are level 4; `psybient` keeps psytrance and ambient and is level 3.
- `eurodance` has `house`, `euro disco` and `Pop` (fusion flag on; level 2 through Pop; families Electronic, Funk / Soul, Pop); `hands up` and `italodance` keep it as parent.
- `darkwave` first had `Electronic`, `post-punk` and `new wave` (families Electronic and Rock); superseded by decision DB2 below.
- `synthpop` has `Electronic`, `Pop` and `new wave` (three families; the fusion flag is dropped because it is no longer a two-family blend); ebm and electroclash, its children, are now also in Rock (electroclash in Hip Hop through electro as well).
- `industrial` and `ethereal` are removed (REMOVED_GENRES, so the stored tags are dropped at startup; the alias "ethereal wave" went with them, so that tag is dropped too, because it only ever meant `ethereal`). Children of industrial: ebm keeps synthpop, rhythmic noise keeps noise, dark electro, harsh noise wall and power electronics are under Electronic and keep their subfamily "Experimental, industrial & noise" as a value of their own (ebm too); industrial metal keeps heavy metal and industrial rock, industrial rock keeps Rock (so industrial rock and industrial metal are no longer Electronic); the `related` links of witch house, neurofunk and darksynth to industrial are dropped. `genre_sources.json` and `genre_hierarchy_evidence.json` lost the two rows.

Darkwave (owner decision DB2, 2026-10-20): `darkwave` has only `post-punk` and `new wave` as parents; the Electronic family parent is dropped. It is now in Rock only (level 3 through post-punk or new wave), its Electronic subfamily "Synth & wave" is removed (a subfamily must belong to one of the genre's families, so a Rock-only genre has none) and the `genre_discogs.json` row lists Rock. Its only child `coldwave` keeps `post-punk` and `darkwave`, so it is Rock only too (level 3, no subfamily). Electronic loses both (148 to 146 members, Synth & wave 14 to 12), Rock stays at 123 members (darkwave moves from level 2 to 3: 50 level 2, 73 level 3), and 37 genres are now in more than one family.

Electro house (owner decision CT1, 2026-10-20): `electro house` has only `house` as parent and lists `electro` under `related` (Wikipedia calls electro house a house subgenre), so it is in Electronic only and no longer in Hip Hop. The only other child of `electro` is electroclash, which stays in Hip Hop through electro (its other parent synthpop reaches Electronic, Pop and Rock).

House and disco (owner decision DF1, 2026-10-20): `house` lists `disco` under `related` (house grew out of disco; a link, not a parent, so no parents, families, levels or counts change). The link is stored on one side only, like the others (the newer genre points at the older one, as electro house does at electro), and is undirected in meaning; it is served as `levels.house.related`.

Counts after the edits and the darkwave decision DB2 below: 535 genres, 579 family memberships (Electronic 146: 54 level 2, 87 level 3, 5 level 4; Rock 123: 50 and 73; Funk / Soul and Pop gained the disco and eurodance branches); subfamilies House 26, Techno 20, Trance 19, Breaks & bass 24, Synth & wave 12, Experimental, industrial & noise 21, Ambient & downtempo 10, Eurodance & disco 12. Level changes of blends (shortest path): hip house, trip hop, folk metal, folk punk, funk metal and rap metal are level 2; post-disco is level 3. 37 genres belong to more than one family.

Held back by the owner (not applied): the larger nesting proposal CA1 and BV (moves under soul, bop, dancehall, roots rock and others, the 13 held Rock genres).


## epic removed (owner, 2026-10-20)

`epic` is a descriptor (a mood), not a genre, and it wrongly pulled songs into the Classical family, so it is removed like `lo-fi`: the rows in `genre_levels.json` (Classical now has 24 genres, 534 entries in all), `genre_extras.json`, `genre_sources.json` and the built-in list in `genres.py`; `epic` is added to `genre_filter.REMOVED_GENRES`, which joins `DROP` (TAG-073), so the stored tag `genre:epic` is dropped at startup and the suggester (which only proposes vocabulary names) cannot suggest it again. `epic trance` stays a synonym of `uplifting trance`. The two songs that had it are in the removal list (TAG-109); no song had it as its only genre.
