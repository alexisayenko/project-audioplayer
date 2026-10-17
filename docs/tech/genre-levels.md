# Genre levels (draft data, served and drawn)

`server/data/genre_levels.json` places every vocabulary style and extra (`genre_styles.json`, `genre_extras.json`) in a three-level tree. The server serves it in `GET /genres/vocabulary` as `levels` and `genre_synonyms` (GEN-051, GEN-052, API-119) and the rework map (`#/genres-rework`, WEB-085 to WEB-087, GEN-054) draws it. Tracked in [task-0037](../tasks/task-0037.md).

Only Electronic is drafted. Entry fields added later: `status`, `flavours`, `display` (sections below). The other 14 genres are provisional placeholders (every style level 2, `parent` null, `"provisional": true`) until Alex reviews them.

## Format

Level 1 is the 15 Discogs genres (not listed as entries). Each entry: `"<style key>": {"genre", "parent", "also_under"?, "provisional"?, "discogs"}`.

- `parent`: null for level 2 (umbrella or standalone style), a level-2 key for level 3. Hard cap three levels.
- `also_under`: other level-2 keys the style could sit under; the primary parent stays in `parent`.
- `discogs`: true when the key is in `genre_styles.json`, false when it exists only in `genre_extras.json`.
- `_meta`: rules and counts. Test: `server/tests/test_genre_levels.py`.

## Genre names and synonyms

The top-level `genres` block holds each of the 15 genres as `{"name", "synonyms"}` (lowercase; typos such as "electrnic" are input normalisation, not stored). Style entries may carry an optional `synonyms` list, filled only from `ALIASES` in `app/genre_filter.py` (copied read-only; 27 aliases whose target is a vocabulary style). A synonym never equals a vocabulary key, a genre name or another synonym (test). Agent judgement, awaiting Alex's review, except Electronic (Alex's list).

- Electronic: electronic dance music, edm, dance music, club music, electronic music. The ALIASES entries "electronic dance music" and "edm" currently map to the style `electronic dance`; here they sit on the genre instead, so they are not on that style.
- Brass & Military: brass and military, military and brass, military & brass
- Children's: childrens, children, kids, kids music, children music
- Classical: classical music. Folk, World, & Country: folk world and country, folk, world and country, world music, folk and country, world and country
- Funk / Soul: funk and soul, soul/funk, funk soul, soul and funk, funk & soul, rnb, r and b
- Hip Hop: hip-hop, hiphop, hip hop music, rap, hip-hop & rap, hip hop and rap
- Jazz: jazz music. Latin: latin music, latino. Non-Music: non music, nonmusic, spoken. Pop: pop music, popular music. Reggae: reggae music. Rock: rock music. Stage & Screen: stage and screen, soundtracks, film and tv, stage, screen. Blues: none.

Dropped candidates because they equal a vocabulary key or a genre name: r&b (style), audiobook, speech, soundtrack (styles), non-music and stage & screen (equal the genre names). The ALIASES entry "pop and chart" is not carried (target is a genre, not a style). "rap" is not a vocabulary key here (only cloud rap, pop rap, thug rap and similar), so it is kept as a Hip Hop synonym.

Decided: "dance music" and "club music" fold into Electronic (see Decisions).

## Counts (Electronic drafted; others provisional)

Electronic 141 (55 level 2, 86 level 3, 18 not in Discogs; after the 2026-10-16 removals and the psytrance branch below). Others, all level 2 and provisional: Rock 102, Folk, World, & Country 66, Latin 57, Pop 32, Jazz 26, Classical 24, Hip Hop 24, Funk / Soul 23, Non-Music 20, Blues 16, Reggae 13, Stage & Screen 9, Brass & Military 5, Children's 4. Total 558. Non-Discogs elsewhere: Rock 14, Pop 7, Funk / Soul 6, Folk, World, & Country 3, Stage & Screen 2.

## Electronic umbrellas (16, level-3 children)

All placements below are agent judgement, awaiting Alex's review.

- house (22): acid house, afro house, ambient house, big room house, deep house, electro house, euro house, french house, future house, garage house, ghetto house, hard house, hip house, italo house, melodic house, microhouse, progressive house, sunshine house, tech house, tribal house, tropical house
- trance (10): acid, deep, euro, hard, neo, nu-nrg, progressive, tech, uplifting, vocal
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

Rule applied: an umbrella with fewer than 2 children is a standalone level 2 style (italo disco and electronica; spacesynth and indietronica became level 2 with also_under).

## Extras placement

nu-nrg under trance (Discogs-less; extras parent hard trance would be level 4); darksynth, dreamsynth, dreamwave under synthwave (synthwave itself is a Discogs style); neurofunk, liquid funk, techstep under drum and bass; melodic techno under techno, melodic house under house; chillout under downtempo; electronica, dance, electronic dance, alternative dance are level 2 (indietronica under electronica).

## Electronic entries not in Discogs (14 now; the list below is from before the 2026-10-16 removals, see Decisions)

acid trance, afro house, alternative dance, big room house, breakbeat hardcore, bubblegum dance, chillout, dance, darksynth, deep trance, dreamsynth, dreamwave, electronic dance, electronica, electropop, french house, french touch, indietronica, jersey club, liquid funk, melodic house, melodic techno, neurofunk, nu-nrg, psybient, raggacore, rave, spacesynth, sunshine house, techno pop, techstep, uplifting trance, vocal trance.

## Judgement calls (agent judgement, awaiting Alex's review)

- jungle: under drum and bass, also under breakbeat.
- jersey club, baltimore club: both under breakbeat, also under house.
- psybient: under psytrance (Alex, 2026-10-16), also under ambient. nu-nrg: under trance (not hard trance).
- spacesynth: standalone level 2, also under italo disco. indietronica: standalone level 2, also under electronica.
- hands up: under eurodance, also trance. hardstyle: under hardcore, also trance. donk: under hardcore, also house. jumpstyle: under hardcore.
- chillwave, vaporwave: under synthwave, also downtempo. dungeon synth: under ambient, also synthwave.
- ebm: under industrial, also synthpop. dark electro: under industrial, also electro. rhythmic noise: under industrial, also noise.
- hard trance: also hardcore. melodic techno: also trance. tech trance: also techno. tech house: also techno. hard house: also hardcore. microhouse: also techno. minimal techno: also house. speed garage: also house. glitch hop: also breakbeat. future bass: also house. neurofunk: also industrial. darksynth: also industrial.
- Standalone level 2, no umbrella clearly fits: darkwave, tribal (also house), acid (also techno, house), minimal (also techno, house), witch house (also industrial).

## Decisions of 2026-10-16 (Alex)

Data change, built, tested and deployed: the startup migration rewrites the owner's tags on deploy (backup first, `backups-genre-merge/<uid>/library.json`).

Removed styles (gone from `genre_extras.json` and `genre_levels.json`; the old name stays an input alias in `ALIASES` and a synonym of the target, so old tags, picker input and share links still resolve):

| removed | folds to | songs |
|---|---|---|
| electronic dance, dance, electronica, indietronica, alternative dance (also "dance music", "edm", "dance & edm") | electronic (genre) | 21, 15, 9, 2, 2 |
| chillout | downtempo | 4 |
| afro house, big room house, melodic house | house | 2, 1, 2 |
| bubblegum dance | eurodance | 2 |
| techstep | drum and bass | 2 |
| liquid funk | liquid drum and bass (new) | 1 |
| rave | electronic (genre; corrected 2026-10-16, BA2) | 1 |
| breakbeat hardcore | breakbeat (its earlier reviewed parent; corrected BA2) | 1 |
| raggacore | dropped, not folded (the Russian "raggakor" means ragga-pop, not hardcore; BA2, the tag is in `DROP`) | 1 |
| jersey club | breakbeat | 1 |
| techno pop, electropop (incl. "russian electro pop", "electronic pop") | synthpop | 1, 9 |

Songs counted are distinct songs of the owner's live library (199 songs, guest `GET /library`, 2026-10-16); 65 songs change in all. 39 of them end up with fewer genre tags because the target tag was already there (a merge, not a loss); 3 of those merge into an existing synthpop tag. No song is left without a `genre:` tag. `club` and `club music` fold into `electronic` (decision AP1): `club` left `DROP` (TAG-073) and both are `ALIASES` to `electronic` and Electronic search synonyms; songs that lost `genre:club` in the earlier deployed clean-up are not restored. No song of the live library carries a club tag now (only `jersey club`, folded to breakbeat). The ONE_OFF fix for `soundcloud-122880128` now adds `genre:house` (french house is gone). `downtempo` keeps `trip hop` as its only level-3 child (the two-child rule is not applied to Discogs umbrellas).

Statuses (`status` on an entry; absent means unreviewed; the web shows a badge):

| status | styles |
|---|---|
| approved (badge "Alex approved") | vocal trance, melodic techno, psybient, darksynth, uplifting trance, dreamsynth, dreamwave, neurofunk, spacesynth, nu-nrg, sunshine house, liquid drum and bass |
| question (badge "under question") | deep trance, acid trance |

Precedence rule: Discogs outranks Alex's approval. `approved` is only stored on entries with `discogs: false`; for a Discogs style it is ignored and not stored (tropical house and chillwave are Discogs styles: approval ignored). `question` is allowed on any entry. Tests: `server/tests/test_genre_levels.py`.

Added: `liquid drum and bass` (extras, level 3 under drum and bass, approved, display "Liquid Drum & Bass"; synonyms liquid dnb, liquid d&b, liquid drum & bass, liquid drum n bass, liquid drum'n'bass, liquid drum and bass music, liquid drum & bass music, liquid funk).

`french house` came back on 2026-10-17 (DQ1): an extra (level 3 under house, `discogs: false`, not Discogs), and `french touch` is an `ALIASES` entry and a synonym of it, no longer a house fold. Stored `french touch` is rewritten to `french house` by the startup migration; stored `french house` stays (songs folded to house earlier stay house).

`melodic house` is intentionally not a style any more; the `melodic` flavour stays (used by melodic techno). `french` is not a flavour for now.

## Flavours

Status: defined, not attached (decision of 2026-10-16). The top-level `flavours` block exists and is served, but no style entry carries a `flavours` list yet; every `levels[<style>].flavours` is `[]`, and the map hides the Flavour selector and chips while no style carries one. The earlier assignment (styles per flavour, kept so nothing is lost) is in [genre-flavours-proposal.md](genre-flavours-proposal.md), not loaded by any code, awaiting Alex. The per-style lists described below and the counts listed under them are therefore the proposal, not the data.

A flavour is a modifier that runs alongside the tree, not a level. Top-level `flavours` block in `genre_levels.json`: `{"<key>": {"name", "kind": "sound" | "scene", "description"}}` (lowercase unique keys; a flavour key may equal a style key, e.g. `acid`, they are separate namespaces). A style entry may carry `"flavours": ["<key>", ...]` (no repeats, every key in the block). Only Electronic entries carry them so far; stored tags do not change.

Served by `GET /genres/vocabulary`: top-level `flavours` (the block as is) and per style `levels[<style>].flavours` (always a list, `[]` when none).

Flavours and the styles that carry them:

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

Uncertain assignments (agent judgement): darksynth (dark: the dark side of synthwave, could be none); dark electro (dark: also a style of its own under industrial); minimal techno (minimal, one use only); uplifting trance and vocal trance (one use each, kept because they are the clearest sound words); baltimore club and berlin-school (scene: the name already is the place; kept so the map can group scenes); progressive breaks (progressive). Left out on purpose: darkwave, tech inside techno, hard inside hardcore and hardstyle, dub techno, microhouse (minimal?), italo disco and euro disco (genres, not scenes), tropical house.

## Display names

An entry may carry `"display": "<string>"`: the name to show in the UI instead of the key (default: the key). The stored tag stays the key. Served as `levels[<style>].display` (`null` when absent). A display lowercased may not equal another vocabulary key. Set so far: `drum and bass` shows as "Drum & Bass", `liquid drum and bass` as "Liquid Drum & Bass". Every other spelling of drum and bass is a synonym of the key (dnb, d&b, drum n bass, drum'n'bass, drum & bass, drum and bass music, drum & bass music), and `ALIASES` maps them to the key.

## Disco umbrella across two genres (AO1)

`disco` is a Discogs style under two genres. Its primary genre stays `Funk / Soul` (per `genre_styles.json`), and it is a level 2 entry there, still provisional. New optional field on a level 2 entry: `"also_in_genres": ["Electronic"]` (list of other level 1 genre names; served as `levels[<style>].also_in_genres`, always a list). It means: show this entry as a level 2 node in those genres' trees too, because children of that genre hang under it. A child keeps its own `genre` and names the umbrella as `parent` even when the umbrella's genre differs, as long as the child's genre is in the umbrella's `also_in_genres`. Depth stays at most three. For the Electronic map: root Electronic, then `disco` (taken from `levels` where `also_in_genres` contains "Electronic"), then its children `euro disco`, `italo disco`, `hi-nrg`, `nu-disco` (level 3). `disco polo` stays a standalone level 2 style (a Polish dance-pop genre, not a disco descendant). `post-disco` (Funk / Soul, not in Discogs) belongs under disco by meaning, but Funk / Soul is undrafted, so it stays a provisional level 2 until that genre is drafted.

`also_under` may now point at any other entry, not only at a level 2 one: `spacesynth` keeps `also_under: ["italo disco"]` although italo disco is now level 3.

## Psytrance branch (Alex, 2026-10-16)

Alex: "trance and psy-trance are way too different". `psytrance` (display "Psy-Trance", Discogs style) is a plain level 2 umbrella, a sibling of `trance`: `parent` null, no `also_under`, no link of any kind to trance. The three-level cap is unchanged (a fourth level was considered and rejected). Children (level 3, `parent: "psytrance"`): `dark psytrance`, `forest psytrance`, `progressive psytrance`, `full-on psytrance` (new extras, `discogs` false, status approved, displays "Dark Psy-Trance" and so on; the Discogs search `style=<name>` returned no results for any of them on 2026-10-16), `goa trance` (Discogs; moved from trance) and `psybient` (approved; also under ambient; moved from trance). Flavours: dark psytrance `dark`, progressive psytrance `progressive`. Synonyms: darkpsy, dark psy, dark psy-trance; forest psy, forest psy-trance; prog psy, progressive psy, progressive psy-trance; full on, fullon, full-on psy, full on psytrance, full-on psy-trance.

Judgement call: `goa trance` sits under psytrance only (no `also_under: trance`), so trance's children and counts no longer include goa trance or psytrance songs. `progressive trance` stays under trance and is not merged with `progressive psytrance`. Known psy styles not added: hi-tech psytrance, suomisaundi, psychill.
