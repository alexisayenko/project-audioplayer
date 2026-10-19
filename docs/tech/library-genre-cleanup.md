# Library genre cleanup (2026-10-19)

Status: applied at server start by app.migrate_removals, file server/data/library_genre_removals.json (98 songs, 166 genre removals, 15 genre additions, 1 song cleared; not deployed yet).

Review of genres that were put on songs by mistake (removal, with a few owner-approved additions). Evidence is English Wikipedia (song page first, artist page second). The owner approved all HIGH-confidence rows (his edits included) plus the descriptor genres acoustic and instrumental (they are version types), and approved the remaining rows one by one in chat. Everything under "Approved removals" is applied as one reviewed list at a server start, with a backup first (file `server/data/library_genre_removals.json`).

Conventions: "(also: X)" in an owner message means X was removed too; a "(maybe also: X)" that the owner did not repeat stays on the song.

Counts: 0 rows still to read, 98 rows approved by the owner.

## Approved removals (confirmed row by row)

1. **Armin van Buuren - In And Out Of Love (Sadrican 2026 Remix)** (`eqLtSWmKkJE`) CONFIRMED
   - remove: **psytrance**
   - why: Armin van Buuren page lists EDM, trance, house, techno; psytrance never; remix is progressive house
   - source: https://en.wikipedia.org/wiki/Armin_van_Buuren
2. **ATB - Ecstasy (Sadrican 2026 Remix)** (`Le8325thBt4`) CONFIRMED
   - remove: **drum and bass, dance pop, eurodance**
   - why: ATB Ecstasy original is trance; the Sadrican remix is progressive; drum and bass fits neither
   - source: https://en.wikipedia.org/wiki/ATB
3. **Blondie - Heart Of Glass** (`WGU_4-5RaxU`) CONFIRMED
   - remove: **rock and roll**
   - why: Heart of Glass is a new wave/disco song; rock and roll never describes it
   - source: https://en.wikipedia.org/wiki/Heart_of_Glass_(song)
4. **Blondie - Heart Of Glass (Oliver & Thee Mike B Remix)** (`3HVuMlaNcOM`) CONFIRMED
   - remove: **rock and roll, post-punk, power pop, rock**
   - why: Club remix (Oliver & Thee Mike B) carries the original band genres; recording is disco/dance
   - source: https://en.wikipedia.org/wiki/Heart_of_Glass_(song)
5. **Boney M. - Sunny** (`S-u6qdeaPoE`) CONFIRMED
   - remove: **italo disco**
   - why: Boney M. version is Eurodisco per the page (soul jazz/pop belong to the Bobby Hebb original); Italo disco is a different (Italian) scene
   - source: https://en.wikipedia.org/wiki/Sunny_(Bobby_Hebb_song)
6. **C&C Music Factory - Gonna Make You Sweat (Everybody Dance Now)** (`LaTGrV58wec`) CONFIRMED
   - remove: **rock and roll**
   - why: Song page: hip house, diva house, funk, dance-pop
   - source: https://en.wikipedia.org/wiki/Gonna_Make_You_Sweat_(Everybody_Dance_Now)
7. **Concord Dawn - Don't Tell Me** (`v8JuiRQGNZA`) CONFIRMED
   - remove: **trance, dubstep**
   - why: Concord Dawn page: drum and bass group
   - source: https://en.wikipedia.org/wiki/Concord_Dawn
8. **Concord Dawn - Morning Light** (`jxDZ-1sf9Bg`) CONFIRMED
   - remove: **trance**
   - why: Concord Dawn page: drum and bass group
   - source: https://en.wikipedia.org/wiki/Concord_Dawn
9. **Concord Dawn - Take Me Away** (`GmTFURNrIJQ`) CONFIRMED
   - remove: **trance**
   - why: Concord Dawn page: drum and bass group
   - source: https://en.wikipedia.org/wiki/Concord_Dawn
10. **Daft Punk - Around The World** (`K0HSD_i2DvA`) CONFIRMED
   - remove: **electronic rock, synthpop**
   - why: Song page: French house, funk, disco, dance
   - source: https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)
11. **Daft Punk - One More Time** (`FGBhQbmPwH8`) CONFIRMED
   - remove: **indie rock**
   - why: Song page: French house, disco, club, electropop
   - source: https://en.wikipedia.org/wiki/One_More_Time_(Daft_Punk_song)
12. **Dire Straits - Money For Nothing** (`2zXTaB_9JQg`) CONFIRMED
   - remove: **progressive rock**
   - why: Song page: pop rock
   - source: https://en.wikipedia.org/wiki/Money_for_Nothing_(song)
13. **Donna Summer - I Feel Love** (`yEbaeLv-aOo`) CONFIRMED
   - remove: **rock, contemporary r&b**
   - why: Song page: synth-pop, Eurodisco, dance
   - source: https://en.wikipedia.org/wiki/I_Feel_Love
14. **Duran Duran - Come Undone** (`Epj84QVw2rc`) CONFIRMED
   - remove: **hard rock**
   - why: Song page: soft rock and dance-rock; hard rock contradicts a soft-rock ballad
   - source: https://en.wikipedia.org/wiki/Come_Undone_(Duran_Duran_song)
15. **Gossip - Heavy Cross** (`5mQVljB7JGw`) CONFIRMED
   - remove: **acoustic**
   - why: Song page: dance-rock, dance-punk; band page does not mention acoustic
   - source: https://en.wikipedia.org/wiki/Heavy_Cross
16. **Gotye - Somebody That I Used To Know** (`8UVNT4wvIGY`) CONFIRMED
   - remove: **electro house, house, hard rock**
   - why: Song page: art pop and alternative rock; house and hard rock are unrelated
   - source: https://en.wikipedia.org/wiki/Somebody_That_I_Used_to_Know
17. **Kate Bush - Running Up That Hill (Pure Orkidea Pure Progressive Mix)** (`soundcloud-598690569`) CONFIRMED
   - remove: **art pop, progressive pop, art rock, new wave, singer-songwriter, baroque pop**
   - why: Pure Orkidea progressive trance remix carries the original Kate Bush genres
   - source: https://en.wikipedia.org/wiki/Running_Up_That_Hill
18. **Khaled - Aicha** (`gzlHucbD76U`) CONFIRMED
   - remove: **jazz**
   - why: Song page lists only rai
   - source: https://en.wikipedia.org/wiki/Aicha_(song)
19. **Kid Rock - Bawitdaba** (`1OrNS2zbTZg`) CONFIRMED
   - remove: **country, country rock**
   - why: Song page lists nu metal, rap metal, hard rock; country belongs to the artist only
   - source: https://en.wikipedia.org/wiki/Bawitdaba
20. **Lana Del Rey - Young and Beautiful (Jazz Foxtrot Version) -** (`o61zJ7_uVdA`) CONFIRMED
   - remove: **trip hop, indie rock, slowcore**
   - why: Jazz foxtrot version carries the original album-style genres; song page lists orchestral pop / classical crossover, none of these
   - source: https://en.wikipedia.org/wiki/Young_and_Beautiful_(Lana_Del_Rey_song)
21. **M83 - Midnight City** (`dX3k_QDnzHE`) CONFIRMED
   - remove: **post-rock, ambient**
   - why: Song page: synth-pop, dream pop, new wave, electropop
   - source: https://en.wikipedia.org/wiki/Midnight_City
22. **Michael Jackson - Beat It** (`8fO8jVZ3T9g`) CONFIRMED
   - remove: **disco, electronic**
   - why: Song page: hard rock, dance-rock, funk rock
   - source: https://en.wikipedia.org/wiki/Beat_It
23. **Nadia Ali, Starkillers & Alex Kenji - Pressure (Alesso Remix)** (`SU88c0f5-h0`) CONFIRMED
   - remove: **blues, singer-songwriter**
   - why: Alesso remix of a vocal trance/house song; blues and singer-songwriter belong to neither the remix nor Nadia Ali (house/trance); version carries wrong genres
   - source: https://en.wikipedia.org/wiki/Nadia_Ali
24. **Nickelback - How You Remind Me** (`Aiay8I5IPB8`) CONFIRMED
   - remove: **acoustic**
   - why: Song page: post-grunge, hard rock, alternative rock; electric band song
   - source: https://en.wikipedia.org/wiki/How_You_Remind_Me
25. **Nora En Pure - Come With Me** (`spIyzp8XDn4`) CONFIRMED
   - remove: **indie rock, nu-disco**
   - why: Nora En Pure page: deep house, indie dance, tech house, progressive house; no indie rock
   - source: https://en.wikipedia.org/wiki/Nora_En_Pure
26. **Paul van Dyk - We Are Alive** (`6I64KxnINy8`) CONFIRMED
   - remove: **psytrance, electro house**
   - why: Paul van Dyk page lists uplifting/progressive trance, house, techno; never psytrance
   - source: https://en.wikipedia.org/wiki/Paul_van_Dyk
27. **Red Hot Chili Peppers - Californication** (`YlUKcNNmywk`) CONFIRMED
   - remove: **heavy metal, funk metal, alternative metal, hard rock, classic rock**
   - why: Song page: alternative rock only
   - source: https://en.wikipedia.org/wiki/Californication_(song)
28. **Red Hot Chili Peppers - Otherside** (`rn_YodiJO6k`) CONFIRMED
   - remove: **heavy metal, funk metal, alternative metal, hard rock, classic rock**
   - why: Same band, mellow alternative rock song (RHCP page lists alternative rock)
   - source: https://en.wikipedia.org/wiki/Red_Hot_Chili_Peppers
29. **Rockwell - Somebody's Watching Me** (`7YvAYIJSSZY`) CONFIRMED
   - remove: **indie rock**
   - why: Song page: synth-funk, synth-pop, new wave, R&B; no indie rock
   - source: https://en.wikipedia.org/wiki/Somebody%27s_Watching_Me
30. **Sandra - In the Heat of the Night** (`dFdVQ0fLOj4`) CONFIRMED
   - remove: **pop rock**
   - why: Sandra is Eurodisco/synthpop
   - source: https://en.wikipedia.org/wiki/In_the_Heat_of_the_Night_(Sandra_song)
31. **Space - Magic Fly** (`ZavwtJxmqJI`) CONFIRMED
   - remove: **instrumental**
32. **Static-X - The Only** (`vMCbJB4yNXo`) CONFIRMED
   - remove: **pop**
   - why: Static-X page: industrial metal, nu metal, alternative metal; pop not mentioned
   - source: https://en.wikipedia.org/wiki/Static-X
33. **Taylor Dayne - Tell It to My Heart** (`Ud6sU3AclT4`) CONFIRMED
   - remove: **soul, house, freestyle**
   - why: Owner perception example (page: dance-pop, synth-pop, freestyle, hi-NRG; soul and house not listed)
   - source: https://en.wikipedia.org/wiki/Tell_It_to_My_Heart_(Taylor_Dayne_song)
34. **The Animals - House Of The Rising Sun** (`N4bFqW_eu2I`) CONFIRMED
   - remove: **progressive rock, psychedelic rock**
   - why: Page lists the Animals version as folk rock and blues rock; progressive rock is a different style
   - source: https://en.wikipedia.org/wiki/House_of_the_Rising_Sun
35. **The Chemical Brothers - Go** (`LO2RPDZkY88`) CONFIRMED
   - remove: **rock, pop rock**
   - why: Song page: electronica, trip hop, funk; no rock
   - source: https://en.wikipedia.org/wiki/Go_(The_Chemical_Brothers_song)
36. **The Cranberries - Zombie** (`6Ejga4kJUts`) CONFIRMED
   - remove: **dream pop, jangle pop**
   - why: Song page: alternative rock, grunge; soft dream/jangle pop contradict this heavy protest song
   - source: https://en.wikipedia.org/wiki/Zombie_(Cranberries_song)
37. **The Prodigy - Voodoo People (Pendulum Remix)** (`soundcloud-42327170`) CONFIRMED
   - remove: **techno, hardcore, alternative rock**
   - why: Pendulum remix is drum and bass; techno/breakbeat hardcore is the original (page: techno, breakbeat, breakbeat hardcore)
   - source: https://en.wikipedia.org/wiki/Voodoo_People
38. **The Verve - Bitter Sweet Symphony** (`1lyu1KKwC74`) CONFIRMED
   - remove: **trip hop, downtempo**
   - why: Song page: Britpop, alternative rock, pop rock, chamber pop, post-Britpop
   - source: https://en.wikipedia.org/wiki/Bitter_Sweet_Symphony
39. **Youssou N'Dour - 7 Seconds** (`wqCpjFMvz-k`) CONFIRMED
   - remove: **instrumental, afrobeat, folk**
   - why: 7 Seconds is a vocal duet (Youssou N Dour and Neneh Cherry)
   - source: https://en.wikipedia.org/wiki/Seven_Seconds_(Youssou_N%27Dour_and_Neneh_Cherry_song)
40. **Алексей Вишня - Шприц** (`3JOzPE-8GHw`) CONFIRMED
   - remove: **techno**
   - why: Vishnya 1989 is new wave/synthpop; techno anachronistic
   - source: https://en.wikipedia.org/wiki/Aleksei_Vishnya
41. **Один в каное - У мене немає дому** (`gw2nclcoFNE`) CONFIRMED
   - remove: **acoustic**
   - why: Band has electric indie rock sound; acoustic pattern
   - source: https://en.wikipedia.org/wiki/Odyn_v_kanoe
42. **Blondie - Maria** (`6ZAWNgEbdqA`) approved 2026-10-19 (chat)
   - remove: **post-punk**
   - why: Maria (1999) is power pop / pop rock; post-punk and disco are not typical
43. **The Prodigy - Breathe** (`6_PAHbqq-o4`) approved 2026-10-19 (chat)
   - remove: **alternative rock, techno**
   - why: Song page: electronic rock, big beat
44. **Комбинация - American Boy** (`W7hAo28NCXc`) approved 2026-10-19 (chat)
   - remove: **chanson, folk pop**
   - why: Kombinatsiya is Soviet disco/synthpop; chanson and folk pop look like lookup noise
45. **Отпетые Мошенники - Люби меня люби** (`q6gr5LW7Dqs`) approved 2026-10-19 (chat)
   - remove: **r&b, rhythm and blues**
   - why: Otpetye Moshenniki is Russian pop/pop rap
46. **ABBA - Gimme! Gimme! Gimme! (A Man After Midnight)** (`XEjLoHdbVeE`) approved 2026-10-19 (chat)
   - remove: **glam**
   - why: Gimme! Gimme! Gimme! is disco/Europop, not glam
47. **Desire - Under Your Spell** (`9K7rmxjk5RQ`) approved 2026-10-19 (chat)
   - remove: **rock**
   - why: Desire is italo disco/synthpop
48. **DJ Mehdi - Signatune (Thomas Bangalter Edit)** (`F-pK9KHoCsg`) approved 2026-10-19 (chat)
   - remove: **hip hop**
   - why: Signatune is electro/French house
49. **Eric Prydz - Call On Me** (`qetW6R9Jxs4`) approved 2026-10-19 (chat)
   - remove: **techno**
   - why: Call on Me is progressive/electro house
50. **Haddaway - What is Love (Deepjack & Mr Nu Remix)** (`cb6WpqqN1ww`) approved 2026-10-19 (chat)
   - remove: **eurodance, pop**
   - add: **deep house**
   - why: Deepjack and Mr Nu remix is house; eurodance is the original
51. **Marilyn Manson - Sweet Dreams (Are Made Of This)** (`QUvVdTlA23w`) approved 2026-10-19 (chat)
   - remove: **glam**
   - why: Song page lists industrial rock, hard rock, gothic rock, heavy metal for the cover
52. **MIKA - Relax, Take It Easy** (`RVmG_d3HKBA`) approved 2026-10-19 (chat)
   - remove: **alternative rock**
   - why: Song is synthy glam pop; alternative rock is a lone rock-family outlier
53. **ODESZA - A Moment Apart** (`xarC5jAiO7w`) approved 2026-10-19 (chat)
   - remove: **trap**
   - why: ODESZA A Moment Apart is future bass/chillwave
54. **Pendulum - Blood Sugar (Mixed By DJ Gvozd)** (`HWOIEAZLgx0`) approved 2026-10-19 (chat)
   - remove: **electronic rock**
   - why: Blood Sugar is drum and bass/neurofunk
55. **Ласковый Май - Белые розы** (`WuiCOPve18I`) approved 2026-10-19 (chat)
   - remove: **rock**
   - why: Laskovy Mai is Soviet teen pop/synth pop; rock is a different family (page not fetched)
56. **АИГЕЛ - Татарин** (`yQR_NLeXKtw`) approved 2026-10-19 (chat)
   - remove: **house, alternative rock**
   - add: **hip hop, electronic**
   - why: AIGEL is electronic/experimental hip hop
57. **Kate Bush - Running Up That Hill** (`wp43OdtAAkM`) approved 2026-10-19 (chat)
   - remove: **baroque pop**
   - why: Running Up That Hill is art pop / synth-pop; baroque pop is a stretch
58. **Kato feat. Jon - Turn The Lights Off (S.A.R.A.H. Remix)** (`LpUogjU99NY`) approved 2026-10-19 (chat)
   - remove: **hip hop**
   - add: **melodic techno, progressive house**
   - why: Remix is melodic techno/progressive house; hip hop is artist-level
59. **Edward Maya - Stereo Love (Sadrican 2026 Remix)** (`s5IIWKZr_2w`) approved 2026-10-19 (chat)
   - remove: **tropical house, eurodance**
   - add: **progressive house**
   - why: Original is eurodance/trance (page: eurodance, techno, trance, popcorn); the remix is progressive house
60. **Kenny Burrell - Chitlins Con Carne** (`ylGjvwXV3HA`) approved 2026-10-19 (chat)
   - remove: **cool jazz, soul**
   - why: Kenny Burrell page: jazz, blues, soul jazz
61. **Culture Beat - Mr. Vain (Paul Da Breda Remix)** (`Zb5sUzQc-_I`) approved 2026-10-19 (chat)
   - remove: **eurodance, dance pop**
   - add: **progressive house** (`melodic house` is an alias of house in the vocabulary, already on the song)
   - why: Remix by Paul Da Breda is melodic/progressive house; eurodance and dance pop are the original
62. **Gorillaz - Clint Eastwood** (`1V_xRb0x9aw`) approved 2026-10-19 (chat)
   - remove: **art pop, synthpop**
   - why: Song page: trip hop, alternative hip hop, alternative rock, rap rock
63. **Bomfunk MC's - Freestyler** (`ymNFyxvIdaM`) approved 2026-10-19 (chat)
   - remove: **techno, big beat**
   - why: Song page: breakbeat
64. **Каспийский Груз - Табор уходит в небо** (`srGCQfzh1OI`) approved 2026-10-19 (chat)
   - remove: **trap**
   - why: Kaspiyskiy Gruz is Russian rap
65. **Юрий Шатунов - Седая ночь** (`P9HjbqMIZTA`) approved 2026-10-19 (chat)
   - remove: **chanson**
   - why: Shatunov song is synth/Euro disco pop
66. **The Prodigy - Poison** (`_mej5wS7viw`) approved 2026-10-19 (chat)
   - remove: **alternative rock**
   - why: Song page: hip hop, techno, reggae
67. **Thirty Seconds To Mars - This Is War (Radio Edit)** (`hynVT6ixpkI`) approved 2026-10-19 (chat)
   - remove: **progressive rock**
   - why: Radio edit of a modern alternative rock track
68. **Альфа - Я сделан из такого вещества** (`1wJPSSITKZI`) approved 2026-10-19 (chat)
   - clear: **all genres removed (rock, hard rock, pop rock) until the owner assigns the right ones**
   - why: Alfa (1984) is Soviet synth/pop rock, not hard rock
69. **Kraftwerk - Radioactivity** (`X--F5b5IdqU`) approved 2026-10-19 (chat)
   - remove: **techno**
   - why: Page: synth-pop, electronic; 1975 song is not techno
70. **LMFAO - Party Rock Anthem** (`zIh5AHxh-Ok`) approved 2026-10-19 (chat)
   - remove: **dubstep**
   - why: Song is electro house/dance-pop
71. **Marilyn Manson - This Is The New Shit** (`4kQMDSw3Aqo`) approved 2026-10-19 (chat)
   - remove: **nu metal**
   - why: Owner perception: nu metal is the weakest of the genres; industrial metal fine
72. **Kato Feat. Jon - Turn The Lights Off (DEEPO Remix Long Version)** (`szLTDSw11kw`) approved 2026-10-19 (chat)
   - remove: **hip hop**
   - why: Remix is house; Kato page: mostly house, hip hop is artist-level
73. **Antinomy - State of Mind** (`9VpW8Atlj7k`) approved 2026-10-19 (chat)
   - remove: **psychedelic rock**
   - why: Antinomy is a psytrance project; psychedelic rock is the ambiguous-name pattern
74. **Murray Head - One Night In Bangkok** (`0FSE57u58rs`) approved 2026-10-19 (chat)
   - remove: **baroque pop**
   - why: Song page: new wave, hip-hop, pop, synth-pop
75. **Мираж - Музыка нас связала** (`AEwTnmIM1YM`) approved 2026-10-19 (chat)
   - remove: **pop rock, eurobeat**
   - why: Mirage is Soviet disco/synth pop
76. **Daft Punk - Get lucky (Extended Version)** (`0QVOc1aagSE`) approved 2026-10-19, all HIGH rows agreed
   - remove: **house, french house, synthpop**
   - why: Same song; page: disco, funk, pop
   - source: https://en.wikipedia.org/wiki/Get_Lucky_(Daft_Punk_song)
77. **Daft Punk - Instant Crush** (`a5uQMwRMHcs`) approved 2026-10-19, all HIGH rows agreed
   - remove: **punk, house, french house**
   - why: Song page: synth-pop, electronic rock; not house or punk
   - source: https://en.wikipedia.org/wiki/Instant_Crush
78. **Daft Punk - Robot Rock** (`sFZjqVnWBhc`) approved 2026-10-19, all HIGH rows agreed
   - remove: **house, french house, nu-disco**
   - why: Song page: electronic rock, dance-rock
   - source: https://en.wikipedia.org/wiki/Robot_Rock_(song)
79. **BANKS - Change (Chainsmokers Remix)** (`FcVOsoBIGq0`) approved 2026-10-19, all HIGH rows agreed
   - remove: **downtempo, trip hop**
   - why: Chainsmokers remix is future bass/EDM; Banks original page: electronica, R&B
   - source: https://en.wikipedia.org/wiki/Change_(Banks_song)
80. **Daft Punk - Get Lucky** (`5NV6Rdv1a3I`) approved 2026-10-19, all HIGH rows agreed
   - remove: **electronic rock, synthpop**
   - why: Song page: disco, funk, pop; house/synthpop/electronic rock are the duo, not this song
   - source: https://en.wikipedia.org/wiki/Get_Lucky_(Daft_Punk_song)
81. **New Order - Blue Monday** (`c1GxjzHm5us`) approved 2026-10-19, all HIGH rows agreed
   - remove: **progressive house, hard trance**
   - why: Song page: synth-pop, Eurodisco, alternative dance, hi-NRG, dance-pop
   - source: https://en.wikipedia.org/wiki/Blue_Monday_(New_Order_song)
82. **Laura Branigan - Self Control** (`RP0_8J7uxhs`) approved 2026-10-19, all HIGH rows agreed
   - remove: **folk rock**
   - why: Self Control is a synth/Euro disco-style song (Raf original: Italo disco)
   - source: https://en.wikipedia.org/wiki/Self_Control_(Laura_Branigan_song)
83. **Maduk ft Veela - Ghost Assassin VIP** (`soundcloud-165722418`) approved 2026-10-19, all HIGH rows agreed
   - remove: **uk garage**
   - why: Maduk page: drum and bass; garage is the ambiguous-name pattern
   - source: https://en.wikipedia.org/wiki/Maduk
84. **Massive Attack - Angel** (`hbe3CQamF8k`) approved 2026-10-19, all HIGH rows agreed
   - remove: **industrial rock**
   - why: Owner perception example (the page infobox does list industrial rock, but the owner says remove)
   - source: https://en.wikipedia.org/wiki/Angel_(Massive_Attack_song)
85. **Miami Horror - Make You Mine (Fred Falke remix)** (`UhIdvAJE7nA`) approved 2026-10-19, all HIGH rows agreed
   - remove: **punk**
   - why: Miami Horror page: electropop, synth-pop, dance-pop, nu-disco; punk not mentioned; Fred Falke remix is disco/house
   - source: https://en.wikipedia.org/wiki/Miami_Horror
86. **RÜFÜS DU SOL - Innerbloom** (`Tx9zMFodNtA`) approved 2026-10-19, all HIGH rows agreed
   - remove: **dancehall**
   - why: Song page: electronic, deep house, progressive house; dancehall is unrelated
   - source: https://en.wikipedia.org/wiki/Innerbloom
87. **System Of A Down - Lonely Day** (`DnGdoEa1tPg`) approved 2026-10-19, all HIGH rows agreed
   - remove: **speed metal**
   - kept on the song (maybe-also, not approved): nu metal, heavy metal
   - why: Song page: alternative metal, hard rock; Lonely Day is a ballad
   - source: https://en.wikipedia.org/wiki/Lonely_Day
88. **The Castaways - Liar, Liar** (`vIvUVdvNeBE`) approved 2026-10-19, all HIGH rows agreed
   - remove: **indie rock**
   - why: Song page: garage rock, proto-punk (1965); indie rock anachronistic
   - source: https://en.wikipedia.org/wiki/Liar,_Liar_(The_Castaways_song)
89. **Vicetone, Tony Igy - Astronomia** (`iLBBRuVDOo4`) approved 2026-10-19, all HIGH rows agreed
   - remove: **dancehall**
   - why: Vicetone page: progressive/electro/deep/future house, nu-disco; no dancehall
   - source: https://en.wikipedia.org/wiki/Vicetone
90. **Елена Темникова - Тепло** (`_yejiN8Sl9s`) approved 2026-10-19, all HIGH rows agreed
   - remove: **cloud rap**
   - why: Temnikova page: pop, dance-pop, Europop, house; no hip hop family
   - source: https://en.wikipedia.org/wiki/Yelena_Temnikova
91. **Baby K feat. Giusy Ferreri - Roma-Bangkok** (`tUOpXeagVcg`) approved 2026-10-19, asked for by the owner
   - remove: **house**, **hip hop**, **dancehall**, **pop**, **reggaeton**; add: **synthpop**, **moombahton**
   - result: synthpop, moombahton (Wikipedia: electropop, moombahton); the earlier row removed synthpop and moombahton, which is reversed here because the whole file is re-applied when its hash changes
92. **Lana Del Rey - Young and Beautiful** (`o_1aF54DO60`) approved 2026-10-19, asked for by the owner
   - remove: **trip hop**, **indie rock**
   - keeps: indie pop, pop, dream pop, baroque pop, sadcore, slowcore
93. **Future Fate - Militant** (`zCz3jDPoAtc`) retag asked for by the owner
   - remove: **darkwave**; add: **darksynth**
94. **Crockett - Cruise** (`SDfXbCwmBYg`) retag asked for by the owner
   - remove: **darkwave**; add: **darksynth**
95. **Weightlessness - Dark Time** (`3L21HnrZzxc`) retag asked for by the owner
   - remove: **darkwave**; add: **darksynth**
96. **Brotherhood Of Man - Save Your Kisses For Me** (`6OW1JJwqVRQ`) approved 2026-10-19, asked for by the owner
   - remove: **middle of the road**, **schlager**, **disco**
   - keeps: pop
97. **Gustavo Bravetti - Babel** (`8BphNy9ZQMU`) approved 2026-10-20, asked for by the owner
   - remove: **dancehall**; add: **dubstep**
   - result: dubstep (Discogs and Qobuz describe it as electronic: dubstep, grime, club/dance); grime exists in the vocabulary but is not added
98. **Aaron Smith - Dancin (KRONO Remix)** (`0XFudmaObLI`) approved 2026-10-20, asked for by the owner
   - remove: **dancehall**, **house**; add: **deep house**, **nu-disco**
   - result: deep house, nu-disco (owner choice: the KRONO remix is deep house, the song is neither reggae nor dancehall)

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
28. **Aaron Smith - Dancin (KRONO Remix)** (`0XFudmaObLI`): dancehall - KRONO remix is deep house; removed later, see row 98
29. **Ace of Base - All That She Wants** (`d73tiBBzvFM`): soft rock - Ace of Base is eurodance/reggae-pop
30. **Baby K - Roma-Bangkok** (`tUOpXeagVcg`): synthpop - Roma-Bangkok is reggaeton/dance pop
31. **Dua Lipa, Elton John - Cold Heart (Live from the Royal Albert Hall)** (`IbxPoaTdrz0`): contemporary r&b - Song page lists dance-pop, synth-pop, disco; no R&B
32. **Duffy - Mercy** (`y7ZEVA5dy-Y`): blues - Duffy Mercy is soul (page: soul)
33. **Int Company - Ocean** (`mAJp1o4-Gpk`): funk - Int Company is neurofunk DnB; plain funk is the ambiguous-name pattern
34. **Madonna - Hung Up** (`e99M6-7KW0k`): house - Song page: dance-pop, disco, nu-disco, electro, hi-NRG
35. **Monika Linkytė - Po dangum** (`N2KGQv0hX7o`): pop rock - Synthpop/indie pop song; pop rock an outlier
36. **Pierce Fulton - Kuaga (Lost Time)** (`pmsqm0khgII`): indie pop - Kuaga is progressive/electro house
37. **Rick Astley - Never Gonna Give You Up** (`dQw4w9WgXcQ`): disco - Song page: dance-pop, synth-pop, blue-eyed soul, house; no disco
38. **The Bangles - Walk Like an Egyptian** (`vth-T1u7A58`): paisley underground - Song page lists pop rock, new wave, novelty; paisley underground is a band-level scene tag
39. **Gustavo Bravetti - Babel** (`8BphNy9ZQMU`):  - Gustavo Bravetti is a tech house/techno DJ; sole genre is lookup noise (removal would leave zero: keep one); later retagged to dubstep, see row 97
