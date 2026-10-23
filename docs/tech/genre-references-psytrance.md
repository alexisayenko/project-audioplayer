# Genre reference tracks: psytrance (verified review)

Verified review for [task-0093](../tasks/task-0093.md) / [ADR-0044](decisions.md), 2026-10-24, the genre `psytrance` itself (owner request 2026-10-24: "run agent to propose reference tracks for psytrance"). Read-only: nothing is saved in `genre_references.json`. It supersedes the psytrance row of [genre-references-library-candidates](genre-references-library-candidates.md) (Pure Energy, from memory). Same method as [genre-references-goa-trance](genre-references-goa-trance.md).

Scope: `psytrance` has parent trance; goa trance is its child with its own review, so no goa picks are repeated here. The children dark psytrance, progressive psytrance, forest psytrance, full-on psytrance, hi-tech psytrance and psybient get their own reviews later; picks here are not made for them, but songs that clearly belong to one carry a note. Psybient is also a child of psytrance (`genre_extras.json`) and psycore a level 4 child of dark psytrance (back as an approved extra on 2026-10-24); both get their own reviews, so library songs tagged psybient are only listed.

## Method

- Library: owner `library.json` and `genre_references.json` / `genre_eras.json` from `origin/main` of the data repo (read-only, `git show`; 498 songs). A song counts as psytrance when its `genres` contain "psytrance"; all other songs were scanned by genre (goa trance, trance, psybient), by artist name and by tempo (136-160 BPM, untagged or electronic tags).
- Existing references: `genre_references.json` has no `psytrance` key (it holds goa trance 9, progressive house 6, progressive trance 7), so nothing here duplicates a saved entry.
- Eras: `server/data/genre_eras_seed.json` and the data repo `genre_eras.json` hold eras for goa trance only. No era ids exist for psytrance and none are invented; see [Periods](#periods-informal-no-era-ids).
- Verification: Wikipedia articles (opened), MusicBrainz web-service searches (JSON, opened), the Last.fm tag wiki and artist wiki, and two listicles (DoubleBlind, Viberate; weak, used for role only). Discogs, Rate Your Music and AllMusic were not read (403 in the earlier goa research; not retried). MusicBrainz human pages answered with a browser check when tried (`/recording/d6d36fbb-...`), so the readable URLs in [Saved MusicBrainz pages](#musicbrainz-readable-pages) are built from the ids in the JSON results and were not opened; the JSON queries in [Sources](#sources) are what was actually read. MusicBrainz also answered 503 to parallel requests; they were repeated one at a time.
- Genre fit: the artists carry the label psytrance on MusicBrainz (Infected Mushroom psytrance 20 votes and goa trance 7, Astrix psytrance 6, Vini Vici psytrance 1) and on Wikipedia (Infected Mushroom psychedelic trance, Astrix psychedelic trance and progressive psytrance, Vini Vici psychedelic trance, Great Spirit psytrance single). Juno Reactor is tagged goa trance first (3 votes; psytrance 1), so no Juno Reactor track is picked.
- Years are the first release found (single, EP, compilation or album), not the library year.
- Confidence: high = identity, year and role backed by 3+ sources; medium = identity and year backed by 2, role by 1-2; low = one weak source or conflicting dates.
- Roles follow ADR-0044: archetype (typical), origin (early song that started the genre), landmark (defining release), breakthrough (brought it to a wide audience). Cap: 3 picks per role. Roles are Claude's judgement from the evidence; no source says "archetype".
- Copyrighted text is not reproduced; notes are paraphrased.

## Library songs

Tagged psytrance (8):

| Library id | Artist - Title | Library year | Album | Other genres | Verdict |
| --- | --- | --- | --- | --- | --- |
| `yoDs4TaPpxU` | Astrix, Domestic - Pure Energy (Astral Projection Remix) | 2000 | none | none | pick #2 (the library copy is the 2003 remix of a 2000 track); belongs to child full-on psytrance (plausible, unverified) |
| `TiNx0-TshOg` | Bamboo Forest - Xplorer | 2000 | none | none | pick #3 |
| `Lud-4oFlEms` | Bamboo Forest - Breath | 2003 | Bamboo Forest | none | reserve; not examined on MusicBrainz, the album is dated 2003-06 by the Voyager result |
| `pX8dL4BXqK0` | Static Movement - Sian | 2016 | Sian | progressive trance | reserve; MusicBrainz: Israeli psychedelic trance artist, single dated 2016-11-07 (one source) |
| `9VpW8Atlj7k` | Antinomy - State of Mind | 2022 | State of Mind | none | reserve; MusicBrainz: Israeli psychedelic trance project, single dated 2022-05-30, also on Set.37 (Iboga Records, 2022-07-15); one source |
| `Tf2bdHM1oTg` | Hallucinogen - Dark Magus | 1995 | Twisted | goa trance | belongs to goa trance (reserve of the [goa review](genre-references-goa-trance.md)); no pick here |
| `DWWfoKnltg4` | Pleiadians - Alcyone | 1997 | I.F.O. | goa trance | belongs to goa trance (goa reserve); no pick here |
| `nIN_e0ZgYBY` | Transwave - Land of Freedom (Liquid Soul rmx) | 1996 | none | progressive trance | belongs to goa trance (a 2014 remix of a 1996 goa track); retag or ignore this copy |

Untagged, tagged with a child or neighbour, or looked at and set aside:

| Library id | Artist - Title | Library year | Tags | Verdict |
| --- | --- | --- | --- | --- |
| `xoeC2uFIefI` | Bamboo Forest - Voyager | 2003 | none | untagged but plausible psytrance (MusicBrainz: psychedelic trance project; on the 2003-06 album Bamboo Forest, later Revival 2005); no pick |
| `HmOMnd912xE` | Wild Pogo - Francis a. Preve | 2018 | none | unverified; a web search found nothing, so no genre claim; not psytrance on any evidence |
| `71Hl-tiMhYc` | Astral Projection - Free Tibet | 1997 | goa trance | outside this scope; Wikipedia names "Free Tibet" as a Hilight Tribe track that Vini Vici remixed, so artist and year of this copy should be checked |
| `b5L-LJkp9dw`, `1gJt9rpf-Lk`, `bWr_3wLkx-M` | Carbon Based Lifeforms - Nattväsen (2019), Somewhere in Russia (2011), Mos 6581 (2003) | 2003-2019 | psybient | psybient, not psytrance proper |
| `njYw6U8SfFo` | Solar Fields - Insum | 2005 | psybient | psybient; its candidate row stays in the library-candidates file |

Counts: 8 songs tagged psytrance (3 of them belong to goa trance); 1 untagged but plausible; 5 psybient songs; 1 unverified. Only 5 tagged songs are psytrance proper, and four of them are by minor acts that no Wikipedia page covers (Bamboo Forest twice, Static Movement, Antinomy), so they are archetype material at best.

## Picks

Source codes are in [Sources](#sources). All years verified on at least one MusicBrainz result unless noted.

| # | Pick | Role | Year | In library | Sources | Conf. | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Astrix - Deep Jungle Walk | archetype | 2016 | no | W4, M6, O1, O2 | medium | first release on the album He.art (29 Feb 2016, Hom-Mega); later on the A State of Trance 800 compilation (2017); DoubleBlind lists it among the best psytrance songs and Viberate among its landmark releases; Wikipedia names the album He.art (2016) but not the track; Astrix is described as progressive psytrance with full-on influence, so the track may belong to child progressive or full-on |
| 2 | Astrix, Domestic - Pure Energy | archetype | 2000 | yes `yoDs4TaPpxU` (the remix copy) | M1, M12 | low | original on the compilation Contact: Clubber Vol. 1 (22 Sep 2000, GB), also Retro: 10 Years of Israeli Trance Vol. 2 (2002); the Astral Projection remix is on Raveolution (2003); one source for the track, the artist tag is psytrance; library copy is the remix, so link it only if the remix is wanted; probably child full-on |
| 3 | Bamboo Forest - Xplorer | archetype | 2000 | yes `TiNx0-TshOg` | M7, O5 | low | single "Xplorer / Vekto" (Apr 2000, GB) and the compilation Dragonfly Classix II (2001); Last.fm: French psytrance project from Paris started 1995; no source calls the track typical |
| 4 | Vini Vici - The Tribe | landmark | 2015 | no | W5, M4, O2 | medium | on the album Future Classics (13 Apr 2015); Wikipedia: wide popularity (over 11 million Spotify streams by 2019, per the page); in A State of Trance Year Mix 2015; Viberate lists it among landmark releases |
| 5 | Infected Mushroom - Bust a Move | landmark | 2000 | no | W3, M5 | medium | on Classical Mushroom (1 Feb 2000, IL); Wikipedia calls it one of the duo's best efforts; the role rests on that one sentence, so "landmark" is weak |
| 6 | Armin van Buuren, Vini Vici feat. Hilight Tribe - Great Spirit | breakthrough | 2016 | no | W6, W5, M3, O4 | high | digital single of 12 Dec 2016 (Armind/Armada), the first psytrance release of the trance DJ Armin van Buuren; gold or platinum in five countries (per Wikipedia); on Tomorrowland 2017 (compilation, 20 Jul 2017) and in the A State of Trance Year Mix 2016; no source states "brought psytrance to a wide audience" outright, the role is inferred from reach |
| 7 | Infected Mushroom - Psycho | breakthrough | 1999 | no | W3, M2, M11, O2 | medium | album The Gathering (cassette 1 Mar 1999, IL); Wikipedia: The Gathering was among the first albums to bring Israeli psytrance to a mainstream audience, and "Psycho" is its popular track; MusicBrainz also holds a 1998 compilation, Forest of the Saints, and a live mix on Full On 4 (Feb 2000), so the year conflicts (see open points); child full-on is plausible |

No origin pick. Reasons are in [Origin role](#origin-role).

Reserve (not picks, in library, optional): Static Movement - Sian (`pX8dL4BXqK0`, 2016), Antinomy - State of Mind (`9VpW8Atlj7k`, 2022), Bamboo Forest - Breath (`Lud-4oFlEms`, 2003). All are minor acts found on MusicBrainz only; no source gives them a role.

Not picked, named in one weak source only (DoubleBlind or Viberate), not verified: Astral Projection - Mahadeva and Etnica - Starship 101 (goa trance, see the goa review); Infected Mushroom (Skazi remix) - I Wish; Talamasca - A Frenchman in Belgrade; Astrix and Vini Vici - Adhana; 1200 Micrograms - DMT; Skazi - Falling; GMS - Emergency Broadcast System (Viberate, 2005); Electric Universe - Cosmic Experience (Viberate, 2004); Juno Reactor - Pistolero (2000; film trailer use per Wikipedia, but the act is tagged goa trance first); Hilight Tribe - Free Tibet (Wikipedia mention only). Infected Mushroom - Becoming Insane (Vicious Delicious, 2007) is named on Wikipedia as a notable track and fits as a second breakthrough or landmark if Alex wants one; not checked on MusicBrainz.

### Origin role

Psytrance is classified here under trance, and the sources describe it as growing out of goa trance, with the term settling in the late 1990s ([W2](#sources)). No source names a first psytrance track, and the early releases are goa ([goa review](genre-references-goa-trance.md)). Songs that fit the child styles are noted for their reviews:

- Dark psytrance: Wikipedia ([W1](#sources)) credits Xenomorph with bringing the dark occult aesthetic with Cassandra's Nightmare (1998), and cites X-Dream's Radio (1998) as an early influence; dark psytrance became a distinct style after 2003 in Germany and Russia. Child: dark psytrance.
- Full-on: the name is often tied to the first volume of Hom-Mega's Full On compilation series in 1998 ([O3](#sources), Last.fm, user-written; its other page says early 2000s). Child: full-on psytrance.

## Periods (informal, no era ids)

Only dates that an opened page states; no era ids exist for psytrance and these are not proposed as era data.

- Parties spread from 1993 and the scene turned commercial in 1994; the goa trance peak is 1994-1997 and Let it RIP (1997) is called its commercial death ([W1](#sources)); the goa review covers this.
- Late 1990s: psytrance developed out of goa trance culture ([W2](#sources)); Infected Mushroom (formed 1996 per MusicBrainz) releases The Gathering in 1999; the 1998 Full On compilation claim is weak ([O3](#sources)).
- After 2003: dark psytrance is a distinct style ([W1](#sources)); 2004: a full day of psytrance at Glastonbury ([W1](#sources)).
- 2010s: crossover to the mainstream trance audience, Vini Vici from 2013 and Great Spirit in December 2016 ([W5](#sources), [W6](#sources)).

## Coverage by role

| archetype | origin | landmark | breakthrough |
| --- | --- | --- | --- |
| #1 (medium), #2 (low), #3 (low) | none | #4, #5 (medium) | #6 (high), #7 (medium) |

Counts: 7 picks = 3 archetype, 0 origin, 2 landmark, 2 breakthrough; 2 picks are in library (#2 as a remix copy, #3), 5 are not. Confidence: 1 high, 4 medium, 2 low. Unverified: none of the picks lacks a source, but the roles of #2, #3 and #5 are thin. Three reserve songs.

## Open points

1. Origin: leave it empty for the umbrella genre, or point it to the goa origin (Total Eclipse, 1993) and give the origins to the children (dark: Xenomorph, X-Dream; full-on: Hom-Mega compilations)? A Rate Your Music or Discogs check would help (not readable here).
2. Child overlap: Deep Jungle Walk, Pure Energy and Psycho may be better as references of progressive or full-on psytrance. Decide whether the umbrella keeps them or waits for the child reviews.
3. Psycho year: 1999 (album, MusicBrainz cassette 1 Mar 1999) or 1998 (the compilation Forest of the Saints; its date is unchecked and may be a catalogue year)? Proposal: 1999 with the compilation named in the note once confirmed on Discogs.
4. Pure Energy: first release is Contact: Clubber Vol. 1 (Sep 2000) per MusicBrainz only; the library copy is the 2003 Astral Projection remix tagged psytrance with year 2000. Confirm the original on Discogs and decide whether to link the remix copy, retag it, or leave the pick without a song_id.
5. Library years: Xplorer 2000 matches MusicBrainz (Apr 2000); Dark Magus and Alcyone carry both goa trance and psytrance tags (keep goa, drop psytrance if goa is the intent); Voyager has no genre tag.
6. Library check: `71Hl-tiMhYc` Astral Projection - Free Tibet may be a mis-attributed Hilight Tribe track (Wikipedia names Free Tibet as theirs); out of scope here.
7. Great Spirit is credited in several ways (Armin van Buuren and Vini Vici feat. Hilight Tribe on Wikipedia, Vini Vici feat. Hilight Tribe on Tomorrowland 2017); saving is unique per normalised artist and title, so choose one artist string. It is not in the library, so a reference would carry explicit artist, title and year.
8. Roles are judgement. The evidence base for archetypes is thin: the acts with Wikipedia pages (Infected Mushroom, Astrix, Vini Vici) are full-on, progressive or crossover, and the library's plain psytrance songs are minor acts; a listener's ear (Alex) or an RYM-style list should choose the typical song.
9. Saved MusicBrainz sources would use the readable pages below; they were not opened (bot check), so check one page before saving.

## Sources

All opened on 2026-10-24. Type is the API source type. W = Wikipedia, M = MusicBrainz (web-service JSON), O = other.

| Code | Type | URL | What it gave |
| --- | --- | --- | --- |
| W1 | wikipedia | https://en.wikipedia.org/wiki/Psychedelic_trance | history: 1993-1997 goa phase, dark psytrance after 2003, Xenomorph and X-Dream 1998, Glastonbury 2004; no mainstream breakthrough section |
| W2 | wikipedia | https://en.wikipedia.org/wiki/List_of_trance_genres | psytrance developed in the late 1990s out of goa trance culture; listed subgenres |
| W3 | wikipedia | https://en.wikipedia.org/wiki/Infected_Mushroom | albums and years, The Gathering as an early mainstream Israeli psytrance album, Psycho and Bust a Move as notable tracks |
| W4 | wikipedia | https://en.wikipedia.org/wiki/Astrix | Avi Shmailov, progressive psytrance with full-on influence, albums Eye to Eye 2002 to He.art 2016; no track pages |
| W5 | wikipedia | https://en.wikipedia.org/wiki/Vini_Vici | Israeli duo, The Tribe 2015, Great Spirit 2016, other releases |
| W6 | wikipedia | https://en.wikipedia.org/wiki/Great_Spirit_(song) | Great Spirit: 12 Dec 2016, labels, credited writers, certifications, first psytrance release of Armin van Buuren |
| W7 | wikipedia | https://en.wikipedia.org/wiki/Juno_Reactor | genres goa trance and psytrance, Pistolero and Matrix use (not picked) |
| M1 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Pure%20Energy%22%20AND%20artist:Astrix&fmt=json&limit=15 | Pure Energy: Contact Clubber Vol. 1 (2000-09-22), Retro Vol. 2 (2002), AP remix on Raveolution (2003-03) |
| M2 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Psycho%20AND%20artist:%22Infected%20Mushroom%22&fmt=json&limit=10 | Psycho: Forest of the Saints 1998, The Gathering 1999-03-01 (IL cassette), 1999-04-28, live mix on Full On 4 (2000-02) |
| M3 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Great%20Spirit%22%20AND%20artist:%22Vini%20Vici%22&fmt=json&limit=8 | Great Spirit: ASOT Year Mix 2016 (2016-12-16), Tomorrowland 2017 (2017-07-20), Part of the Dream (2017-10-06) |
| M4 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22The%20Tribe%22%20AND%20artist:%22Vini%20Vici%22&fmt=json&limit=8 | The Tribe: Future Classics (2015-04-13), Kearnage Vol. 1 and ASOT Year Mix 2015 |
| M5 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Bust%20a%20Move%22%20AND%20artist:%22Infected%20Mushroom%22&fmt=json&limit=8 | Bust a Move on Classical Mushroom (2000-02-01 IL, 2000-06-20) |
| M6 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Deep%20Jungle%20Walk%22%20AND%20artist:Astrix&fmt=json&limit=15 | Deep Jungle Walk: He.art (2016-02-29), Grotesque 250, ASOT 800 (2017-02-17), Goa Culture XXI (2016-06) |
| M7 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Xplorer%20AND%20artist:%22Bamboo%20Forest%22&fmt=json&limit=5 | Xplorer / Vekto (2000-04, GB), Dragonfly Classix II (2001); artist described as a psychedelic trance project |
| M8 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Sian%20AND%20artist:%22Static%20Movement%22&fmt=json&limit=3 | Sian single 2016-11-07; Israeli psychedelic trance artist |
| M9 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22State%20of%20Mind%22%20AND%20artist:Antinomy&fmt=json&limit=2 | State of Mind single 2022-05-30; Set.37 2022-07-15 |
| M10 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Voyager%20AND%20artist:%22Bamboo%20Forest%22&fmt=json&limit=3 | Voyager on the album Bamboo Forest (2003-06), Revival (2005-07) |
| M11 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:%22Infected%20Mushroom%22&fmt=json&limit=2 | tags: psytrance 20, electronic 13, goa trance 7; begin 1996, IL |
| M12 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:Astrix%20AND%20country:IL&fmt=json&limit=2 | Astrix: "Israeli psytrance project of Avi Shmailov", tag psytrance 6 |
| M13 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:%22Vini%20Vici%22&fmt=json&limit=2 | Vini Vici: "Psytrance duo from Israel", begin 2013 |
| M14 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:%22Juno%20Reactor%22&fmt=json&limit=2 | Juno Reactor tags: goa trance 3, psytrance 1 |
| O1 | other | https://doubleblindmag.com/best-psytrance-songs/ | "24 of the Best Psytrance Songs" (DoubleBlind, 24 Jun 2024): one writer's list, no subgenre labels; weak |
| O2 | other | https://www.viberate.com/music-subgenres/psy-trance | analytics site's genre page: foundational artists and a year-by-year list of landmark albums and tracks; loose, weak |
| O3 | other | https://www.last.fm/tag/psytrance/wiki | Last.fm tag wiki: tempo 140-150 BPM, branches (melodic, full-on, dark, progressive, suomi, psybreaks, psybient); the full-on origin claim (1998 Hom-Mega compilation) was in a search summary of the Last.fm full-on tag page, not opened; weak |
| O4 | other | https://www.astateoftrance.com/out-now-on-armind-armin-van-buuren-vini-vici-feat-hilight-tribe-great-spirit/ | label announcement: Great Spirit out on Armind (no date, no genre named) |
| O5 | other | https://www.last.fm/music/Bamboo+Forest/+wiki | Bamboo Forest: Paris psytrance project started 1995, Yan Henaff joined 1998; user-written; weak |

### MusicBrainz readable pages

Built from ids in the JSON results above; not opened (the human pages showed a bot check). Use these in saved entries.

| Code | Page | What it is |
| --- | --- | --- |
| M6 | https://musicbrainz.org/recording/d6d36fbb-4a3f-4c09-ae0a-99beb9729ce0 | Deep Jungle Walk, first on He.art 2016-02-29 |
| M6 | https://musicbrainz.org/release/16c2ea8d-4cd1-4977-b00e-9bdfae3720f3 | He.art |
| M1 | https://musicbrainz.org/recording/e9d718e4-065c-4af3-9d02-77765779b371 | Pure Energy on Contact: Clubber Vol. 1 |
| M1 | https://musicbrainz.org/release/bd0317c0-06da-409e-96d3-5fb2c5cf8ab9 | Contact: Clubber Vol. 1, 2000-09-22 |
| M7 | https://musicbrainz.org/recording/7c389ca0-ba1f-47b7-970b-9fb9dafa6717 | Xplorer on the single Xplorer / Vekto, 2000-04 |
| M7 | https://musicbrainz.org/release/65776d57-4bdc-419d-91e1-16173cd6cf63 | Xplorer / Vekto |
| M4 | https://musicbrainz.org/recording/ed55165d-3024-48da-8387-d5febb75cea7 | The Tribe on Future Classics, 2015-04-13 |
| M4 | https://musicbrainz.org/release/91407f28-5f77-4f4d-860d-42ebd5192d7b | Future Classics |
| M5 | https://musicbrainz.org/recording/940119ca-ac60-4f45-843d-c940cd217b39 | Bust a Move on Classical Mushroom |
| M5 | https://musicbrainz.org/release/16c9e950-dadb-4d50-a1ad-54c630b243e3 | Classical Mushroom, 2000-02-01 (IL) |
| M3 | https://musicbrainz.org/release/eeb040df-aa3c-41f1-86b3-02aed2988471 | Tomorrowland 2017: Amicorum Spectaculum, 2017-07-20 (compilation with Great Spirit) |
| M3 | https://musicbrainz.org/recording/2940c2a2-0d52-4d01-85e4-00a7c525663c | Great Spirit (excerpt) in A State of Trance Year Mix 2016, 2016-12-16 |
| M2 | https://musicbrainz.org/recording/8bcbb667-dcac-4d9a-ba95-bafcbda8bbd8 | Psycho on The Gathering |
| M2 | https://musicbrainz.org/release/42663ee7-3c97-4e13-8e9f-62f93271d69d | The Gathering, 1999-03-01 (IL) |
| M2 | https://musicbrainz.org/release/d332e882-a1c5-4ec4-a7c3-6d9d705bee48 | Forest of the Saints, 1998 (compilation with Psycho) |
