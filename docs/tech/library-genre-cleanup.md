# Library genre cleanup (2026-10-19)

Status: done. Applied at server start by `app.migrate_removals`, file `server/data/library_genre_removals.json` (127 songs, 208 genre removals, 20 genre additions, 1 song cleared; the second batch of 25 songs is not deployed yet). 0 HIGH rows pending, 37 MEDIUM rows left unproposed (below), 1 open decision (below).

Review of genres that were put on songs by mistake (removal, with a few owner-approved additions). Evidence is English Wikipedia (song page first, artist page second). The owner approved all HIGH-confidence rows (his edits included) plus the descriptor genres acoustic and instrumental (they are version types), and approved the remaining rows one by one in chat.

Conventions: "(also: X)" in an owner message means X was removed too; a "(maybe also: X)" that the owner did not repeat stays on the song.

## Applied

- 2026-10-19 (commit 9a48455, deployed; verified on https://electrophone.cc/library): 90 songs, 150 genre removals, 7 genre additions, 1 song cleared.
- 2026-10-20 (more owner-approved rows; not deployed yet): 25 more songs, 42 more removals, 8 more additions, which makes the totals in Status. Two former MEDIUM rows (Aaron Smith - Dancin (KRONO Remix), Gustavo Bravetti - Babel) were approved in that batch.
- 2026-10-20 (not deployed yet): `epic` removed from 2 songs (descriptor, not a genre; Alex, 2026-10-20): one new row (Thomas Bergersen - Final Frontier) and one added to an existing row (Concord Dawn - Take Me Away), which makes 116 songs and 194 removals in total. No song had `epic` as its only genre. The vocabulary node is dropped as well (see [genre-levels.md](genre-levels.md#epic-removed-owner-2026-10-20)).
- 2026-10-20 (not deployed yet): `dub` removed from Gogol Bordello - Immigraniada (We Comin' Rougher) (Alex; `dub` appears only on the artist page, an artist-level pattern); the song already had a row (`polka`), so it is one more removal on an existing row: 116 songs and 195 removals in total.
- 2026-10-20 (not deployed yet): `soft rock` and `eurodance` removed from Ace of Base - All That She Wants (Alex; the Wikipedia song page infobox lists dance-pop, reggae pop, synth-pop and europop, neither of these): one new row, which makes 117 songs and 197 removals in total.
- 2026-10-20 (not deployed yet): `reggae` removed from Boney M. - Sunny (Wikipedia: the Boney M. version infobox lists only Eurodisco; reggae is artist and album level), one more removal on an existing row; `darksynth` added to ZOMBIENICK - OSCILLATIONS (2018, album CREEPER; it had synthwave only; `darksynth` is a vocabulary child of synthwave): one new add-only row. 120 songs, 199 removals and 18 additions in total. Also `dance pop` and `house` added to Elton John, Dua Lipa - Cold Heart (PNAU Remix) (Wikipedia: dance-pop in the infobox and lead, house beats in the text; synthpop skipped on the owner's ear).
- 2026-10-20 (not deployed yet): the bare `r&b` removed from 6 songs and `rhythm and blues` from 3 (Wikipedia evidence, approved by Alex as CT1): The Animals - House Of The Rising Sun, Boney M. - Sunny, Rockwell - Somebody's Watching Me (keeps contemporary r&b), Izzy Bizu - White Tiger, Gnarls Barkley - Crazy, Alex Mica - Dalinda (`r&b`); Duffy - Mercy, The Rolling Stones - Anybody Seen My Baby?, Rod Stewart - Da Ya Think I'm Sexy? (`rhythm and blues`); 3 rows extended, 6 new. 126 songs, 208 removals and 18 additions in total.
- 2026-10-21 (to deploy): `progressive house` and `electro house` added to R-Tem - Voiceless (SoundCloud, Z05 mix, 2005, 133 bpm; it had no genre, approved by Alex): one new add-only row. 127 songs, 208 removals and 20 additions in total.
- Record: `server/data/library_genre_removals.json` (machine-readable; per song `remove` / `add` / `clear` and the title). The per-row evidence (Wikipedia links) lived in the earlier revisions of this file (git history before this prune).
- Mechanism: `app.migrate_removals` runs at server start, backs up each library to `backups-genre-removals/` first, and is idempotent (a second start changes nothing).

Patterns that drove the removals:

- Artist-level genre on a remix or cover: a remix or club version carried the original band's genres (rock, post-punk) while the recording is dance or progressive house.
- Ambiguous-name pattern: a lookup matched a genre by a shared word (funk, rock and roll, cloud rap, dancehall) that the artist or song never had.
- Family mismatch: a genre from a different family than the song's own (psytrance or dubstep on drum and bass, techno on a 1975 synth-pop song).

## Open

- Альфа - Я сделан из такого вещества (`1wJPSSITKZI`) has no genres (cleared; it had rock, hard rock, pop rock) until Alex decides which to assign; Alfa (1984) is Soviet synth/pop rock, not hard rock.

## MEDIUM only (not proposed for removal)

1. **Jean-Michel Jarre - Oxygene, Pt. 4** (`kSIMVnPA994`): techno, trance, electro, progressive rock - Oxygene is ambient/new age electronic
2. **Ленинград - Химкинский лес** (`xwOVydmc0hI`): hip hop, indie rock, chanson, folk - Leningrad is a ska-punk band; these are noise
3. **Daft Punk - Something About Us** (`sOS9aOIXPEk`): house, french house, electronic rock - Something About Us is a slow disco/R&B ballad
4. **Delerium - Innocente (Sadrican 2026 Remix)** (`dQ03F36U5qg`): new age, worldbeat, dark ambient - Sadrican progressive remix keeps the genres of the ambient Delerium original
5. **Gorillaz - Feel Good Inc.** (`HyHNuVaZJ-k`): pop rap, synthpop, art pop - Song page: alternative rock, hip hop, rap rock, funk rock
6. **Lana Del Rey - Lana Del Rey - Young and Beautiful** (`o_1aF54DO60`): trip hop, indie rock, slowcore - Song page: orchestral pop / classical crossover; trip hop, indie rock and slowcore are not described there
7. **Michael Jackson - Thriller** (`Z85lxckrtzg`): new wave, rock, soul - Song page: disco, funk (disco-funk)
8. **Rod Stewart - Da Ya Think I'm Sexy?** (`Hphwfq1wLJs`): blues rock, rhythm and blues, new wave - Song page: disco
9. **The Prodigy - Voodoo People (remaster)** (`3kjfrgkD9K0`): alternative rock, electronic rock, big beat - Song page: techno, breakbeat, breakbeat hardcore
10. **Смысловые Галлюцинации - Вечно молодой** (`E8xRsobPWWU`): pub rock, soft rock, post-punk - Russian rock band; British pub rock is noise
11. **a-ha - Summer Moved On** (`oVl4qvHuY8g`): alternative rock, soft rock - a-ha synthpop/new wave
12. **a-ha - Take On Me** (`djV11Xbc914`): alternative rock, electronic rock - Song page: synth-pop, new wave
13. **BANKS - Change** (`F0b8KA1drwI`): trip hop, indie pop - Song page: electronica, R&B
14. **Blur - Song 2** (`SSbBvKaM6sk`): art pop, art rock - Song page: alternative rock, indie rock, punk rock, grunge
15. **Kenny Burrell - Soul Lament (Remastered 1999/Rudy Van Gelder Edition)** (`S_HBlzRJxaM`): cool jazz, soul - Kenny Burrell page: jazz, blues, soul jazz
16. **KISS - I Was Made For Lovin' You** (`ZhIsAZO5gl0`): heavy metal, glam - KISS disco-rock song
17. **London Grammar - Nightcall** (`OZYw0MQp_fI`): rock, art rock - London Grammar cover is indie pop/trip hop
18. **Martin Garrix & Tiësto - The Only Way Is Up** (`AewNd29wRUM`): deep house, future bass - The Only Way Is Up is progressive/big-room house
19. **Mattafix - Big City Life** (`4mtfnfQoAco`): rnb/swing, trip hop - Mattafix page: electronic, hip hop, dancehall, world
20. **Ray Parker Jr. - Ghostbusters** (`Fe93CLbHjxQ`): contemporary r&b, new wave - Song page: dance-pop, synth-rock
21. **Spiderbait - Black Betty** (`ftbuDDWFHz4`): synthpop, post-grunge - Spiderbait page: alternative rock, hard rock, grunge, electropop
22. **The Chemical Brothers - Hold Tight London** (`wXV-jr64szI`): pop rap, pop rock - Big beat track; rock-pop tags look like lookup noise
23. **The Offspring - The Kids Aren't Alright** (`7iNbnineUCI`): melodic hardcore, pop rock - Offspring is punk rock / pop punk
24. **The Rolling Stones - Anybody Seen My Baby? (remaster)** (`SOW00_B4wE8`): psychedelic rock, rock and roll - Song page: rock
25. **Total - Бьет по глазам** (`SnYjy-WNn90`): alternative rock, indie rock - Total is Russian pop/R&B group
26. **Русский размер - Ангел дня** (`DqgCZ1CkzOY`): techno, trance - Russky Razmer is Russian pop/eurodance; techno and trance are not supported
27. **2 Unlimited - No Limit** (`r6FVk2k4qsM`): hi-nrg - Song page: eurodance, techno, trance; hi-nrg not mentioned
28. **Ace of Base - All That She Wants** (`d73tiBBzvFM`): soft rock - Ace of Base is eurodance/reggae-pop
29. **Baby K - Roma-Bangkok** (`tUOpXeagVcg`): synthpop - Roma-Bangkok is reggaeton/dance pop
30. **Dua Lipa, Elton John - Cold Heart (Live from the Royal Albert Hall)** (`IbxPoaTdrz0`): contemporary r&b - Song page lists dance-pop, synth-pop, disco; no R&B
31. **Duffy - Mercy** (`y7ZEVA5dy-Y`): blues - Duffy Mercy is soul (page: soul)
32. **Int Company - Ocean** (`mAJp1o4-Gpk`): funk - Int Company is neurofunk DnB; plain funk is the ambiguous-name pattern
33. **Madonna - Hung Up** (`e99M6-7KW0k`): house - Song page: dance-pop, disco, nu-disco, electro, hi-NRG
34. **Monika Linkytė - Po dangum** (`N2KGQv0hX7o`): pop rock - Synthpop/indie pop song; pop rock an outlier
35. **Pierce Fulton - Kuaga (Lost Time)** (`pmsqm0khgII`): indie pop - Kuaga is progressive/electro house
36. **Rick Astley - Never Gonna Give You Up** (`dQw4w9WgXcQ`): disco - Song page: dance-pop, synth-pop, blue-eyed soul, house; no disco
37. **The Bangles - Walk Like an Egyptian** (`vth-T1u7A58`): paisley underground - Song page lists pop rock, new wave, novelty; paisley underground is a band-level scene tag
