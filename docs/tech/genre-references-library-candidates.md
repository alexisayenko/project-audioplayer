# Genre reference tracks: candidates from the owner library

Read-only proposal for [task-0093](../tasks/task-0093.md) / [ADR-0044](decisions.md), built from the owner library, not from the catalogue. Nothing here is saved in `genre_references.json`; the owner picks rows and Claude saves them (see [How to adopt](#how-to-adopt)). Companion of [genre-references-wave1](genre-references-wave1.md).

Superseded for goa trance: the goa trance rows below are replaced by the verified review [genre-references-goa-trance](genre-references-goa-trance.md).

## Method and counts

- Source: the owner `library.json` as synced to the data repo on 2026-10-23, plus `genre_references.json` (what is saved already) and `server/data/genre_levels.json` (which names are genres).
- Songs were grouped by genre tag. For each genre with songs, at most 3 candidates were picked from music knowledge only (no web lookup): the typical sound for `archetype`, early records for `origin`, widely cited releases for `landmark`, mass-audience hits for `breakthrough`.
- Facts are from memory and can be wrong. Every year, role and genre label marked low confidence or "to verify" must be checked on Discogs/MusicBrainz/Wikipedia before saving; no sources are listed on purpose (the API wants at least two independent ones, or the owner's ear).
- Counts: 497 songs scanned (452 carry genre tags, 45 have none and cannot be grouped); 161 distinct genre tags; 62 genres with candidates; 91 candidate rows (85 distinct tracks, a few serve two genres); 99 tags without a candidate (91 gaps, 7 umbrella, 1 group).
- Confidence: 18 high, 42 medium, 31 low.
- Marks in the tables: `*` after the genre = the library song is not tagged with this genre today (it is suggested from other tags or knowledge; retagging is a separate decision); `+` after the genre = the genre already has saved reference entries (goa trance 1, progressive house 6, progressive trance 7), so these rows would be additions.
- Library ids are the current `song_id` of the best-matching copy. Many library songs are remixes, covers or duplicate uploads; a note names the other copies when it matters. Library years are often a re-release year, so the Year column is the original year as remembered, with a note where the library differs.
- Not covered: `edm` is a group (never gets references); the umbrella tags pop, rock, blues, hip hop, reggae, jazz and classical have no fitting song, and their references belong to the subgenres.

## Candidates

### Trance & psytrance

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| dream trance* | archetype | Robert Miles - Children | 1995 | `DvyCbevQbtI` | the typical piano-led dream trance track (library tags it ambient house/trance, not dream trance) | medium |
| euro trance | archetype | Alice Deejay - Better Off Alone | 1999 | `Lgs9QUtWc3M` | Dutch trance-pop hit; the euro trance sound | medium |
| goa trance+ | archetype | Astral Projection - Mahadeva | 1996 | `onquKz5SYRs` | golden-era Israeli goa; also in the wave 1 working document; library year 1995, to verify | medium |
| goa trance+ | landmark | Hallucinogen - Dark Magus | 1995 | `Tf2bdHM1oTg` | from the 'Twisted' album, a key goa release; track and year to verify | medium |
| goa trance+ | landmark | Man With No Name - Teleport | 1996 | `efc7WLCVWmw` | named in the wave 1 golden-era list; year to verify | low |
| psybient | archetype | Solar Fields - Insum | 2005 | `njYw6U8SfFo` | Solar Fields is a core psybient act; track and year to verify | low |
| psytrance | archetype | Astrix & Domestic - Pure Energy | 2000 | `yoDs4TaPpxU` | Israeli full-on era; weak evidence, to verify | low |
| trance | landmark | Paul van Dyk - For an Angel | 1998 | `evPhEkujDxw` | named etalon in genre-terminology; library copy is tagged 2002 (check it is the 1998 version) | high |
| trance | breakthrough | Robert Miles - Children | 1995 | `DvyCbevQbtI` | pan-European chart hit that took dream-style trance mainstream; other versions: CC5ca6Hsb2Q, H2Nud59eHDE | high |
| uplifting trance | archetype | Armin van Buuren feat. Sharon den Adel - In and Out of Love | 2008 | `krHqVGz_o18` | big-room uplifting/vocal trance anthem | medium |
| uplifting trance* | landmark | Gouryella - Gouryella | 1999 | `TrRXCV7qhBU` | Corsten/Tiesto anthem that set the uplifting formula; library year 1998, to verify; saved as progressive trance archetype | medium |
| vocal trance | archetype | Andain - Beautiful Things | 2003 | `7RH0RVt6Rm0` | typical female-vocal trance anthem; library copy is a remix | medium |
| vocal trance* | landmark | Delerium feat. Sarah McLachlan - Silence | 1999 | `_kiTWnmrXPQ` | defining vocal trance crossover; library copy is a remix (Tiesto remix 2000 to verify); progressive trance archetype already saved | high |
| vocal trance | breakthrough | ATB - 9 PM (Till I Come) | 1998 | `QFGMQZyvnmY` | first big vocal-trance hit, charted widely in 1999 | high |

### House & EDM

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| deep house | archetype | RUFUS DU SOL - Innerbloom | 2015 | `Tx9zMFodNtA` | modern melodic deep/progressive house; no classic deep house in the library | low |
| electro house | landmark | Mason - Exceeder | 2006 | `NuCHg_yfOhk` | widely played electro house track; vocal versions with Princess Superstar (Perfect (Exceeder)): JeyLI3xgQok, cXTgrHruvoo, B-quoRs7CE4 | medium |
| euro house | archetype | Snap! - Rhythm Is a Dancer | 1992 | `JYIaWeVL1JM` | pop-house with rap break, the euro house template | medium |
| french house* | landmark | Daft Punk - Around the World | 1997 | `K0HSD_i2DvA` | defining filtered-disco French house single | high |
| french house | breakthrough | Daft Punk - One More Time | 2000 | `FGBhQbmPwH8` | brought French house to a mass audience | high |
| hip house | archetype | C+C Music Factory - Gonna Make You Sweat (Everybody Dance Now) | 1990 | `LaTGrV58wec` | house/rap pop hit; label to verify | low |
| hip house | landmark | Technotronic feat. MC Eric - Pump Up the Jam | 1989 | `9EcjWd-O4jI` | house plus rap hit; library year 1990, genre label to verify | medium |
| new beat | landmark | Technotronic feat. MC Eric - Pump Up the Jam | 1989 | `9EcjWd-O4jI` | Belgian hit with new beat roots; very uncertain label, to verify | low |
| nu-disco | breakthrough | Daft Punk feat. Pharrell Williams - Get Lucky | 2013 | `5NV6Rdv1a3I` | mass-audience disco-funk revival; genre label (nu-disco vs disco-funk) to verify; extended cut: 0QVOc1aagSE | medium |
| progressive house+ | landmark | Nadia Ali, Starkillers & Alex Kenji - Pressure | 2010 | `SU88c0f5-h0` | club/radio progressive house hit; library copy is a 2011 remix; year to verify | low |
| progressive house+ | breakthrough | Avicii - Levels | 2011 | `wDuoOapZ9Z0` | brought festival progressive house to a wide audience; duplicate file: _ovdm2yX4MA; genre already has 6 saved | medium |
| techno | landmark | Underworld - Cowgirl | 1993 | `feWNvGpWHLM` | techno/progressive house landmark from 'dubnobasswithmyheadman'; year to verify | low |
| techno | landmark | Orbital - Halcyon | 1992 | `bV-hSgL1R74` | UK ambient/acid techno landmark; library has 1993 and 2025 copies (AqI3fCYshBQ), year to verify | low |
| tropical house | archetype | Lost Frequencies - Are You With Me | 2014 | `VjHMDlAPMUw` | typical soft, plucked tropical/deep sound; library version to verify | medium |
| tropical house | breakthrough | Kygo - Firestone | 2014 | `9Sc-ir2UwGU` | Kygo's first big hit, the face of the genre; library tags it edm and tropical house | medium |

### Disco, Hi-NRG & Eurodance

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| dance pop | archetype | Madonna - Hung Up | 2005 | `e99M6-7KW0k` | ABBA-sampling dance pop worldwide hit | medium |
| disco | archetype | ABBA - Gimme! Gimme! Gimme! (A Man After Midnight) | 1979 | `XEjLoHdbVeE` | four-on-the-floor disco pop; weaker fit than a pure disco record | medium |
| disco | landmark | Donna Summer - I Feel Love | 1977 | `yEbaeLv-aOo` | Moroder's all-synthesizer disco track, hugely influential | high |
| euro disco | archetype | Boney M. - Sunny | 1976 | `S-u6qdeaPoE` | Boney M. is the euro disco act; library year 1974 is wrong or another version; it is a cover | low |
| euro disco | origin | Donna Summer - I Feel Love | 1977 | `yEbaeLv-aOo` | Munich/Moroder sound that started euro disco | high |
| eurodance | archetype | Haddaway - What Is Love | 1993 | `HEXWRTEbj1I` | the typical eurodance track; other version: cb6WpqqN1ww (2002 remix) | high |
| eurodance | landmark | Snap! - Rhythm Is a Dancer | 1992 | `JYIaWeVL1JM` | early pan-European eurodance hit | high |
| eurodance | breakthrough | 2 Unlimited - No Limit | 1993 | `r6FVk2k4qsM` | huge 1993 hit that defined mass-market eurodance | high |
| europop | archetype | Ace of Base - All That She Wants | 1992 | `d73tiBBzvFM` | Swedish europop hit; library tags it reggae-pop | medium |
| hi-nrg | archetype | Taylor Dayne - Tell It to My Heart | 1987 | `Ud6sU3AclT4` | fast dance-pop built on the Hi-NRG pulse | medium |
| hi-nrg | breakthrough | Dead or Alive - You Spin Me Round (Like a Record) | 1984 | `PGNiXGX2nLU` | UK #1 in 1985, brought Hi-NRG to the mainstream | medium |
| italo disco | archetype | Sabrina - Boys (Summertime Love) | 1987 | `_OIPDU8kCNo` | typical Italo disco hit | medium |
| ragga | archetype | Ice MC - Think About the Way | 1994 | `iZd-nhQZj5M` | ragga-flavoured eurodance, not dancehall proper; low fit | low |
| spacesynth | origin | Space - Magic Fly | 1977 | `ZavwtJxmqJI` | French space-disco predecessor; the link to the modern spacesynth tag is to verify; duplicate: hoeIRWWVdDg | low |
| synth-funk | archetype | Rockwell - Somebody's Watching Me | 1984 | `7YvAYIJSSZY` | synth-led funk-pop | medium |

### Synth & wave

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| art pop | archetype | Kate Bush - Running Up That Hill | 1985 | `wp43OdtAAkM` | art pop landmark; label (art pop vs progressive pop) to verify; remix: soundcloud-598690569 | medium |
| coldwave | archetype | Molchat Doma - Sudno | 2018 | `91GTuZWCQmY` | best-known modern coldwave/post-punk track; library year missing | medium |
| dance-rock | archetype | Blondie - Heart of Glass | 1978 | `WGU_4-5RaxU` | the dance-rock template | medium |
| dreamwave | archetype | The Midnight - Days of Thunder | 2014 | `UiSB2Fbw9gs` | signature nostalgic-saxophone track; label dreamwave vs synthwave to verify | low |
| dreamwave | archetype | Timecop1983 - On the Run | 2015 | `NmQAW7VtSHc` | signature Timecop1983 track; library year 2018, to verify | low |
| new age | landmark | Jean-Michel Jarre - Oxygene, Pt. 4 | 1977 | `kSIMVnPA994` | from 'Oxygene' (1976); the library year 1980 and genre label (new age vs ambient/electronic) are to verify | low |
| new wave | archetype | Alphaville - Big in Japan | 1984 | `tl6u2NASUzU` | studio version; live copy: zAGaU_ddZKU | medium |
| new wave | landmark | Blondie - Heart of Glass | 1978 | `WGU_4-5RaxU` | new wave crossover into disco; 2013 remix: 3HVuMlaNcOM | medium |
| new wave | breakthrough | Alliance (Альянс) - Na zare (На заре) | 1987 | `tUBVEKzsZ-k` | Soviet new wave mass hit; evidence thin | low |
| synthpop | archetype | a-ha - Take On Me | 1985 | `djV11Xbc914` | classic synth-pop hit | high |
| synthpop | origin | Kraftwerk - Radioactivity | 1975 | `X--F5b5IdqU` | Kraftwerk as precursor of synth-pop; song/year (1975) to verify | low |
| synthpop | landmark | New Order - Blue Monday | 1983 | `c1GxjzHm5us` | landmark of electronic dance-pop; sits between synthpop and dance | medium |
| synthwave | archetype | Kavinsky - Nightcall | 2010 | `MV_3Dpw-BRY` | named etalon in genre-terminology; Drive soundtrack made it the genre's calling card | high |
| synthwave | origin | Miami Nights 1984 - Early Summer | 2010 | `YzT7DOet6Ag` | early scene artist; evidence thin, to verify | low |
| synthwave | landmark | FM-84 feat. Ollie Wride - Running in the Night | 2016 | `TvZskcqdYcE` | most-played modern synthwave anthem; library year 2020, to verify | medium |
| vaporwave | breakthrough | HOME - Resonance | 2016 | `8GW6sLrK40k` | most widely known track attached to vaporwave/synthwave culture; label to verify | low |

### Breaks, drum and bass, downtempo

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| big beat | archetype | Fatboy Slim - Ya Mama | 2000 | `dS7Eu05OUH8` | typical sampled-breaks big beat; year to verify | medium |
| big beat | landmark | The Prodigy - Breathe | 1996 | `6_PAHbqq-o4` | breakout single of the big beat era | medium |
| drum and bass | archetype | Concord Dawn - Morning Light | 2002 | `jxDZ-1sf9Bg` | clean NZ drum and bass; weak evidence | low |
| drum and bass | landmark | DJ Marky & XRS - LK | 1999 | `Xu9TuPhQWy4` | V Recordings classic; year to verify, library year empty | medium |
| drum and bass | breakthrough | The Prodigy (Pendulum remix) - Voodoo People | 2005 | `soundcloud-42327170` | if this is the Pendulum remix: crossover to a rock audience; check which copy (also XQEBzauVIlA) | low |
| liquid drum and bass | archetype | Netsky feat. Darrison - Memory Lane | 2010 | `cG7cRDcPY3k` | popular liquid drum and bass tune | medium |
| trip hop | landmark | Massive Attack - Angel | 1998 | `hbe3CQamF8k` | from 'Mezzanine'; library year 2009 is another version or wrong | medium |

### Rock, metal & punk

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| alternative metal | archetype | System of a Down - Toxicity | 2001 | `iywaBOMvYLI` | library year 2002; tagged progressive metal there | medium |
| alternative rock | archetype | Red Hot Chili Peppers - Californication | 1999 | `YlUKcNNmywk` | no first-rank alternative rock track in the library; library year 2000 | low |
| britpop | landmark | The Verve - Bitter Sweet Symphony | 1997 | `1lyu1KKwC74` | late Britpop landmark; library tags post-britpop | medium |
| britpop | breakthrough | Oasis - Wonderwall | 1995 | `6hzrDeceEKc` | made Britpop a global success | high |
| classic rock | archetype | Lynyrd Skynyrd - Free Bird | 1973 | `MQNRKX8GwPo` | staple of classic rock radio | medium |
| dance-punk | archetype | Gossip - Heavy Cross | 2009 | `5mQVljB7JGw` | weak evidence | low |
| folk punk | archetype | Gogol Bordello - Immigraniada (We Comin' Rougher) | 2010 | `aKpgb2WrGo0` | gypsy punk, a folk punk branch | low |
| folk rock | landmark | The Animals - The House of the Rising Sun | 1964 | `N4bFqW_eu2I` | electric treatment of a folk song; 'first folk rock' wording to verify | medium |
| garage rock | archetype | The Castaways - Liar, Liar | 1965 | `vIvUVdvNeBE` | 1960s garage rock one-hit wonder | medium |
| hard rock | archetype | Deep Purple - Smoke on the Water | 1972 | `qK7j_EERgT4` | riff-driven hard rock icon; 1972 album, 1973 single; library copy is a remaster | high |
| hard rock | landmark | Guns N' Roses - You Could Be Mine | 1991 | `6Sp1bLrBAuQ` | library year 1987 is wrong or another cut; weaker fit | low |
| indie pop* | breakthrough | Gotye feat. Kimbra - Somebody That I Used to Know | 2011 | `8UVNT4wvIGY` | global indie pop hit; label to verify | low |
| nu metal | archetype | Limp Bizkit - Rollin' (Air Raid Vehicle) | 2000 | `RYnFIRc0k6E` | typical rap-rock nu metal | medium |
| nu metal | breakthrough | Papa Roach - Last Resort | 2000 | `j0lSpNtjPM8` | breakthrough hit; library copy is an alternate 'other' version | high |
| pop punk | archetype | The Offspring - The Kids Aren't Alright | 1998 | `7iNbnineUCI` | library year 1999; also punk rock, to verify | low |
| post-grunge | archetype | Nickelback - How You Remind Me | 2001 | `Aiay8I5IPB8` | commercial peak of post-grunge radio rock | medium |
| rap metal | archetype | Kid Rock - Bawitdaba | 1998 | `1OrNS2zbTZg` | rap/metal hybrid; library year 2009 differs, to verify | low |
| southern rock | archetype | Lynyrd Skynyrd - Free Bird | 1973 | `MQNRKX8GwPo` | southern rock anthem | high |

### Jazz, soul & world

| Genre | Role | Artist - Title | Year | Library id | Why | Conf. |
| --- | --- | --- | --- | --- | --- | --- |
| chanson | archetype | Jacques Brel - Amsterdam | 1964 | `-Z0UGGvb4sQ` | classic French chanson; library copy is the 1966 Olympia live recording, studio year to verify | high |
| estrada | archetype | Alexander Serov (Александр Серов) - Madonna (Мадонна) | 1987 | `oH6o2iat4oY` | Soviet estrada hit; duplicate: 5Sgycq_f1VM; evidence thin | low |
| hard bop | archetype | Kenny Burrell - Soul Lament | 1963 | `S_HBlzRJxaM` | same album; bop vs soul jazz label to verify | low |
| mbalax | breakthrough | Youssou N'Dour & Neneh Cherry - 7 Seconds | 1994 | `wqCpjFMvz-k` | international crossover; pop-heavy, so low-medium fit | low |
| rai | breakthrough | Khaled - Aicha | 1996 | `gzlHucbD76U` | brought rai to a European mass audience | medium |
| soul jazz | archetype | Kenny Burrell - Chitlins Con Carne | 1963 | `ylGjvwXV3HA` | from 'Midnight Blue'; a cornerstone of blues-soaked jazz guitar | medium |

## Gaps

Genres with songs where no library song is a good enough reference, with the number of songs in brackets. Most are modern or niche acts, remixes or misfits for the tag.

acid (1), acid house (1), alternative pop (3), alternative r&b (3), ambient (13), ambient house (4), arena rock (1), art rock (3), balearic (1), ballad (4), baroque pop (2), beat (1), blues rock (6), breakbeat (18), breaks (4), chillwave (18), chiptune (2), contemporary r&b (12), dancehall (1), dark metal (2), darksynth (11), darkwave (2), death metal (3), downtempo (14), dream pop (10), dreamsynth (2), dub (1), dubstep (4), electro (25), electronic rock (14), experimental (3), folk (4), folk pop (2), funk (13), future bass (3), future house (5), ghettotech (1), glam (2), glitch (1), glitch hop (1), gothic metal (3), grunge (3), heavy metal (9), horrorcore (1), house (66), idm (4), indie rock (20), industrial metal (4), industrial rock (1), melodic techno (6), modern classical (1), moombahton (1), neo soul (1), neurofunk (3), orchestral pop (1), phonk (4), pop rap (7), pop rock (36), pop soul (2), post-britpop (2), post-punk (11), post-punk revival (1), power pop (6), progressive breaks (2), progressive metal (1), progressive pop (1), progressive trance (21), psychedelic rock (3), psychedelic soul (1), pub rock (2), punk (5), reggae-pop (1), rock and roll (2), romani (1), sadcore (2), schlager (1), shock rock (1), shoegaze (1), singer-songwriter (5), soft rock (7), soul (9), sovietwave (5), space rock (2), sunshine house (1), symphonic rock (1), synth-rock (2), tech house (6), trap (4), vocal (1), witch house (1), worldbeat (1).

Umbrella tags (references go to subgenres): blues (6), classical (1), hip hop (24), jazz (2), pop (90), reggae (1), rock (52). Group (no references): edm (6).

Well-known tracks the library lacks, as a wish-list seed only (from memory, unverified; the owner decides): house (Frankie Knuckles - Your Love), techno (Model 500 - No UFOs), drum and bass (Roni Size - Brown Paper Bag), ambient (Brian Eno - Music for Airports), acid house (Phuture - Acid Tracks), electro (Afrika Bambaataa - Planet Rock), grunge (Nirvana - Smells Like Teen Spirit), punk (Ramones, Sex Pistols), heavy metal (Black Sabbath, Iron Maiden), post-punk (Joy Division), shoegaze (My Bloody Valentine), dubstep (Skream, Benga), neurofunk (Noisia), darksynth (Carpenter Brut, Perturbator), chillwave (Washed Out).

## How to adopt

1. The owner answers with row picks per genre, for example "keep the trance rows; drop dream trance; vocal trance: Silence as landmark" (genre plus role identifies a row; or name the library id).
2. For each pick Claude checks the year and label on Discogs/MusicBrainz/Wikipedia and collects at least two sources, or the owner's ear.
3. Claude saves the entry through `POST /genres/{name}/references` with `{song_id, role, note?, sources?}` (owner only, API-218; artist, title and year then come from the library song, so fix wrong library years first or send the explicit fields), one genre at a time as in the wave 1 principles. A track already saved for the genre answers 409 `reference_exists`.
4. Nothing is bulk-imported; rejected rows are simply dropped from this page.
