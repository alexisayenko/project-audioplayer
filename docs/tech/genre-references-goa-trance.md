# Genre reference tracks: goa trance (verified review)

Read-only review for [task-0093](../tasks/task-0093.md) / [ADR-0044](decisions.md), 2026-10-23, goa trance only (Alex: "store them in docs, and for now let's go through goa-trance only"). Nothing here is saved in `genre_references.json`; Alex approves rows, then Claude saves them through the API. It supersedes the unverified goa trance rows of [genre-references-library-candidates](genre-references-library-candidates.md) and the memory-only list in [genre-references-wave1](genre-references-wave1.md#candidate-tracks).

## Method

- Library: owner `library.json` and `genre_references.json` / `genre_eras.json` from `origin/main` of the data repo (read-only, `git show`; 497 songs). A song counts as goa trance when its `genres` contain "goa trance"; other songs were scanned by genre (psytrance, trance, full-on, psybient) and by artist name.
- Verification: Wikipedia (article pages opened), MusicBrainz (web-service search results opened), plus one personal blog and one Last.fm wiki, each labelled as weak. Discogs, Rate Your Music and AllMusic answered 403 and MusicBrainz human pages showed a bot check, so none of those was read; the MusicBrainz URLs below are the exact search queries that were opened (JSON). Where a fact has one source only it is marked.
- Years are the first release found (single or compilation), not the library year. Library years often come from the album or a re-release.
- Confidence: high = identity, year and role backed by 3+ sources; medium = identity and year backed by 2, role by 1-2; low = one weak source or conflicting dates.
- Roles follow ADR-0044: archetype (typical), origin (early song that started the genre), landmark (defining release), breakthrough (brought it to a wide audience). Cap: 3 picks per role per era. Eras are the five in `server/data/genre_eras_seed.json` (ids in brackets).
- Copyrighted text is not reproduced; notes are paraphrased.

## Library songs

Tagged goa trance (9):

| Library id | Artist - Title | Library year | Album | Other genres | Role in this review |
| --- | --- | --- | --- | --- | --- |
| `onquKz5SYRs` | Astral Projection - Mahadeva | 1995 | none | trance | pick |
| `iIsVzSMRw8E` | Hallucinogen - LSD | 1995 | Twisted | none | pick (saved entry `6d7d0ba3`, archetype, unreviewed) |
| `bIVSwq6X7JE` | Astral Projection - Kabalah | 1996 | Trust In Trance | none | pick |
| `UzrxPQyjkhA` | Astral Projection - Liquid Sun | 1997 | Dancing Galaxy | none | pick |
| `efc7WLCVWmw` | Man With No Name - Teleport | 1996 | none | none | pick |
| `BdCV1tD4CRQ` | Etnica - Vimana | 1997 | none | none | reserve |
| `DWWfoKnltg4` | Pleiadians - Alcyone | 1997 | I.F.O. | psytrance | reserve |
| `HjrdYHvrT1c` | Transwave - Land of Freedom | 1996 | Phototropic | none | reserve |
| `Tf2bdHM1oTg` | Hallucinogen - Dark Magus | 1995 | Twisted | psytrance | reserve |

Untagged but plausible, or looked at and rejected:

| Library id | Artist - Title | Library year | Tags | Verdict |
| --- | --- | --- | --- | --- |
| `nIN_e0ZgYBY` | Transwave - Land of Freedom (Liquid Soul rmx) | 1996 | psytrance, progressive trance | a 2015 remix of a goa track ([M8](#sources)); keep the original `HjrdYHvrT1c`, retag or ignore this copy |
| `yoDs4TaPpxU` | Astrix, Domestic - Pure Energy (Astral Projection Remix) | 2000 | psytrance | Israeli full-on, original 2000, the remix 2003 ([M10](#sources)); psytrance, not goa; no pick |
| `TiNx0-TshOg`, `Lud-4oFlEms` | Bamboo Forest - Xplorer (2000), Breath (2003) | 2000, 2003 | psytrance | unverified; a search snippet says a French psytrance project, no page opened; no pick |
| `pX8dL4BXqK0`, `9VpW8Atlj7k` | Static Movement - Sian (2016); Antinomy - State of Mind (2022) | 2016, 2022 | psytrance | modern psytrance, not goa; not examined further |
| `njYw6U8SfFo` and Carbon Based Lifeforms songs | Solar Fields, Carbon Based Lifeforms | 2003-2019 | psybient | psybient, not goa |

Counts: 9 tagged goa trance songs, 2 plausible untagged (one a remix copy, one psytrance), 4 unverified or rejected psytrance songs.

## Picks

Eras: 1 Proto-goa (c.1983-1991) `e545d6ea`; 2 Origins (1991-1993) `feed8c42`; 3 Golden era (1994-1997) `8730b570`; 4 Transition to psytrance (1998-2003) `cd490324`; 5 New school goa (2000-) `73c34eef`. Source codes are in [Sources](#sources).

| # | Pick | Role | Era | Year | In library | Sources | Conf. | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Astral Projection - Mahadeva | archetype | 3 | 1995 | yes `onquKz5SYRs` | W5, M1, K1 | high | Israeli act; first found on 1995 compilations (October 1995), re-recorded as "Mahadeva '99"; named as a hit by Wikipedia (unsourced) and as a notable track by the blog |
| 2 | Hallucinogen - LSD | archetype | 3 | 1994 | yes `iIsVzSMRw8E` | W3, W4, M2, K1 | high | opening track of Twisted (1995); first released as the "Alpha Centauri / LSD" single, July 1994; library and saved entry say 1995 (album year), see open points |
| 3 | Astral Projection - Kabalah | archetype | 3 | 1996 | yes `bIVSwq6X7JE` | W5, M4 | medium | on 1996 compilations (Megatripolis, Perfecto Fluoro) and The Astral Files (Dec 1996); named a hit by Wikipedia (unsourced); the exact album of the library copy is not confirmed |
| 4 | Doof - Let's Turn On | landmark | 3 | 1994 | no | W9, M18, K1 | medium | 12 inch on TIP Records 1994, album 1996; Wikipedia calls the album one of the defining early psytrance albums; the blog lists it among recommended albums |
| 5 | Astral Projection - Liquid Sun | landmark | 3 | 1997 | yes `UzrxPQyjkhA` | W6, M5 | high | on Dancing Galaxy (20 Oct 1997, Trust In Trance Records; AllMusic 4.5 stars per Wikipedia; listed among the best-selling trance albums); the 2000 Cass & Slide mix reached UK No. 91, dance No. 27 |
| 6 | Hallucinogen - Angelic Particles | landmark | 3 | 1995 | no | W3, W4, M11 | medium | single "Angelic Particles / Soothsayer", 24 Apr 1995; an early mix is the hidden track on Twisted; Wikipedia ties it to Doof's Let's Turn On sessions; role as landmark rests on its place in Posford's catalogue and on compilation reuse, no direct "defining" claim found |
| 7 | Man With No Name - Teleport | breakthrough | 3 | 1994 | yes `efc7WLCVWmw` | W7, W8, M6, K1 | medium | Wikipedia: 1994, first TIP compilation and Dragonfly, reissued as "Teleport / Sugar Rush" 1996 (UK No. 55); MusicBrainz earliest dated release is Feb 1995; the library says 1996; year is +-1 |
| 8 | Man With No Name - Sugar Rush | breakthrough | 3 | 1994 | no | W7, W8, M12 | medium | closes Oakenfold's Goa Mix (Essential Mix, 18 Dec 1994, the mix that carried the sound to UK listeners); first on a 1994 compilation, "Refined mix" 1996 on Moment of Truth |
| 9 | Infected Mushroom - Psycho | breakthrough | 4 | 1999 | no | W12, M20 | low | from The Gathering (1 Mar 1999); Wikipedia: among the first albums to bring Israeli psytrance to a mainstream audience; psytrance rather than goa (Wikipedia does not call it goa), so it marks the transition, not the genre core |
| 10 | Total Eclipse - Total Eclipse | origin | 2 | 1993 | no | W2, M14, M16, K1 | medium | on Project II Trance (Dragonfly, Aug 1993; Wikipedia calls the compilation the first goa trance album); the blog lists it as a notable track |
| 11 | The Infinity Project - Feeling Weird | origin | 2 | 1993 | no | W10, M15, M16 | low | on Project II Trance 1993; the group (Raja Ram, Graham Wood, 1991-1997) founded TIP Records; the same title is a 1995 TIP album, so artist and title may need a note |
| 12 | Filteria - Sky Input | origin | 5 | 2004 | no | W13, M21 | low | first release of Suntrip Records (Nov 2004), a label set up for melodic goa in the 1995-1998 style; an album title, no track verified; unverified as a track |
| 13 | Trilithon - Trance Dance | origin | 1 | 1991 | no | K1, M17 | low | the blog lists it as a proto-goa track (1991); MusicBrainz finds it earliest in 1992 (Dutch compilations); one weak source, unverified |

Reserve (all in library, ranked below the cap, optional):

| Library id | Pick | Suggested role | Era | Year | Sources | Conf. | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `BdCV1tD4CRQ` | Etnica - Vimana | archetype | 3 | 1997 | W11, M7 | medium | on the "Plastic" EP (Blue Room Released, March 1997); Etnica is a Milan goa act formed 1993, "known for classic tracks" per Wikipedia (not naming this one) |
| `DWWfoKnltg4` | Pleiadians - Alcyone | archetype | 3 | 1997 | W11, M9, K1 | medium | Etnica side project; album I.F.O. (Dragonfly, 1997), Alcyone first seen 6 Jul 1997 |
| `HjrdYHvrT1c` | Transwave - Land of Freedom | archetype | 3 | 1996 | M8, L1 | low | French duo (1994-1997); on Phototropic (Nov 1996); Last.fm calls it an international trance hit; Infected Mushroom cites Transwave as an influence ([W12](#sources)) |
| `Tf2bdHM1oTg` | Hallucinogen - Dark Magus | archetype | 3 | 1995 | W3, M3 | low | track 4 of Twisted (Sep/Oct 1995); no source calls it defining; the library BPM (115) looks wrong |

Not picked: Etnica - Starship 101 (1996 EP and Alien Protein, Blue Room; named a notable track by the blog and on a compilation titled "The Definition Of Goa Trance"; M13) is a good landmark if Alex wants a fourth, not in library, medium.

## Coverage by role and era

| Era | archetype | origin | landmark | breakthrough |
| --- | --- | --- | --- | --- |
| 1 Proto-goa | none | #13 (unverified) | none | none |
| 2 Origins | none | #10, #11 | none | none |
| 3 Golden era | #1, #2, #3 | none | #4, #5, #6 | #7, #8 |
| 4 Transition | none | none | none | #9 (low) |
| 5 New school | none | #12 (unverified) | none | none |

Flagged: era 1 has no verified pick (it is DAT mixtapes and non-goa EBM, new beat and acid house, not goa releases; Wikipedia names Front 242 and Nitzer Ebb as what the Goa DJs played); era 4 has no library song and its only pick is psytrance; era 5 has no verified track; no origin pick lies in the golden era (LSD 1994 is the nearest, kept as archetype).

Counts: 13 picks = 3 archetype, 4 origin, 3 landmark, 3 breakthrough, plus 4 reserve songs; 5 picks and 4 reserve are in the library, 8 picks are not. Confidence: 3 high, 6 medium, 4 low; unverified: #12 (as a track) and #13.

## Changes against the memory-only list

- Juno Reactor - Navras (~1994): Wikipedia dates "Navras" to the 2003 Matrix Revolutions soundtrack; the 1994 claim is wrong or unverified. Juno Reactor's early albums (Transmissions 1993, Beyond the Infinite 1995) are on NovaMute and Blue Room; no track verified.
- Doof - Let's Turn On "~1993, origin": the single is 1994 (TIP Records), not 1993, and not Dragonfly; kept as a 1994 landmark (#4).
- Hallucinogen - Angelic Particles (1995, landmark): kept (#6), year confirmed.
- Man With No Name - Teleport (~1996, landmark): kept but as breakthrough (#7), year 1994 per Wikipedia. Astral Projection - Mahadeva, Hallucinogen - Dark Magus: confirmed (#1; reserve).
- Eat Static - Abduction and X-Dream (blog mentions only): Wikipedia's Eat Static page does not mention goa trance, and the guessed X-Dream page title returned 404; not verified.

## Open points

1. Project II Trance: Wikipedia's Psychedelic trance article says it holds tracks by Man With No Name and Hallucinogen; the MusicBrainz tracklist (12 tracks, Dragonfly August 1993) lists neither. Who is right is unchecked (Discogs not readable). Do not cite the compilation as containing those two.
2. LSD year: 1994 (first single) or 1995 (library and Twisted album)? The saved entry says 1995. Proposal: set 1994 and note the 1995 album.
3. Teleport year: 1994 (Wikipedia) vs February 1995 (earliest MusicBrainz release) vs 1996 (library, compilation). Needs a Discogs or label-page check.
4. Roles are Claude's judgement from the evidence above; no source says "archetype". Alex's ear decides, especially #1-3 and the reserve.
5. Era 1, 4 and 5 are thin: an Israeli full-on pick (Astral Projection - Mahadeva '99, 1999; verified only as a release) and a real new school track (Filteria, Mindsphere, Khetzal and Suntrip artists appear in sources but no track) need Alex's choice or a Discogs/RYM check from a machine that can open them.
6. Bamboo Forest songs (`TiNx0-TshOg`, `Lud-4oFlEms`) are tagged psytrance; "Bamboo Forest" is also the name of an early Goa party site (Wikipedia, Goa trance), so check the artist before retagging.
7. Library hygiene (not in scope): `Transwave - Land of Freedom` has two copies; the remix copy is tagged psytrance.
8. Saving: unique per genre by normalised artist and title, so a role change for the same track means PATCH, not a second entry. Source URLs are the exact ones below; the MusicBrainz ones are web-service queries, replace them with human pages if Alex prefers.

## Sources

All opened on 2026-10-23. Type is the API source type. W = Wikipedia, M = MusicBrainz, K/L = other.

| Code | Type | URL | What it gave |
| --- | --- | --- | --- |
| W1 | wikipedia | https://en.wikipedia.org/wiki/Goa_trance | scene history (Goa DJs, 1983 EBM shift, Oakenfold 1994); no track list |
| W2 | wikipedia | https://en.wikipedia.org/wiki/Psychedelic_trance | history; Project II Trance (1993) as first goa trance album; golden age 1994-1997; Let it RIP (1997) as commercial decline |
| W3 | wikipedia | https://en.wikipedia.org/wiki/Twisted_(Hallucinogen_album) | Twisted: 16 Oct 1995, Dragonfly, track list |
| W4 | wikipedia | https://en.wikipedia.org/wiki/Hallucinogen_(musician) | singles with years (LSD 1994, Angelic Particles 1995) |
| W5 | wikipedia | https://en.wikipedia.org/wiki/Astral_Projection_(band) | discography, notable tracks |
| W6 | wikipedia | https://en.wikipedia.org/wiki/Dancing_Galaxy | Dancing Galaxy 1997, Liquid Sun, chart and reviews |
| W7 | wikipedia | https://en.wikipedia.org/wiki/Man_with_No_Name_(musician) | Teleport 1994, Sugar Rush, chart positions |
| W8 | compilation | https://en.wikipedia.org/wiki/The_Goa_Mix | Oakenfold Goa Mix, 18 Dec 1994, structure, reception |
| W9 | wikipedia | https://en.wikipedia.org/wiki/Doof_(musician) | Let's Turn On single 1994, album 1996 |
| W10 | wikipedia | https://en.wikipedia.org/wiki/The_Infinity_Project | group 1991-1997, TIP Records 1994 |
| W11 | wikipedia | https://en.wikipedia.org/wiki/Etnica | Etnica and Pleiadians discography |
| W12 | wikipedia | https://en.wikipedia.org/wiki/Infected_Mushroom | The Gathering 1999; influences incl. Transwave |
| W13 | wikipedia | https://en.wikipedia.org/wiki/Suntrip_Records | founded 2004; first release Filteria, Nov 2004 (page flags primary sources) |
| M1 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Mahadeva%20AND%20artist:%22Astral%20Projection%22&fmt=json&limit=10 | Mahadeva releases from Oct 1995 |
| M2 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:LSD%20AND%20artist:Hallucinogen&fmt=json&limit=12 | LSD first release 14 Jul 1994 |
| M3 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Dark%20Magus%22%20AND%20artist:Hallucinogen&fmt=json&limit=8 | Dark Magus on Twisted 1995 |
| M4 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Kabalah%20AND%20artist:%22Astral%20Projection%22&fmt=json&limit=10 | Kabalah 1996 releases |
| M5 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Liquid%20Sun%22%20AND%20artist:%22Astral%20Projection%22&fmt=json&limit=10 | Liquid Sun 13 Oct 1997 |
| M6 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Teleport%20AND%20artist:%22Man%20With%20No%20Name%22&fmt=json&limit=10 | Teleport earliest Feb 1995 |
| M7 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Vimana%20AND%20artist:Etnica&fmt=json&limit=10 | Vimana on Plastic, Mar 1997 |
| M8 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Land%20of%20Freedom%22%20AND%20artist:Transwave&fmt=json&limit=10 | Phototropic 18 Nov 1996; Liquid Soul remix 2015 |
| M9 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Alcyone%20AND%20artist:Pleiadians&fmt=json&limit=10 | Alcyone 6 Jul 1997 |
| M10 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Pure%20Energy%22%20AND%20artist:Astrix&fmt=json&limit=10 | Pure Energy 2000, AP remix 2003 |
| M11 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Angelic%20Particles%22%20AND%20artist:Hallucinogen&fmt=json&limit=10 | Angelic Particles single 24 Apr 1995 |
| M12 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Sugar%20Rush%22%20AND%20artist:%22Man%20With%20No%20Name%22&fmt=json&limit=10 | Sugar Rush 1994 comps, Goa Mix, 1996 Refined mix |
| M13 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Starship%20101%22%20AND%20artist:Etnica&fmt=json&limit=10 | Starship 101 1996 |
| M14 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Total%20Eclipse%22%20AND%20artist:%22Total%20Eclipse%22&fmt=json&limit=10 | Total Eclipse on Project II Trance, Aug 1993 |
| M15 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Feeling%20Weird%22%20AND%20artist:%22Infinity%20Project%22&fmt=json&limit=10 | Feeling Weird on Project II Trance |
| M16 | compilation | https://musicbrainz.org/ws/2/release/7cbfa929-c6c9-4a04-8563-527091023f1b?inc=recordings+artist-credits&fmt=json | Project II Trance tracklist (Dragonfly, 1993-08) |
| M17 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Trance%20Dance%22%20AND%20artist:Trilithon&fmt=json&limit=10 | Trance Dance earliest 1992 |
| M18 | musicbrainz | https://musicbrainz.org/ws/2/release?query=release:%22Let%27s%20Turn%20On%22%20AND%20artist:Doof&fmt=json&limit=10 | Let's Turn On releases (TIP 1994, 1996) |
| M20 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Psycho%20AND%20artist:%22Infected%20Mushroom%22&fmt=json&limit=8 | Psycho on The Gathering, 1 Mar 1999 |
| M21 | musicbrainz | https://musicbrainz.org/ws/2/release-group?query=releasegroup:%22Sky%20Input%22%20AND%20artist:Filteria&fmt=json&limit=5 | Sky Input album, 22 Nov 2004 |
| K1 | other | https://www.karangill.com/the-best-of-goa-trance-top-artists-albums-and-tracks/ | personal blog (Karan Gill): notable tracks and recommended albums; one person's taste, weak |
| L1 | other | https://www.last.fm/music/Transwave/+wiki | user-written Last.fm wiki on Transwave; weak |
