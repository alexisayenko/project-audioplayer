"""Built-in list of common genre names for the genre autocomplete (`GET /genres`)."""

_GROUPS = """
electronic, techno, melodic techno, minimal techno, acid techno, hard techno, dub techno, detroit techno, industrial techno, peak time techno, hypnotic techno, ambient techno
house, deep house, tropical house, tech house, progressive house, acid house, chicago house, electro house, big room house, future house,, afro house, funky house, latin house, soulful house, jackin house, french house, minimal house, organic house, melodic house, bass house,, disco house, lo-fi house
trance, progressive trance, uplifting trance, psytrance, goa trance, vocal trance, tech trance, hard trance, full-on, dark psytrance, melodic trance
drum and bass, liquid drum and bass, neurofunk, jungle, jump up, darkstep, techstep, breakbeat, big beat, breaks, uk garage, speed garage, 2-step, future garage
dubstep, brostep, riddim, grime, trap, future bass, bass music, glitch hop,, hardstyle, hardcore, gabber, happy hardcore, frenchcore, uk hardcore, hard dance, makina
edm, electro, electroclash, electropop, synthpop, synthwave, retrowave, soviet wave, vaporwave, future funk, italo disco, eurodance, eurobeat, hi-nrg, nu-disco, disco, space disco, euro disco
idm, intelligent dance music, glitch, microsound, braindance, acid, electronica, downtempo, trip hop, chillout, chillwave, lounge, nu jazz, psybient, dark ambient, drone, ambient, space music, new age, dungeon synth
industrial, ebm, electro-industrial, darkwave, coldwave, minimal wave, new wave, synth-punk, aggrotech, dark electro, futurepop, witch house
rock, classic rock, hard rock, soft rock, progressive rock, psychedelic rock, art rock, glam rock, southern rock, blues rock, folk rock, country rock, garage rock, surf rock, space rock, krautrock, stoner rock, desert rock, math rock, post-rock, noise rock, yacht rock, heartland rock, jam band, rockabilly, rock and roll, symphonic rock, gothic rock, pop rock, funk rock, acoustic rock, instrumental rock
alternative rock, indie rock, indie pop, indie folk, indie, lo-fi, shoegaze, dream pop, noise pop, jangle pop, britpop, grunge, post-grunge, emo, midwest emo, screamo, post-hardcore, pop punk, skate punk, madchester, baggy, new rave, dance-punk, post-punk, art punk, no wave, garage punk, riot grrrl, college rock
punk, punk rock, hardcore punk, oi!, street punk, anarcho-punk, crust punk, folk punk, ska punk, horror punk, gypsy punk, cowpunk
metal, heavy metal, thrash metal, death metal, black metal, doom metal, power metal, speed metal, progressive metal, symphonic metal, gothic metal, folk metal, viking metal, nu metal, metalcore, deathcore, groove metal, sludge metal, stoner metal, industrial metal, djent, melodic death metal, technical death metal, funeral doom, post-metal, glam metal, hair metal, neoclassical metal, alternative metal, rap metal, drone metal, grindcore, mathcore, pagan metal, blackgaze
pop, dance pop, teen pop, art pop, baroque pop, chamber pop, sunshine pop, power pop, bubblegum pop, k-pop, j-pop, c-pop, mandopop, cantopop, euro pop, europop, latin pop, city pop, pop soul, hyperpop, bedroom pop, dark pop, electropop, adult contemporary, easy listening, soft pop, sophisti-pop, schlager, chanson, yé-yé, ballad,
hip hop, rap, east coast hip hop, west coast hip hop, southern hip hop, gangsta rap, conscious hip hop, boom bap, alternative hip hop, abstract hip hop, instrumental hip hop, cloud rap, emo rap, drill, uk drill, g-funk, crunk, horrorcore, hardcore hip hop, jazz rap, trap rap, mumble rap, old school hip hop, political hip hop, rap rock, UK hip hop, french rap, german hip hop
lo-fi hip hop, phonk, memphis rap, chopped and screwed, mobb music, hyphy,,, plugg,
r&b, contemporary r&b, alternative r&b, neo soul, soul, northern soul, southern soul, motown, blue-eyed soul, psychedelic soul, funk, p-funk, funk metal, go-go, boogie, new jack swing, quiet storm, gospel, contemporary gospel, urban contemporary, doo-wop, rhythm and blues
jazz, bebop, hard bop, cool jazz, modal jazz, free jazz, avant-garde jazz, fusion, jazz fusion, smooth jazz, acid jazz, swing, big band, dixieland, new orleans jazz, gypsy jazz, latin jazz, afro-cuban jazz, bossa nova, jazz funk, soul jazz, post-bop, vocal jazz, spiritual jazz, nordic jazz, jazz blues, ragtime, third stream, crossover jazz, contemporary jazz
blues, delta blues, chicago blues, electric blues, texas blues, piedmont blues, country blues, jump blues, british blues, blues rock, soul blues, acoustic blues
classical, baroque, renaissance, medieval, romantic, classical period, contemporary classical, modern classical, minimalism, neoclassical, opera, operetta, chamber music,,,, choral,, gregorian chant, early music,, solo piano, string quartet, art song, lieder, impressionism,, experimental, electroacoustic, musique concrète, anime, orchestral soundtrack, cinematic, epic
folk, traditional folk, contemporary folk, american folk, british folk, celtic, irish folk, scottish folk, nordic folk, neofolk, folk pop, freak folk, anti-folk, singer-songwriter, acoustic, appalachian folk, bluegrass, old-time, americana, roots rock, protest song, sea shanty,, world fusion
country, classic country, outlaw country, alt-country, country pop, contemporary country, honky tonk, western swing, bro-country, country folk, texas country, red dirt,, nashville sound, bakersfield sound, neotraditional country, truck-driving country,
reggae, roots reggae, dub, dancehall, ragga, ska, rocksteady, lovers rock, reggaeton, reggae fusion, dub poetry, soca, calypso, zouk, kompa, mento, two-tone, third wave ska, ska jazz, reggae rock, digital dancehall
latin, salsa, bachata, merengue, cumbia, tango, bolero, mariachi, ranchera, norteño, banda, corrido, tejano, latin trap, latin rock, rock en español, bossa nova, samba, mpb, tropicália, forró, sertanejo, pagode, axé, baile funk, funk carioca, flamenco, rumba, son cubano, mambo, cha-cha-cha, timba, vallenato, champeta,, merengue house,
world, afrobeat, afrobeats, afropop, highlife, juju, soukous, mbalax, mbaqanga, kwaito, amapiano, gqom, isicathamiya, tuareg blues, desert blues, ethio-jazz, rai, gnawa, chaabi, balkan, balkan brass, klezmer, polka, fado, tarantella, rebetiko, laïko, turkish folk, arabesque, arabic pop, khaleeji, sufi music, qawwali, ghazal, bollywood, filmi, bhangra, indian classical, hindustani, carnatic, raga, bhajan, kirtan, indian pop,, nasheed, persian classical, gamelan, dangdut, throat singing, polynesian, hawaiian, andean, nueva canción, joik
russian rock, russian pop, estrada, bard, russian chanson, blatnaya pesnya, soviet pop, via, italo pop, canzone, cantautore, french pop, variété française, nouvelle chanson, german pop, neue deutsche welle, krautrock, volksmusik, deutschrock, deutschpunk, hamburger schule, nederpop, levenslied, scandipop, swedish pop, finnish metal, norwegian black metal, italo house, italo
christmas music,, christian, christian rock, worship, contemporary christian, gospel, spiritual, hymn,,
comedy,,,,,, nature sounds, meditation,,,,, background music, library music,,, easy listening, exotica, tiki, space age pop, lounge, bachelor pad
""".replace("\n", ",")


def normalise(name: str) -> str:
    return " ".join(name.lower().split())


def _build() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in _GROUPS.split(","):
        n = normalise(raw)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


BUILTIN: list[str] = _build()
