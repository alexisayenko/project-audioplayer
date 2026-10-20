# Electronic forms: proposed placement of the 146 Electronic genres

**PROPOSAL, not applied to data.** Nothing in `server/data/` has changed. This is the mapping that [task-0066](../tasks/task-0066.md) would apply, produced by a read-only analysis of the vocabulary and the live library on 2026-10-20 and adjusted to the owner decisions of the same day ([genre-terminology.md](genre-terminology.md), ADR-0038). Tree rules: [genre-levels.md](genre-levels.md).

Reading the tables: "Level" is the shortest-path depth in the new tree (a level 1 form is level 1 even where it keeps a second parent). Parents are equal (ADR-0037); the first listed is only the table section. "Conf": clear, judgement or unsure (unsure items are in the judgement list at the end). Old parents of nearly all rows were `Electronic` (replaced by the form) or the form itself.

## The level 1 forms

Electronic stops being a node in the chain: it becomes a group, and these become level 1 genres, each the genre itself like Rock (the node `house` is the genre `house`; its children rise one level).

| Form | Notes |
|---|---|
| house, techno, trance | existing genres, now level 1 |
| drum and bass | separate from breakbeat; jungle has both as parents |
| breakbeat | |
| ambient | |
| eurodance | keeps parents Pop and euro disco |
| synthwave | |
| experimental | keeps parent Rock; `industrial` is a modifier of kind sound, not a node |
| uk garage | proposed, decision CG pending |

Not forms: `synthpop` (decision CC1: parents Pop and new wave; `related` disco; electronic by medium, level 2), `bass music` (decision CA: it names a sound, so its genres are redistributed below).

## House (level 1)

| Genre | Extra parents | Level | Conf | Note |
|---|---|---|---|---|
| acid house, deep house, electro house, euro house, french house, future house, garage house, italo house, microhouse, progressive house, sunshine house, tribal house, tropical house | | 2 | clear | unchanged children of house |
| ghetto house | | 2 | clear | parent of juke, footwork, ghettotech |
| juke, footwork, ghettotech | (ghetto house) | 3 | judgement | were under Electronic or bass music |
| ghetto | | 2 | unsure | bare name of ghetto house: synonym candidate |
| tribal | | 2 | clear | bare name of tribal house |
| balearic | | 2 | judgement | Balearic beat, house-based |
| ambient house | ambient | 2 | clear | |
| hard house | hardcore techno | 2 | clear | |
| hip house | Hip Hop | 2 | clear | |
| tech house | techno | 2 | clear | |
| electro swing | Jazz | 2 | judgement | swing sampled over house |
| future jazz, jazzdance | Jazz | 2 | judgement / unsure | jazz plus house fusion (jazzdance unclear) |
| moombahton | `related` Latin | 2 | judgement | decision CG, was under bass music |
| donk | hardcore techno | 2 | clear | |
| baltimore club | breakbeat | 2 | clear | |
| speed garage | uk garage | 2 | clear | |

## Techno (level 1)

| Genre | Extra parents | Level | Conf | Note |
|---|---|---|---|---|
| deep techno, dub techno, hard techno, melodic techno, minimal techno, schranz | | 2 | clear | |
| minimal | | 2 | clear | bare name of minimal techno; also a modifier |
| acid | house | 2 | judgement | acid modifier node kept |
| bleep | | 2 | clear | |
| new beat | | 2 | judgement | Belgian precursor |
| lento violento | | 2 | unsure | slow hard techno variant |
| hardcore techno | | 2 | clear | renamed from hardcore (AX1, implemented, not deployed); bare `hardcore` is a modifier, no synonym |
| breakcore, doomcore, gabber, happy hardcore, jumpstyle, makina, speedcore | | 3 | clear | children of hardcore techno |
| hardstyle | hardcore techno, trance | 2 | clear | |
| tech trance | trance | 2 | clear | |
| hard trance | trance, hardcore techno | 2 | clear | |

## Trance (level 1)

| Genre | Extra parents | Level | Conf | Note |
|---|---|---|---|---|
| acid trance, deep trance, dream trance, euro trance, neo trance, nu-nrg, progressive trance, uplifting trance, vocal trance | | 2 | clear | |
| psytrance | | 2 | clear | |
| dark psytrance, forest psytrance, full-on psytrance, goa trance, progressive psytrance | | 3 | clear | were level 4 |
| psybient | ambient | 2 | clear | |
| hands up | eurodance | 2 | clear | |

## Drum and bass, breakbeat

| Genre | Parents | Level | Conf | Note |
|---|---|---|---|---|
| liquid drum and bass, neurofunk | drum and bass | 2 | clear | |
| jungle | breakbeat, drum and bass | 2 | clear | decision BZ1; `related` reggae |
| big beat, breaks, progressive breaks | breakbeat | 2 | clear | |
| broken beat | breakbeat | 2 | judgement | broken-rhythm house/jazz cousin |
| electro | breakbeat, Hip Hop | 2 | judgement | electro-funk; was under bass music |
| freestyle | electro | 3 | unsure | Miami electro, Latin hip hop |
| halftime | drum and bass (or uk garage) | 2 | unsure | rhythm feel, not a style; CG pending |

## Ambient

| Genre | Parents | Level | Conf | Note |
|---|---|---|---|---|
| berlin-school, dark ambient, drone, dungeon synth, illbient, lowercase | ambient | 2 | clear | |
| downtempo | ambient | 2 | judgement | chill-out lineage |
| trip hop | downtempo, Hip Hop | 2 | clear | |
| new age | ambient | 2 | judgement | |

## Eurodance, synthwave

| Genre | Parents | Level | Conf | Note |
|---|---|---|---|---|
| italodance | eurodance | 2 | clear | |
| disco polo | eurodance | 2 | unsure | Polish dance-pop |
| chillwave, darksynth, dreamsynth, dreamwave, sovietwave, vaporwave | synthwave | 2 | clear | |
| spacesynth | synthwave, italo disco | 2 | clear | |
| chiptune, skweee | synthwave | 2 | unsure | synth sound, no clear parent |

## Experimental

| Genre | Parents | Level | Conf | Note |
|---|---|---|---|---|
| glitch, musique concrète, plunderphonics, sound art, sound collage | experimental | 2 | clear | |
| abstract, leftfield, power electronics | experimental | 2 | judgement | |
| idm, noise | experimental | 2 | clear | |
| harsh noise wall, rhythmic noise | noise | 3 | clear | |
| glitch hop | experimental, Hip Hop | 2 | judgement | was under bass music, breakbeat |
| ebm | experimental, synthpop | 2 | judgement | industrial dance |
| dark electro | ebm | 3 | judgement | EBM offshoot |
| witch house | experimental | 2 | judgement | `related` synthwave, darksynth, vaporwave (BV default, unconfirmed); synonyms drag, screwgaze, haunted house, crunk shoegaze (BU default, unconfirmed); never a house subgenre; no related link to house (BT) |
| neofolk | Folk, World & Country, experimental | 2 | judgement | folk plus post-industrial |

## UK garage (proposal, CG pending)

| Genre | Parents | Level | Conf | Note |
|---|---|---|---|---|
| dubstep | uk garage | 2 | judgement | was under bass music |
| future bass | dubstep | 3 | judgement | |
| bassline | uk garage | 2 | clear | |
| grime | uk garage, Hip Hop | 2 | judgement | |
| kuduro | ? | ? | unsure | Angolan dance, no clear parent: leave under no form or `world` later |

If CG is rejected, uk garage, dubstep, future bass, bassline, grime and speed garage fall back to house (speed garage, garage house already) or breakbeat, and no new level 1 form is added.

## Synthpop (variant B, decision CC1)

`synthpop`: parents Pop and new wave (Rock), `related` disco, electronic by medium (the medium is derived from the tree, so a CE-style override or an explicit medium root is needed); level 2; synonyms `techno-pop`, `technopop` (CD1). Children: electroclash [synthpop, electro] level 3; ebm [experimental, synthpop] level 2; dark electro under ebm level 3. Techno-pop is "technological pop", unrelated to Detroit techno, which it influenced; it is not a techno genre.

## Genres that leave the Electronic tree

| Genre | New placement | Level | Conf | Note |
|---|---|---|---|---|
| disco | Funk / Soul | 2 | judgement | a disco family genre, not an electronic form |
| euro disco, hi-nrg, italo disco, nu-disco, post-disco, space disco | disco | 3 | clear | stay electronic by medium only via the CE override flag (open) |
| dub | Reggae | 2 | judgement | Jamaican |
| electronic rock | Rock | 2 | unsure | CE and BM open |
| beatbox | Hip Hop | 2 | unsure | vocal percussion |
| edm | group (off-tree) | - | judgement | a purpose set, a flag on genres (the 89-genre list is in the AN1 analysis files and the repository history) |
| bass music | removed as a genre or a sound modifier | - | judgement | CA: not a form; open whether it survives as a modifier |

## Judgement list (to confirm)

1. CG: uk garage as a form; where dubstep, future bass, grime, speed garage, bassline, halftime and kuduro go.
2. Disco family and electronic rock keep the electronic medium (CE).
3. Unsure rows: ghetto, jazzdance, beatbox, lento violento, freestyle, disco polo, chiptune, skweee, kuduro, halftime, electronic rock.
4. Multi-parent genres keep all parents (BP): hands up, hard trance, hardstyle, tech house, speed garage, glitch hop and others sit under two forms.
5. downtempo and new age under ambient; broken beat under breakbeat; balearic under house; new beat under techno.
6. witch house relations (BV, BU) are defaults, unconfirmed.

## Coverage

Every one of the 146 Electronic-family genres of the analysis is named above (checked by a name search; names of children also appear in the parent rows). `industrial` is not a genre in this table; it is a modifier.
