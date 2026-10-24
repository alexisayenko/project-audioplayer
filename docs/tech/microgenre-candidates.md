# Microgenre candidates (phase 1 review)

Status: PROPOSAL for the owner's review, 2026-10-24. Documentation only: no data model, API or UI change, nothing in `server/data` touched. Task: [task-0100](../tasks/task-0100.md). Owner decision CH1 (2026-10-24): build the microgenre flag in phases; phase 1 is this candidate review, phase 2 (data model, API, web UI) waits for approval of the table and of the proposal at the end.

Idea (owner backlog): a boolean `microgenre` on a genre for very narrow styles, often internet-born (vaporwave, chillwave, witch house, sovietwave, darksynth, dreamwave), independent of the hierarchy level. A narrow style that Rate Your Music (RYM) does not list as a genre but that is a real, distinct scene style stays visible as a flagged microgenre instead of becoming a full genre. First candidate: `twilight psytrance`, today only a synonym of `full-on psytrance` (RYM: "night full-on, also known as twilight psytrance" inside the Full-On page; the owner confirmed it has no RYM page of its own).

## What was scanned

| Source | Count |
|---|---|
| Vocabulary (`server/data/genre_levels.json`) | 542 entries: 537 genres below level 1 plus 5 promoted level 1 forms |
| Approved or unreviewed extras (`discogs: false`, not in `genre_discogs.json`) | 70 |
| Owner library (synced data repo, read only, not copied here) | 498 songs, 453 with genre tags, 161 distinct tags (154 vocabulary genres, 7 family names: pop, rock, hip hop, blues, jazz, classical, reggae) |
| Library genres with 1 song / 2 songs | 40 / 26 (38 / 25 vocabulary genres) |
| The 13 unsure one-song genres from the backlog | all 13 reviewed; today `dreamsynth` and `folk pop` have 2 songs, the other 11 have 1 |
| Names outside the vocabulary (psytrance review leftovers plus twilight psytrance) | 6 (nitzhonot, suomisaundi and zenonesque are no longer among them: they are Rate Your Music genres and in the vocabulary since 2026-10-24) |
| Rows below | 50 (the rest of the 542 are trivial keeps: broad, regional or era genres with no microgenre signal) |

Library counts are the owner's songs on 2026-10-24 and are supporting evidence only. A genre can be narrow and well loved (chillwave, 18 songs) or broad and absent from the library.

## Working criteria

A genre is a microgenre candidate when most of these hold. C1 and C5 are the core; C6 never decides alone.

1. C1 Narrow scene or aesthetic: a named scene, label sound or visual aesthetic, not a whole tradition, era or country.
2. C2 Small catalogue: few releases (RYM release count when the owner can read it; Wikipedia gives no counts).
3. C3 Internet-born or scene-bound: born on blogs, Bandcamp, forums or tag culture, or tied to one label, city or region.
4. C4 Thin official footing: not an RYM genre, or only at a deep level under a broader genre.
5. C5 Distinct sound: a synonym of the parent would blur a difference the listener hears.
6. C6 Few library songs: tag appears on 0 to a handful of songs.

Recommendation words: **microgenre** (flag it), **keep** (full genre, no flag), **synonym of X** (fold into X), **drop** (leave out of the vocabulary; descriptor, ambiguous or unsupported).

The flag is about narrowness, not attestation. Two kinds of microgenre appear below: attested ones (RYM or Discogs list them: vaporwave, witch house, dungeon synth) where the flag is only a visibility cue, and unattested ones (twilight psytrance) where the flag is what lets the name stay in the vocabulary at all (see the proposal).

## Relation to AD and the source policy

- AD ([decisions.md](decisions.md#adr-0038-genre-model-genres-groups-modifiers-and-four-axes), [genre-terminology.md](genre-terminology.md#decided-since-the-model)) is about depth names: the level stays computed, and no word like "subgenre" or "microgenre" names a level. The flag does not conflict: it is a separate boolean about narrowness, not about depth. witch house is level 2, psycore level 4 and a level 2 genre can be a microgenre or not. Nothing in the tree, levels or counts changes. AD stays as it is; phase 2 should add one line that "microgenre" is an attribute, never a tier.
- Source policy ([genre-terminology.md](genre-terminology.md#source-policy-for-new-genres)): a new genre needs RYM, Discogs styles or Musicmap attestation. The flag would add a narrow, owner-approved exception for unattested scene styles. That is a policy change and needs the owner's yes (open point 1 below).

## Candidates

Columns: parents and level are today's data (`-` = not in the vocabulary). Songs = owner library tag count. Discogs = listed in `genre_discogs.json`. RYM: **yes** = confirmed in the repo (`genre_rym.json`) or by the owner; **likely** = I am fairly sure from memory, not verified (RYM returns HTTP 403 to automated fetches); **check** = owner to check. Confidence is mine, for the recommendation.

### A. The named examples and their neighbours (synthwave scene)

| Genre | Parents, level | Songs | Discogs | RYM | Rationale | Recommendation | Conf. |
|---|---|---|---|---|---|---|---|
| vaporwave | synthwave, L2 | 9 | yes | yes | Internet-born ~2010, collage aesthetic, unmistakable sound | microgenre | high |
| chillwave | synthwave, L2 | 18 | yes | yes | Blog-era internet-born; wide catalogue, so only C3 and C5 hold | microgenre | medium |
| witch house | Others, L2 | 1 | yes | likely | Internet-born tag style, slow dark sound, pun name (stays under experimental) | microgenre | high |
| sovietwave | synthwave, L2 | 5 | no (approved) | check | Post-Soviet scene, early 2010s, own Wikipedia article | microgenre | high |
| darksynth | synthwave, L2 | 11 | no (approved) | likely | Synthwave-scene offshoot with a clear sound; large Bandcamp catalogue | microgenre | medium |
| dreamwave | synthwave, L2 | 13 | no (approved) | check | Soft synthwave offshoot, scene-bound | microgenre | medium |
| dreamsynth | synthwave, L2 | 2 | no (approved) | check | Probably the same style as dreamwave under another name | synonym of dreamwave | low |
| outrun | synthwave, L2 | 0 | no (approved) | yes | 1980s film and arcade aesthetic; no Wikipedia page of its own | microgenre | medium |
| spacesynth | synthwave and italo disco, L2 | 6 | no (approved) | yes | 1980s Cosmic/Italo space-themed synth, revived by the scene; old, so only C1 and C5 | microgenre | low |

### B. Other extras and neighbours (non-Discogs, mostly trance and pop)

| Genre | Parents, level | Songs | Discogs | RYM | Rationale | Recommendation | Conf. |
|---|---|---|---|---|---|---|---|
| sunshine house | house, L2 | 1 | no (approved) | check | No scene or page found; one song | drop (flag it if the owner finds an RYM or scene source) | low |
| nu-nrg | trance, L2 | 0 | no (approved) | check | Small UK hard-dance scene with a Wikipedia article | microgenre | low |
| dream trance | trance, L2 | 2 | no (approved) | likely | 1990s Italian-led era style, few releases | microgenre | medium |
| deep trance | trance, L2 (question) | 0 | no | check | Vague; `deep` is a mood modifier (modifier test) | drop | low |
| acid trance | trance, L2 (question) | 0 | no | likely | Real 1990s style, but `acid` is a sound modifier; broad enough | keep | low |
| vocal trance | trance, L2 | 8 | no (approved) | likely | Vocals are not defining (task-0070), but RYM lists it and it is large | keep | medium |
| psybient | psytrance and ambient, L3 | 4 | no (approved) | likely | Established chill psytrance style; psychill is its other name | keep | medium |
| psycore | dark psytrance, L4 | 0 | no (approved) | yes | Fastest, experimental dark strand; 236 releases; level 4 | microgenre | medium |
| chillstep | dubstep, L4 | 0 | no (approved) | yes | Bandcamp-born ~2010, level 4 | microgenre | medium |
| space disco | disco, L3 | 0 | no (approved) | likely | 1970s Euro style, small catalogue, but a settled era genre | keep | low |
| folk pop | Others, L2 | 2 | no | likely | Broad, not a scene | keep | medium |
| orchestral pop | Pop, L2 | 1 | no | check | Looks like baroque pop under another name | synonym of baroque pop | low |
| progressive pop | Pop, L2 | 1 | no | likely | Broad umbrella-like label | keep | low |
| worldbeat | Others, L2 | 1 | no | check | Marketing label; the Tradition axis covers it | drop | low |
| estrada | Pop, L2 | 2 | no | check | Soviet and post-Soviet pop tradition, not a micro scene | keep | low |
| sadcore | Rock, L2 | 2 | no | likely | 1990s indie aesthetic, close to slowcore; established | keep | low |

### C. Library genres with 1 or 2 songs (rest of the one-song list)

| Genre | Parents, level | Songs | Discogs | RYM | Rationale | Recommendation | Conf. |
|---|---|---|---|---|---|---|---|
| beat | Rock, L2 | 1 | yes | check | Beat music (1960s); the word also means a format (terminology: medium) | keep | low |
| glitch | experimental, L3 | 1 | yes | likely | Established technique-led genre | keep | medium |
| glitch hop | bass music and breakbeat, L3 | 1 | yes | likely | Established hybrid | keep | medium |
| mbalax | Others, L2 | 1 | yes | likely | Senegalese tradition, not a micro scene | keep | high |
| modern classical | Classical, L2 | 1 | yes | likely | Broad (held on Final Frontier, AR) | keep | high |
| schlager | Pop, L2 | 1 | yes | likely | Large European tradition | keep | high |
| ghettotech | Others, L2 | 1 | yes | likely | Detroit scene style, tiny catalogue | microgenre | low |
| moombahton | bass music, L3 | 1 | yes | likely | Washington DC scene, blog-era (2009), distinct tempo | microgenre | medium |
| coldwave | post-punk and darkwave, L3 | 2 | yes | likely | French and Belgian 1980s scene; RYM treats it as a genre | keep | low |
| new beat | Others, L2 | 1 | yes | likely | Belgian 1980s scene, but large and settled | keep | low |
| horrorcore | Hip Hop, L2 | 1 | yes | likely | Subject-led hip hop style, established | keep | medium |
| vocal | Pop, L2 | 1 | yes | check | A descriptor (rule 4), not a style | drop | medium |

### D. Names outside the vocabulary (proposed additions)

Parent of each proposed addition is a proposal. None is in RYM under psytrance (2026-10-24 review); whether any has an RYM page elsewhere is for the owner to check. `nitzhonot` was in this table (goa trance, L4, "check") and is removed from it: the owner found its RYM page (2026-10-24, 549 releases, breadcrumb All genres > Goa Trance > Nitzhonot), so it is an attested genre, now a level 4 approved extra under goa trance, not a microgenre candidate. `suomisaundi` (psytrance, L3) and `zenonesque` (psytrance, L3 as proposed) were in this table too and are removed for the same reason: the owner pasted their RYM pages (2026-10-24, 175 and 48 releases), so they are attested genres, now approved extras (`suomisaundi` level 3 under psytrance, `zenonesque` level 4 under progressive psytrance; parents inferred from the RYM text, no breadcrumb shown), not microgenre candidates.

| Genre | Proposed parent, level | Songs | Discogs | RYM | Rationale | Recommendation | Conf. |
|---|---|---|---|---|---|---|---|
| twilight psytrance | full-on psytrance, L4 | 0 | no | no (owner: variant inside Full-On) | Dusk-set variant of full-on with a recognised scene name; a synonym hides it from filters | microgenre | medium |
| psybreaks | psytrance, L3 | 0 | no | check | Psy over breakbeats; narrow, scene-bound | microgenre | low |
| psydub | psybient, L4 | 0 | no | check | Dub-leaning psychill; narrow | microgenre | low |
| psychill | psybient | 0 | no | check | Another name for psybient | synonym of psybient | medium |
| hard psy | hi-tech psytrance | 0 | no | check | Loose name for hi-tech and psycore territory | synonym of hi-tech psytrance | low |
| psystep | - | 0 | no | check | Ad hoc fusion name, thin sources | drop | low |

### E. Narrow styles already in the vocabulary, absent from the library

| Genre | Parents, level | Songs | Discogs | RYM | Rationale | Recommendation | Conf. |
|---|---|---|---|---|---|---|---|
| dungeon synth | ambient, L3 | 0 | yes | likely | Tape-trading and Bandcamp scene, fantasy aesthetic, `related` synthwave | microgenre | high |
| harsh noise wall | Others, L2 | 0 | yes | likely | One-technique extreme noise scene | microgenre | medium |
| skweee | Others, L2 | 0 | yes | likely | Finnish and Swedish label scene | microgenre | medium |
| lowercase | ambient, L3 | 0 | yes | likely | Aesthetic of near-silence, tiny catalogue | microgenre | low |
| illbient | ambient, L3 | 0 | yes | likely | 1990s New York scene | microgenre | low |
| hyperpop | Pop, L2 | 0 | yes | likely | Internet-born but broad and charting; counter-example to C3 alone | keep | medium |
| phonk | Hip Hop, L2 | 4 | yes | likely | Internet-born, but large and stable; counter-example | keep | medium |

Scanned and left as full genres without a row (no microgenre signal): the broad Discogs styles and regional or era genres, for example house, techno, psychedelic rock, post-punk, darkwave, city pop, cloud rap, plunderphonics, jumpstyle, speedcore, kuduro, gqom, and the Electronic and Rock extras not listed above.

## Summary of recommendations

| Recommendation | Rows |
|---|---|
| microgenre | 22 (A 8, B 4, C 2, D 3, E 5) |
| keep | 19 |
| synonym of X | 4 (dreamsynth, orchestral pop, psychill, hard psy) |
| drop | 5 (sunshine house, deep trance, worldbeat, vocal, psystep) |
| Total | 50 |

Strongest microgenre cases (high confidence or the owner's first candidate): twilight psytrance, witch house, vaporwave, sovietwave, dungeon synth.

Effect if all 22 were flagged: 22 of 537 genres (4 percent); 54 library songs (12 percent of the 453 tagged songs) carry at least one flagged genre that exists in the library; 7 of the 8 children of synthwave would be microgenres (only dreamsynth is not, and it would become a synonym), so a map that hides microgenres by default would leave synthwave with almost no visible children.

## What the flag would do (PROPOSAL for the owner, phase 2, not implemented)

1. Data: optional boolean `microgenre: true` on a genre entry in `genre_levels.json` (and the matching `genres_v2.json` circle); absent means false. Allowed on any level and status. It does not change `parents`, level, family, `related`, `fusion`, counts or colours. Validation: boolean only; a microgenre may have children, but warn when it has non-microgenre children.
2. API: field name `microgenre` (boolean, same style as `fusion` and `provisional`) on the `GET /genres/vocabulary` rows and `levels` entries and in `GET /genres/v2`; always served, `false` when absent, so clients need no default.
3. Still assignable: songs carry microgenres as ordinary genre tags; pills, picker, suggestions, search and the Library filter work as for any genre. Song counts keep rolling up to the parents, so hiding a node never loses songs from its parent's bubble.
4. Web UI cue: a small "micro" chip on the genre card and in the picker next to the name; the word "microgenre" appears only as that attribute label, never as a level name (AD).
5. Genres map: a "Microgenres" switch next to "Fusion genres". Proposed default: hidden. Because 7 of 8 synthwave children are candidates, a softer rule is worth choosing (open point 3): hide by default only the microgenres the viewer has no songs in, or show them dimmed with the chip.
6. Filter: optional Library filter "microgenres only / exclude" (later, with the modifier filter of task-0065).
7. Source policy: the policy gains one clause. An unattested narrow style may be added only as a flagged microgenre, always a leaf, with owner approval and at least a Wikipedia article or two independent scene or label sources recorded in the genre's note. Attested microgenres (vaporwave, witch house) just carry the flag. `twilight psytrance` would move from a synonym of `full-on psytrance` to its own level 4 genre with `microgenre: true` (no migration: no library song carries it; the RYM name "night full-on" stays a synonym of it).
8. AD: unchanged. Add a line: "microgenre is an attribute (narrowness), not a depth name; level stays computed".
9. Not done in phase 2: no audio or distance rules, no new RYM data field, no change to the tree or to the 537 genres other than setting the flag on approved rows and adding approved new names.

## Open points for the owner

1. Policy: may an unattested but real scene style enter the vocabulary only as a flagged microgenre (twilight psytrance)? Recommended: yes, with the Wikipedia or two-source rule above.
2. Which rows get the flag? The 22 "microgenre" rows are a proposal; the doubtful ones are low-confidence (nu-nrg, ghettotech, psybreaks, psydub, lowercase, illbient, spacesynth).
3. Map default: hide all microgenres, or only those without songs in the viewer's library, or show dimmed?
4. Names to check on RYM (owner, since RYM cannot be fetched): sovietwave, dreamwave, dreamsynth, sunshine house, orchestral pop, worldbeat, estrada, deep trance, beat, vocal, and for the new names psybreaks, psydub, psychill, hard psy, psystep. Also confirm my "likely" rows if it matters (witch house, darksynth, nu-nrg, dream trance, dungeon synth, harsh noise wall, skweee, lowercase, illbient, moombahton, ghettotech).
5. dreamsynth: same style as dreamwave (fold it) or separate?
6. Label: "Microgenre", "Micro" or "Niche" in the UI.
7. Drops: sunshine house, deep trance, worldbeat and vocal are existing vocabulary names (psystep is only a new name, nothing to remove); removing them needs a phase 2 step (`REMOVED_GENRES` and the tag migration, one library song each for sunshine house, worldbeat and vocal), so confirm each.
