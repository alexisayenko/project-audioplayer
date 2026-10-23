# Genre reference tracks: forest psytrance (verified review)

Verified review for [task-0093](../tasks/task-0093.md) / [ADR-0044](decisions.md), 2026-10-24, the genre `forest psytrance` (owner request 2026-10-24: subgenres of psytrance get their own reviews, decision EX). Read-only: nothing is saved to `genre_references.json`; the proposed picks below are for the owner to approve. Same method as [genre-references-psytrance](genre-references-psytrance.md) and [genre-references-goa-trance](genre-references-goa-trance.md).

Scope: `forest psytrance` is a level 3 child of `psytrance` (`genres_v2.json`, v1 name `forest psytrance`, synonym `forest psychedelic`). [genre-terminology](genre-terminology.md) makes Rate Your Music (RYM) the reference for subgenres and the tree grouping, not lineage, so the RYM description (owner-pasted; paraphrased here) fixes the sound: earthy, organic and complex, northern European, swarming effects and natural samples, tribal percussion, 140-160 BPM, plain repetitive melodies, few breakdowns, mostly minor. RYM, Discogs and AllMusic were not readable (403), so every year and role below is from other sources, and RYM's own claims (three trends, Derango's Tumult in 2005) are used as context only.

## Result

- Library: 0 songs tagged `forest psytrance`, 0 plausible forest songs. The nearest by name or tag (Bamboo Forest x3, the psytrance-tagged Israeli songs) are other styles; see [Library songs](#library-songs). No pick can be linked to a `song_id`.
- 6 proposed picks (2 archetype, 2 origin, 1 landmark, 1 breakthrough), all "not in library": 0 high, 4 medium, 2 low. Nothing is in `genre_references.json` for this genre.
- Update 2026-10-24 (leads from the Electronic Music Wiki on Fandom, see [Fandom wiki leads](#fandom-wiki-leads)): one new pick, Noctilus - Sick Loose Animals (archetype, 2016, medium). The other named artists gave no pick: Mark Day, Confo, Arjuna, Archaic (the wiki's "Archiac") and Jotunn are forest-adjacent by tags or forum posts but no single dated, forest-labelled song reached medium; Awwen and Baba Yaga were not found as forest artists. The earlier five picks are unchanged.
- Evidence base is thin: no Wikipedia page covers a forest artist or track (the Psychedelic trance page only names the style), and the genre is documented mostly by label pages, Psynews posts and MusicBrainz data. Roles are judgement.

## Method

- Library: owner `library.json` (506 songs) and `genre_references.json` from `origin/main` of the data repo, read-only via `git show`. Scanned by genre (anything with psytrance, psybient, goa, full-on, forest), by artist and title against a list of forest names (incl. all names from the Gemini leads and RYM-trend artists), by BPM 136-160 with electronic tags, and all 45 untagged songs.
- Existing references: `genre_references.json` holds goa trance 9, progressive house 6, progressive trance 7 and psytrance 4; no `forest psytrance` key, so nothing duplicates a saved entry.
- Eras: none exist for psytrance or forest; none invented, see [Periods](#periods-informal-no-era-ids).
- Verification: Wikipedia (opened), MusicBrainz ws/2 JSON (opened, one request at a time; 503 on parallel use), Last.fm artist and tag pages, Psynews.org review threads, SunTrip Records, a Bandcamp label page. Years are the first release found. A song counts as forest only when at least one source labels it so; MusicBrainz tags are user votes (count 1-2), Psynews reviews are fan-written.
- Confidence: high = identity, year and role backed by 3+ sources; medium = 2; low = one weak source or conflicting dates. No pick reaches high: no source states a role outright.
- Roles follow ADR-0044 (archetype, origin, landmark, breakthrough; cap 3 each); a pick is one song, album-level claims are flagged. A song takes one role in a genre (saving is unique per normalised artist and title).
- Gemini leads were treated as names to check; results are in [Leads not confirmed](#leads-not-confirmed).
- The Fandom wiki (F1) is a community wiki (CC-BY-SA) that itself cites RYM, Wikipedia, Psytrance Guide, Digital Tribe and Reddit; it is a corroborating source only, never the sole basis for a pick. Its leads were re-checked on MusicBrainz and Last.fm (and Psynews and Psymusic forum threads), see [Fandom wiki leads](#fandom-wiki-leads).
- Copyrighted text is not reproduced; notes are paraphrased.

## Library songs

Tagged `forest psytrance`: none.

Looked at (none is forest):

| Library id | Artist - Title | Year | Tags | Verdict |
| --- | --- | --- | --- | --- |
| `TiNx0-TshOg` | Bamboo Forest - Xplorer | 2000 | full-on psytrance | not forest. MusicBrainz: "psychedelic trance project" (no tags shown); Last.fm: Paris psytrance project from 1995, tags psytrance, goa, psychedelic trance, and the name refers to the Bamboo Forest at Anjuna, Goa (not to a style). No source says forest; 152 BPM and the tag fit full-on. Keep full-on |
| `Lud-4oFlEms` | Bamboo Forest - Breath | 2003 | full-on psytrance | same: not forest (147 BPM) |
| `xoeC2uFIefI` | Bamboo Forest - Voyager | 2003 | none | untagged, 147 BPM; same artist, not forest on any evidence; still untagged |
| `yoDs4TaPpxU`, `cPOnauzLnXk` | Astrix (and Domestic) - Pure Energy | 2000 / 2011 | psytrance | Israeli full-on, not forest |
| `n7cewNC40aE`, `2X1LOKSAnXI`, `82N3iOVoR54` | Astrix - Eye to Eye; Astrix & Atomic Pulse - Scientific Reality; Infected Mushroom - I Wish | 2002 / none / 2003 | psytrance | Israeli, not forest |
| `lIuEuJvKos4`, `6nfVqIqmpzA` | Astrix - Deep Jungle Walk; Vini Vici - The Tribe | 2016 / 2015 | psytrance | already saved under psytrance |
| `soundcloud-507698571` | Electro Fusion - Splash of Euphoria | 2024 | none | the only untagged fast electronic song (153 BPM); unverified, no forest evidence. The other 43 untagged songs are pop, rock, Russian-language and similar |

Counts: 0 forest songs, 3 Bamboo Forest songs examined (none forest), 0 matches to the forest artist list (Derango, Procs, Atriohm, Jahbo, Farebi Jalebi, Ka-Sol, Battle of the Future Buddhas, Tengri, Consectir, Parvati and Schlabbaduerst names).

## Picks

Source codes are in [Sources](#sources). All six are not in the library; each needs explicit artist, title and year in a saved entry.

| # | Pick | Role | Year | Sources | Conf. | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Derango - Deranged | landmark | 2005 | M1, M2, O1, O2, O6, O7 | medium | opening track of the album Tumult (Inpsyde Media IME 010, CD, MusicBrainz 2005-10-20, Psynews 20 Oct 2005; the label's Bandcamp says 1 Oct 2005); Last.fm calls Derango a psychedelic forest trance duo from Sweden and MusicBrainz tags the release `forest psytrance`; Psynews posters call Tumult the most-cited forest album and the benchmark. Landmark is album-level (Tumult); Deranged is the opener and the track one search summary of a Discogs review called best, not opened, so any Tumult track would do. BPM 147 (Psynews review) |
| 2 | Derango - The Poisonous Square | breakthrough | 2005 | M1, M2, O2, O6, O7 | medium | same album, track 6; the most praised track in the Psynews review thread. RYM (owner-pasted, context only) says the Derango album popularised the style in 2005; no source outside RYM says "breakthrough", and forest never reached a mainstream audience, so this means within the scene. The role is the album's, the track is the review favourite |
| 3 | Atriohm & Encephalopaticys - Close to Nowhere | archetype | 2009 | M3, M4, O3, O4, O8 | medium | opening track of the album Ukalen (Parvati Records PRVCD17, Denmark, 2009-04-10); MusicBrainz tags the release `forest`; Psynews posters recommend Ukalen; the track is Last.fm's top Atriohm track. Last.fm tags Atriohm darkpsy and dark psytrance, so the forest fit rests on the MusicBrainz tag and the Psynews recommendation; role "archetype" is judgement (about 7 minutes, melodic and bass-led, as RYM describes) |
| 4 | Noctilus - Sick Loose Animals | archetype | 2016 | M10, M11, O11, O12, F1 | medium | new, from the Fandom wiki lead. Track 1 (8:36) of the EP Forest Tales - Season One (Parvati Records PRVEP19, Denmark, MusicBrainz 2016-09-19). Last.fm tags the track darkpsy, psytrance, forest and dark psytrance (521 listeners, 1,479 plays) and the artist forest; MusicBrainz tags the label Parvati Records `forest psytrance` (label-level, 1 vote; the release and recording carry no forest tag); the Fandom wiki names it as its example track. Role "archetype" is judgement and rests on the wiki's choice of example: a typical modern forest track (8 minutes, natural-sound theme in the EP title), not a historic one. MusicBrainz gives Noctilus as Germany (Person, tags psytrance), so it is not a Scandinavian act, though the label is Danish. No Psynews or Psymusic thread names the track or the artist |
| 5 | Battle of the Future Buddhas - Battlebong | origin | 2000 | M5, M6, O5, O9, O10 | low | track 6 on the compilation Schlabbaduerst 001 (Schlab 001, Sweden, 2000; Psynews thread dated 5 Jun 2000). The label is run by the Buddhas (Uppsala) and RYM ties its early forest strand to it. In 2000 the compilation was reviewed as dark psychedelic trance at 135-140 BPM with industrial textures, not as forest, so the forest label is retroactive. Earlier Buddhas releases exist (Domestic Bliss / Brainscar 1997, Twin Sharkfins 1998, BooM! Records; MusicBrainz tags Twin Sharkfins goa trance and psytrance), but no source calls them forest |
| 6 | Ka-Sol - Waspnest | origin | 2000 | M5, M7, O5, O9, O10 | low | track 4 on Schlabbaduerst 001; the Psynews reviewer named it a favourite; MusicBrainz tags the artist `forest psytrance` (1 vote); Psynews posters call Ka-Sol and the Buddhas the early forest names. The MusicBrainz tracklist leaves the artist credit blank, so Ka-Sol comes from Psynews. Year is the compilation's; Ka-Sol's own dated discography starts with Fairytale (2006-05-12, Suntrip Records SUNCD05) |

Coverage by role: archetype 2 (#3, #4), origin 2 (#5, #6), landmark 1 (#1), breakthrough 1 (#2). Cap 3 per role is not reached; no second landmark reached the evidence bar. Ranking change: Noctilus slots in at #4 as the second archetype (medium, above the two low-confidence origin picks); the order of the earlier picks is unchanged and the old #4 and #5 became #5 and #6.

Considered and not picked:

- Mark Day - Us Until The End (2015, low, from the Fandom artist list): track 9 of the compilation The Dark Side of Dawn (Blue Hour Sounds BHSCD013, Italy, CD, 2015-09-23); MusicBrainz tags the compilation `forest psytrance` (1 vote, with dark psytrance), a 2017 Psynews poster calls the track "kind of experimental forest" and the later standout of a forest thread, Last.fm tags it darkpsy and dark psytrance only (95 listeners). Hedged wording, a compilation, one hedged post: a reserve candidate, not a pick (the post also mentions "the album", which was not identified).
- Arjuna & Confo - Analog Sleep (2018, low): Point Nemo compilation (Parvati Records PRVDA04, Denmark, 2018-12-30); played in a 2019 forest party mix (Psymusic) and Arjuna is recommended in a 2016 Psymusic forest thread, but Last.fm does not tag Arjuna forest and no source labels the track forest. Not a pick.
- Confo - Forest Syndrom (Last.fm's top Confo track, 790 listeners, tags darkpsy, psychedelic, psytrance, forest): the title and tag fit, but no release, label or year was found (not in MusicBrainz; Last.fm shows no album), so it cannot carry a year. Confo's dated release is No Intro (Parvati, 2015-02-11, tags dark psytrance).

- Ka-Sol - Fairytale (album, 2006, Suntrip Records SUNCD05, BE per MusicBrainz): no forest label found in an opened source (its track 1 is tagged goa trance and psytrance on MusicBrainz); one search summary says RYM ranks it second, unverified here. No track pick.
- Battle of the Future Buddhas - Urban Legends (2013, Schlabbaduerst): the Psynews post tags it forest among others, but a commenter says it is far from their muddy forest sound; late and mixed, not a reference.
- Procs, Jahbo, Farebi Jalebi: artists are forest-adjacent by tags (Procs forest psytrance on MusicBrainz and forestpsy on Last.fm; Jahbo "forest dark" on Last.fm; Farebi Jalebi darkpsy only), but no single song was backed by a dated release and a forest label.
- Psykovsky - Na Ve Ka, Ekoplex - Creatures of the Forest, Kiriyama - Reach Escape Velocity, Attoya - Wooden Beats, Khooman - The Depths: named in a Psynews thread or in search summaries of RYM lists; year and label not confirmed, so unverified.
- Shaman - Foretaste (2004): Psynews posters disagree whether it is forest or progressive; not checked further.
- Hallucinogenic Horses, Puro Surpo, Fragletrollet - Playground of Spirit (2009, on a Last.fm tag list): only name checks.

### Leads not confirmed

The Gemini suggestions, checked once each:

| Lead | Result |
| --- | --- |
| Derango (Tumult, 2005) | confirmed (#1, #2); "Derangstranged" not found as a recording title in MusicBrainz; the real track titles are in Tumult's list |
| Procs 'Bzzz...' 2004, 'Touch The Snail' 2007 | not found in 40 of 61 MusicBrainz recordings or by a web search; Procs is a Stockholm artist (Mikael Stegman), first Sanaton track 2005; unverified |
| Farebi Jalebi 'Who's Driving', 'Puzzled' | not found; Last.fm lists other titles and tags the artist darkpsy; contradicted |
| Atriohm 'Beyond the Secret', 'Close to the Wind' | not found; the real Ukalen opener is "Close to Nowhere"; contradicted |
| Atriohm & Encephalopaticys 'Kukulkan' 2009 | contradicted: the 2009 release is Ukalen; 15 "Kukulkan" recordings in MusicBrainz are by unrelated artists |
| Jahbo 'Secret Society' | no MusicBrainz result; unverified |
| Consectir/Tengri 'Old Soul' | not found (Tengri is a Macedonian act linked to Atriohm; a Tengri & Atriohm release, Ukalen Revisited, 2015-10-26, Parvati PRVEP14, is in MusicBrainz); unverified |
| Battle of the Future Buddhas, Ka-Sol, Schlabbaduerst | confirmed as the early Uppsala scene (#5, #6) |

### Fandom wiki leads

The Electronic Music Wiki page on forest (F1, opened 2026-10-24 in the browser pane) gives: a late-1990s Scandinavian origin, 140-160 BPM, forest and natural sounds over a dark psy mood, tribal percussion, laser-like high kicks, funky but light basslines, related styles Progressive Forest and Swamp, ten notable artists and one example track. It is community-written and cites RYM, Wikipedia, Psytrance Guide, Digital Tribe and Reddit, so it only corroborates; each lead was checked elsewhere. Status: verified (usable pick), partly verified (artist forest-adjacent, no pick), unverified, not found.

| Lead | Status | Result |
| --- | --- | --- |
| Noctilus - Sick Loose Animals | verified, medium (#4) | exists: EP Forest Tales - Season One, Parvati Records PRVEP19, Denmark, 2016-09-19, track 1; Last.fm tags the track and artist forest; MusicBrainz tags the label forest psytrance; artist from Germany per MusicBrainz. See pick #4 |
| Mark Day | partly verified, low | psytrance artist; forest label only through one MusicBrainz compilation tag and one hedged 2017 Psynews post (O13), plus the Psymusic note that he co-produced forest psy (O14); candidate Us Until The End (2015, Blue Hour Sounds compilation), not picked. Last.fm tags him darkpsy, dark psytrance, full on |
| Confo | partly verified, low | Greek (MusicBrainz), Parvati Records artist; Last.fm tags forest on the artist and on Forest Syndrom (and lists him on its forest tag artist page), but no dated release for Forest Syndrom was found; No Intro (2015) is the dated release, tagged dark psytrance |
| Arjuna | partly verified, low | Italian Parvati producer (Last.fm bio); recommended in Psymusic forest threads (O14, O15) and named in a microgenre article as a forest example (O16); Last.fm tags darkpsy, psytrance, hardcore, not forest. Analog Sleep (with Confo, 2018) found but not forest-labelled; unverified as a pick |
| Archiac (the wiki's spelling) | partly verified, low | most likely Archaic, Greek (Kostas Kanlis), MusicBrainz tag forest psytrance (1 vote), on Last.fm's forest psytrance artist page; ten-plus releases (Sonic Driving 2011, Mountain Powers 2018, Medicine Bag 2018, both Denmark) but no canonical track named; the spelling "Archiac" was not found as an artist |
| Jotunn | unverified | Jötunn is on Last.fm's forest psytrance artist page and tagged forest psytrance, but the Last.fm page mixes in an unrelated Russian-language account; MusicBrainz has a UK "psychedelic trance project" with one 2023 release tagged dub techno; a Psymusic poster praised a "new track" in 2016 without a title. No track |
| Awwen | not found as forest | Galician psytrance artist (MusicBrainz, no forest tag); Last.fm tags darkpsy, spain; Magic Potions (2014), Organic Modulation (2016); no forest label in any source |
| Baba Yaga | not found | no psytrance artist of this name in MusicBrainz or Last.fm (the Last.fm page is for unrelated acts); a web search found only a Mixcloud mix and a Bandcamp account page, not identified as the wiki's artist |
| "Deranfo" | resolved | a typo of Derango (#1, #2) |
| Progressive Forest, Swamp | no pick | styles named by the wiki; no song found for either (swamp matches RYM's third trend) |

## Periods (informal, no era ids)

Only as a note; no era ids exist and none are proposed. RYM (owner-pasted) names three trends; dates found:

1. Late 1990s experimental, chaotic strand, tied to Schlabbaduerst: Buddhas formed 1994 with releases from 1997 (MusicBrainz), Twin Sharkfins 1998; the label planned in 1999 and sold CDs from 2000 (Schlab 001 and 002, about 50 and 30 copies sold per the 2000 interview); its sound then was called dark psychedelic trance.
2. 2005 onward, nearer dark psytrance, effects over melody: Tumult (Oct 2005); in the 2010 Psynews thread posters call 2005 a possible origin of the word "forest" and treat Tumult as the benchmark.
3. Swamp psytrance (slower, rarely over 135 BPM): no pick; no swamp song was verified.

The Parvati Records line (Ukalen 2009, Parvatrip compilations 2010-2012, Derango on Parvatrip) shows the Danish label as a forest hub by 2009-2012.

## Open points

1. RYM checks (not readable here): the top-albums list of the Forest Psytrance page (search summaries gave Tumult first, Ka-Sol Fairytale second, Ukalen fourth, Psykovsky Na Ve Ka and Ekoplex Creatures of the Forest in the top five; unconfirmed), the three trend descriptions' example releases, the RYM page for Schlabbaduerst ReKkords, and whether RYM lists Twin Sharkfins (1998) or Fairytale (2006) as forest.
2. Origin: pick Battlebong and Waspnest (2000, retroactive forest) or hold the role empty until the owner decides what counts as the first forest song (1998 Twin Sharkfins tracks are earlier but tagged goa).
3. Roles and breakthrough: Tumult carries two roles (landmark and breakthrough) and Ukalen one; forest has no mainstream breakthrough, so the role means the album that spread the style in the scene. Accept, or leave breakthrough empty.
4. Track choice inside albums: any of Tumult's nine tracks would carry the album-level claim; Deranged and The Poisonous Square are the opener and the review favourite. Album-level picks can be listened to and swapped by the owner.
5. BPM tension: RYM and the Tumult tracks give 145-150 BPM; the Last.fm forest tag wiki (user-written) says 160-220 and calls forest an offshoot of dark psytrance; the 2000 Schlabbaduerst compilation was 135-140. Treat Last.fm's range as wrong; the Fandom wiki also gives 140-160 BPM, matching RYM.
6. Tumult year: 2005 holds; the exact date differs (1 Oct Bandcamp, 20 Oct MusicBrainz and Psynews); the saved entry should carry year 2005 only.
7. Library: no forest song. If the owner wants the library to hold some, Tumult tracks or Ukalen are the first candidates to add; Bamboo Forest stays full-on.
8. Fandom wiki versus RYM and our tree: the wiki agrees with RYM on tempo (140-160 BPM), the nature-sound and tribal-percussion description and a Scandinavian late-1990s origin (the Schlabbaduerst scene, #5 and #6). It differs on grouping: it calls forest a sub-genre of dark psy closer to night full-on (stylistic origins dark psychedelic trance, goa trance, night full-on), whereas the tree (following RYM) makes `forest psytrance` a child of `psytrance`, and the Last.fm tag wiki and Psynews posters also call it a dark-psy offshoot. No data change made; the owner decides whether anything should move (a dark psytrance parent, or a second parent) or whether the tree stays RYM-based per [genre-terminology](genre-terminology.md). Its "Scandinavia" label is also loose: the new Noctilus pick is German and several Parvati artists are Greek or Italian, so the modern scene is not only Scandinavian.
9. Noctilus archetype: the role rests on the wiki's example track plus Last.fm and a label-level MusicBrainz tag. Accept it as the second archetype, swap it for a listened-to track from the Parvati line, or drop it. Mark Day - Us Until The End is the reserve if a second modern pick is wanted.
10. Saving would use the MusicBrainz readable pages below; the human pages show a bot check to the fetch tool, so the ids come from the JSON lookups (open one page in a browser before saving).

## Sources

All opened on 2026-10-24 (MusicBrainz via ws/2 JSON, which is what was read). Type is the API source type. M = MusicBrainz, O = other.

| Code | Type | URL | What it gave |
| --- | --- | --- | --- |
| W1 | wikipedia | https://en.wikipedia.org/wiki/Psychedelic_trance | forest is only a name in the subgenre list; dark psytrance history (Xenomorph, X-Dream 1998); no forest page, definition or tracks |
| M1 | musicbrainz | https://musicbrainz.org/ws/2/release/0513ef85-0623-4cb4-8772-6bed4b202401?inc=labels+recordings+artist-credits+tags+release-groups&fmt=json | Tumult: 2005-10-20, IT, Inpsyde Media IME 010, CD digipak, 9 tracks, tags include forest and forest psytrance; track and recording ids |
| M2 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:Derango&fmt=json&limit=5 | Derango: Swedish psychedelic trance duo (Jens and Ola Eriksson), tags psytrance 2, dark psytrance 2, forest psytrance 2; recordings query https://musicbrainz.org/ws/2/recording?query=artist:Derango&fmt=json&limit=40 |
| M3 | musicbrainz | https://musicbrainz.org/ws/2/release?query=release:Ukalen&fmt=json&limit=10 | Ukalen: Atriohm & Encephalopaticys, 2009-04-10, DK, Parvati Records PRVCD17, 9 tracks, tag forest; Ukalen Revisited 2015 |
| M4 | musicbrainz | https://musicbrainz.org/ws/2/release/90f92722-e7f3-4d82-ad54-809f1f9843f0?inc=recordings+tags+release-groups&fmt=json | Ukalen tracklist (Close to Nowhere first, 7:15), recording ids |
| M5 | musicbrainz | https://musicbrainz.org/ws/2/release/65b76e98-aedb-4c94-bb69-44d44c100a41?inc=labels+recordings+tags&fmt=json | Schlabbaduerst 001: 2000, SE, Schlab 001, CD-R, 9 tracks incl. Waspnest and Battlebong |
| M6 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:Battlebong&fmt=json&limit=5 | Battlebong: Battle of the Future Buddhas, only on Schlabbaduerst 001 (2000); artist query https://musicbrainz.org/ws/2/artist?query=artist:%22Battle%20of%20the%20Future%20Buddhas%22&fmt=json&limit=5 (psychedelic trance group from Sweden); releases https://musicbrainz.org/ws/2/release?artist=09da28f2-9bcb-4f6c-b9d9-fda5f6b4ffeb&fmt=json&limit=100 (1997 to 2024); Twin Sharkfins https://musicbrainz.org/ws/2/release/6945d139-3fcf-4eca-957f-7fcc77adf67a?inc=labels+recordings+tags+release-groups&fmt=json (1998, BooM! Records BOOM CD 003, tags goa trance and psytrance) |
| M7 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:Ka-Sol&fmt=json&limit=5 | Ka-Sol: Swedish psychedelic trance artist, tags include forest psytrance 1; releases https://musicbrainz.org/ws/2/release?artist=f7dc12b6-6faa-461f-b5ca-621485c0f1ae&fmt=json&limit=100 (Fairytale 2006-05-12 to Ex-hume 2012); Fairytale https://musicbrainz.org/ws/2/release/55b76f65-a168-4dc2-850a-ce7c4dd318d5?inc=labels+recordings+tags&fmt=json (Suntrip SUNCD05) |
| M8 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:Procs&fmt=json&limit=5 | Procs: Mikael Stegman, Sweden, tag forest psytrance 1; recordings https://musicbrainz.org/ws/2/recording?query=artist:Procs&fmt=json&limit=40 (no Bzzz or Touch the Snail in the first 40 of 61); Jahbo and Kukulkan queries returned nothing relevant |
| M9 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:%22Bamboo%20Forest%22&fmt=json&limit=3 | Bamboo Forest: "psychedelic trance project", ES; no tags shown |
| O1 | other | https://www.last.fm/music/Derango/+wiki | Derango bio: twisted psychedelic forest trance duo, active since 2003, one album TuMuLT |
| O2 | other | https://www.psynews.org/forums/topic/29058-derango-%E2%80%93-tumult/ | Tumult review thread: 20 Oct 2005, Inpsyde Media IME 010, forest theme, track BPMs 145-150, The Poisonous Square the favourite |
| O3 | other | https://www.psynews.org/forums/topic/66369-forest-psy/ | 2013-14 thread: forest as a darkpsy offshoot or its own stream; names Derango, Atriohm and Encephalopaticys, Ka-Sol, BOTFB; Tumult the most-cited album, Ukalen recommended; Parvati Records named |
| O4 | other | https://www.last.fm/music/Atriohm | Atriohm: Macedonian brothers Leonid and Aleksandar Golcev, formed 2003; tags darkpsy, psytrance; Close to Nowhere a top track |
| O5 | other | https://www.psymusic.co.uk/forum/threads/forest-psy-why.60915/ | 2010 forum: origin of the word uncertain (2005, Derango, or Finnish scene); Ka-Sol and BOTFB as early forest names; Schlabbaduerst Rekkords; a 1998 and a 2003 release called dark psy at the time |
| O6 | other | https://inpsyde-media.bandcamp.com/album/tumult-derango-inpsyde-media | label page for Tumult: 1 Oct 2005, "twisted psychedelic forest trance", 9 tracks |
| O7 | other | https://www.last.fm/music/Derango | tags darkpsy, psytrance; top tracks include Confusion Is Next and Deranged; Atriohm and Jahbo as similar artists |
| O8 | other | https://www.last.fm/tag/forest+psytrance/wiki | tag wiki (user-written): forest as an offshoot of dark psytrance, natural sounds; gives 160-220 BPM (conflicts with RYM) |
| O9 | other | https://www.psynews.org/forums/topic/35612-va-schlabbaduerst-rekkords-1/ | Schlabbaduerst 1 (2000): tracklist, reviewed as dark psychedelic trance, 135-140 BPM, industrial; favourites Waspnest and Battlebong |
| O10 | other | https://www.psynews.org/forums/topic/37622-label-schlabbaduerst/ | 2000 label interview: Uppsala, planned 1999, dark psychedelic trance with morning music, artists Buddhas, Ka-Sol, Marchaos |
| F1 | other | https://electronicmusic.fandom.com/wiki/Forest | Fandom wiki (community, CC-BY-SA; corroborating only): late-1990s Scandinavian origin, 140-160 BPM, nature sounds, tribal percussion, ten notable artists, example track Noctilus - Sick Loose Animals |
| M10 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Sick%20Loose%20Animals%22&fmt=json&limit=5 | one recording, Noctilus, 8:36, first release 2016-09-19 on Forest Tales - Season One (EP, DK) |
| M11 | musicbrainz | https://musicbrainz.org/ws/2/release/cd5d38ad-ad51-4875-8e1e-56c75715c80d?inc=labels+recordings+tags+release-groups+artist-credits&fmt=json | EP tracklist (Sick Loose Animals, The Fountain, Noctali with Mubali), Parvati Records PRVEP19, label tags include forest, forest psytrance, forestpsy; artist https://musicbrainz.org/ws/2/artist/721226ca-86e2-418a-a95a-f0477317d5ad?inc=tags+genres&fmt=json (Germany, Person, tags psychedelic trance) |
| M12 | musicbrainz | https://musicbrainz.org/ws/2/release/c1f20b6c-9454-433d-a3f6-4adb086dea66?inc=labels+tags+artist-credits&fmt=json | The Dark Side of Dawn (Various Artists, Blue Hour Sounds BHSCD013, Italy, CD, 2015-09-23), tags include forest psytrance; Mark Day recording via https://musicbrainz.org/ws/2/recording?query=recording:%22Us%20Until%20the%20End%22%20AND%20artist:%22Mark%20Day%22&fmt=json&limit=5 |
| M13 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:Confo&fmt=json&limit=5 | Confo: Greece, Psy-Trance; releases query https://musicbrainz.org/ws/2/release?query=artist:Confo&fmt=json&limit=30 (No Intro, Parvati PRVDG10, 2015-02-11, tag dark psytrance); no Forest Syndrom recording |
| M14 | musicbrainz | https://musicbrainz.org/ws/2/recording?query=recording:%22Analog%20Sleep%22&fmt=json&limit=5 | Arjuna & Confo - Analog Sleep, Point Nemo compilation (Parvati PRVDA04, DK, 2018-12-30; https://musicbrainz.org/ws/2/release/dc3b7258-eb96-4fd5-b3f3-282d1a9f8b62?inc=labels+tags&fmt=json) |
| M15 | musicbrainz | https://musicbrainz.org/ws/2/artist?query=artist:Archiac%20OR%20artist:Archaic%20AND%20tag:psytrance&fmt=json&limit=6 | Archaic: Greece, tag forest psytrance 1; releases https://musicbrainz.org/ws/2/release?artist=c9c61d61-7903-4829-86cb-4294781455a1&fmt=json&limit=50. Also Jötunn https://musicbrainz.org/ws/2/artist?query=artist:Jotunn%20OR%20artist:J%C3%B6tunn&fmt=json&limit=8, Awwen https://musicbrainz.org/ws/2/artist?query=artist:Awwen&fmt=json&limit=5 (Galicia, no forest tag), Baba Yaga psytrance searches (no result) |
| O11 | other | https://www.last.fm/music/Noctilus/_/Sick+Loose+Animals | track page: tags darkpsy, psytrance, forest, dark psytrance; 521 listeners, 1,479 scrobbles; on Forest Tales (Season One) |
| O12 | other | https://www.last.fm/music/Noctilus | artist tags darkpsy, psytrance, forest, dark psytrance, psychedelic; no bio |
| O13 | other | https://www.psynews.org/forums/topic/72938-your-favourite-forest-tracks/ | January 2017 thread: Mark Day "Us until the end" called kind of experimental forest and a standout; Derango Poisonous Square, BOTFB and Ka-Sol named; Noctilus, Confo, Arjuna not named |
| O14 | other | https://www.psymusic.co.uk/forum/threads/good-forest-psytrance.75748/ | 2016-2018 thread: Parvati, Derango, Atriohm, Arjuna, Mark Day, Jotunn (new track, no title), Farebi Jalebi and others recommended; Noctilus, Confo, Baba Yaga, Awwen, Archaic not named |
| O15 | other | https://www.psymusic.co.uk/forum/tags/forest-psytrance/ | forest threads list: Arjuna & Confo - Analog Sleep (Parvati) in a 2019 forest party mix; none of the other fandom artists |
| O16 | other | https://microgenremusic.com/genres/trance/what-is-forest-psytrance/ | explainer: cites Derango Tumult (2005) as a template for newcomers, Atriohm, Farebi Jalebi, Arjuna as forest examples; no track titles; Parvati Records named as a hub |
| O17 | other | https://www.last.fm/music/Confo | tags darkpsy, psychedelic, psytrance, forest; top track Forest Syndrom (track page https://www.last.fm/music/Confo/_/Forest+Syndrom, 790 listeners, tags incl. forest, no album); No Intro (2015) |
| O18 | other | https://www.last.fm/tag/forest+psytrance/artists | Last.fm forest psytrance artists, page 1: Archaic, Atriohm, Procs, Derango, Encephalopaticys, Jötunn and others; not Noctilus, Mark Day, Confo, Arjuna, Awwen |

Also opened, no pick-level use: https://www.suntriprecords.com/member/battle-of-the-future-buddhas/ (Buddhas bio: formed 1994, Twin Sharkfins BooM! 1998 their best-known album, played Goa and forest parties), https://www.psynews.org/forums/topic/67188-battle-of-the-future-buddhas-urban-legends-2013-schlabbaduerst-rekkords/ (Urban Legends 2013, tags incl. forest), https://www.last.fm/tag/forest+psytrance/albums (user list of 14 albums, 2008-2022, not ranked), and the Last.fm pages of Ka-Sol, Procs, Jahbo, Farebi Jalebi, Battle of the Future Buddhas (wiki) and Bamboo Forest. Not readable: rateyourmusic.com (403), a LiveJournal Tumult review (connection closed), the Treetrolla Bandcamp page (redirect not followed). Discogs and AllMusic were not tried (403 in earlier research).

### MusicBrainz readable pages

Built from the ids in the JSON results; the human pages show a bot check to the fetch tool (one tried: recording `90358246-...`), so they were not read. Use these in saved entries.

| Pick | Page | What it is |
| --- | --- | --- |
| #1 | https://musicbrainz.org/recording/8e9c6198-eda4-4786-b12a-02113d0855d1 | Deranged on Tumult |
| #1, #2 | https://musicbrainz.org/release/0513ef85-0623-4cb4-8772-6bed4b202401 | Tumult, 2005-10-20 |
| #2 | https://musicbrainz.org/recording/90358246-eb70-4952-a5aa-13816eb36534 | The Poisonous Square on Tumult |
| #3 | https://musicbrainz.org/recording/d62cc587-fb40-4715-b45a-d39013e1532a | Close to Nowhere on Ukalen |
| #3 | https://musicbrainz.org/release/90f92722-e7f3-4d82-ad54-809f1f9843f0 | Ukalen, 2009-04-10 |
| #4 | https://musicbrainz.org/recording/5b70abe6-922f-4230-911e-5812991a4a7b | Sick Loose Animals on Forest Tales - Season One |
| #4 | https://musicbrainz.org/release/cd5d38ad-ad51-4875-8e1e-56c75715c80d | Forest Tales - Season One (EP, Parvati Records PRVEP19), 2016-09-19 |
| #4 | https://musicbrainz.org/artist/721226ca-86e2-418a-a95a-f0477317d5ad | Noctilus |
| #5 | https://musicbrainz.org/recording/6187579b-bf8d-4e94-809f-77a2d2d42325 | Battlebong on Schlabbaduerst 001 |
| #5, #6 | https://musicbrainz.org/release/65b76e98-aedb-4c94-bb69-44d44c100a41 | Schlabbaduerst 001, 2000 |
| #6 | https://musicbrainz.org/recording/88c86917-5452-4eb8-8f12-ee1412144fe5 | Waspnest on Schlabbaduerst 001 |
| reserve | https://musicbrainz.org/recording/a1dbf2d5-4bb7-4d67-a469-8fbcb879a490 | Mark Day - Us Until The End on The Dark Side of Dawn (release https://musicbrainz.org/release/c1f20b6c-9454-433d-a3f6-4adb086dea66, artist https://musicbrainz.org/artist/32df0fea-03bd-4378-920f-96c8c3bb8185) |
