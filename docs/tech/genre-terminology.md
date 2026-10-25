# Genre terminology, the genre model and classification axes

Decision records: ADR-0038 (the genre model: genres, groups, modifiers, four axes), ADR-0034 (terms), ADR-0030 (levels and parents), ADR-0037 (equal parents) in [decisions.md](decisions.md). Data shape: [genre-levels.md](genre-levels.md). Spec: [genres.md](../specs/genres.md).

Status words used below: **Decided** (owner decision, with date), **Built** (in the code or data today), **Not built**, **OPEN** (see Open decisions). Everything under Decided is a decision of the owner (Alex) from the chat of 2026-10-20 unless another date is given.

## Glossary

| Term | Meaning here |
|---|---|
| genre | A style you can assign to a song (house, rock, synthpop, hardcore punk), at any level. Shown in lowercase. Every node that can be on a song is a genre. |
| group | An organisational node that is never assigned to a song (Electronic, EDM, Latin, World). Decided 2026-10-20; the data model still calls the level 1 nodes "families" and has no group concept yet. |
| family | A level 1 node of the tree (11 today, Discogs' level-1 names, e.g. Rock, Electronic). Shown capitalised. A family is a genre or a group depending on the test in the next section; the word describes the position, not the kind. |
| sub-genre, sub-sub-genre | Level 2, level 3 and deeper genres. No depth cap (ADR-0037); the interface says "genre" for every level. |
| modifier | A word that qualifies a genre without being one (acid, progressive, dark, deep, berlin). Renamed from "flavour" on 2026-10-20. See Modifiers. |
| `parents[]` | Subgenre-of links, an unordered set: all parents are equal, there is no primary parent (ADR-0037). A genre belongs to every family it is classified under (grouping, not historical descent; see "Grouping, not lineage"); its level is the shortest path depth to a family. A genre with several parents appears under each of them. |
| `related[]` | Influences and associations. Not parents: no effect on tree, counts or colours. |
| `fusion` | Flag on a blend of two or more families; with the map's "Fusion genres" switch off it keeps its genre parents (else the first family listed) and its other family parents are hidden. |
| subfamily | A label on Electronic genres (eight groups, e.g. House, Techno). Not a tree node; used for shading and filtering. Built today; replaced by level 1 forms when AN1 is built ([task-0066](../tasks/task-0066.md)). |
| Discogs "style" | What Discogs calls a genre of ours at level 2 or deeper. The API names `styles` and `style=` stay in code that talks to Discogs. |

## How "genre" is used elsewhere

- Wikipedia ([Music genre](https://en.wikipedia.org/wiki/Music_genre)): a genre is a conventional category grouping music by shared conventions and tradition (techniques, cultural context, themes, sometimes geographic origin). A subgenre is a narrower genre that keeps the parent's traits and adds its own; fusion genres blend two or more. So every level is a genre. The article also separates genre from form (violin concertos share a genre but differ in form) and notes that scholars disagree on genre versus style.
- Catalogues (Discogs, iTunes/Apple Music, AllMusic, record stores): "genre" is usually the broad top-level category (Rock, Jazz, Electronic) and "style" the finer categories below it. Discogs uses exactly "genres and styles". Not verifiable from Discogs' own help pages (HTTP 403 for automated fetches); we rely on the data we hold: `server/data/genre_discogs.json` has 15 genres and about 500 styles.
- Ours (ADR-0030): every node is a genre; level 1 is a family; Discogs' "style" is our genre. We keep the song field name `genre` for any level. The 2026-10-20 model (ADR-0038) refines this: a node is a genre only if it can be assigned to a song, otherwise it is a group.

## Genres and groups

Decided 2026-10-20. A **genre** is a style you can assign to a song. A **group** is an organisational node that is never assigned to a song.

| Node | Kind | Why |
|---|---|---|
| house, rock, synthpop, hardcore punk | genre | styles with their own sound |
| Electronic | group | a medium, not a style: you say "I made a house track", never "an electronic genre"; the opposite exists (acoustic) |
| EDM | group, purpose-led | electronic dance music: a named set of genres that cuts across the tree (see below) |
| Latin, World | group | a tradition; it means nothing as a style |

EDM and Electronic:

- EDM is the set of club and festival dance genres. The 89-genre list of it is in the repository history, but it is not stored as data yet. Not built: it is to be stored as a flag on genres (the purpose axis).
- EDM is a subset of Electronic. Synthwave is electronic but not EDM; ambient, synthwave and noise are electronic and not dance.
- Today `edm` is still a genre of the Electronic family in the data (DY1) and `electronic` is still a pill that can sit on songs. Both go away when AN1 is built (task-0066).

## Axes

Decided 2026-10-20. Our own working model, not an established standard: a song is described along four axes. The tree is one of them.

| Axis | Question | Examples | State |
|---|---|---|---|
| **Form** (the genre tree) | Which style is it? | house, rock, synthpop | Built (the tree) |
| **Medium** | How is it made? | electronic, acoustic, instrumental, lo-fi | Not built; to be derived from the tree (AN1, task-0066) |
| **Purpose / role** | What is it for? | dance, film score, military, children's | Not built; the EDM flag is the first case |
| **Tradition** | Which tradition or scene? Called "geography" before | Western, Latin, Chinese, Indian, Celtic; scene or city: Berlin, Detroit, Chicago; country: Italo, French, K- | Partly: country values feed the existing Countries filter, scene words appear as modifiers |
| **Mood** | How does it feel? | personal, per listener | Not built; not shared vocabulary |

Notes:

- Form is our design word for the grouping axis (the genre tree: what a style is classified under; it is not a claim about historical descent, see "Grouping, not lineage"). In musicology "form" also means structure, such as twelve-bar blues; that is not meant here. The user-facing label stays "genre".
- **Modifiers are not an axis.** They qualify a genre on the Form axis (see Modifiers).
- Tradition: a country value (Italy, France, Korea) is the same data as the song's country and feeds the Countries filter. A scene value (Berlin, Baltimore) that shows up in genre names is carried by the `scene` kind of the modifiers.
- Mood is the listener's subjective perception: a personal tag, not vocabulary that Wikipedia can confirm. The shared modifiers of kind `mood` (dark, deep, uplifting) are a different thing: genre-bound words for named sub-styles.
- Medium: acoustic and instrumental are medium (instrumental means no vocals; a cappella is the opposite). They are also version types in the data model: an acoustic or instrumental version of a song is a version of an original, whereas a piece that was always instrumental is a medium attribute, not a version. Lo-fi is a production aesthetic (medium); beat is a format.
- Other purposes seen: ceremonial, background, study. Discogs' top level mixes axes: purpose (Stage & Screen, Children's, Brass & Military, Non-Music; we dropped these four on 2026-10-18), region (Latin; Folk, World, & Country; Reggae has an origin place) and medium (Electronic). That is why our families are uneven.

## Genres are prototype categories

Decided 2026-10-20 (CW1). Genres are not purely subjective: people agree on the centre of a genre (nobody argues that Kraftwerk is electronic or Metallica is heavy metal), but the borders cannot be defined formally. The border is a soft gradient and depends on scene, country and decade.

Colour terms behave the same way: everyone agrees on green and on blue, and where blue turns into green is a convention. Russian has two basic blues, голубой and синий. In psychology this is prototype theory (Eleanor Rosch; Berlin and Kay for colour terms): a category is held together by good examples, not by a definition.

Consequences in our model:

- A song may have several equal parents (ADR-0037); `related` links and fusion flags express soft membership.
- The evidence rule is "Wikipedia consensus at the centre": we do not try to fix borders, only whether a genre name is widely used for the song.
- A future distance measure and the named feature space ([task-0070](../tasks/task-0070.md), see also [task-0064](../tasks/task-0064.md)) would place songs by closeness to a genre's prototype songs.

The reference songs of a genre (its etalon songs, see the etalon test in [How to decide a new label](#how-to-decide-a-new-label)) are the **prototype songs**: the good examples that hold the category together, and the anchors of the future feature space.

Differences from colour: colour has one physical continuum, a genre has several dimensions (hence the axes above), and genres have history and names.

## Tests and rules

All decided 2026-10-20 (owner), except where a date is given.

1. **Genre-versus-place test.** If the label keeps its meaning once the place name is removed, it is a genre with an origin: italo disco is a disco style with its own sound; Eurodance, French house and K-pop likewise. If it means nothing without the place, it is a tradition or a group: Latin, World, Western.
2. **Modifier test.** If the same word qualifies different base genres, it is a modifier, not a genre: progressive house and progressive trance; dark psytrance; deep house; acid house.
3. **Ambiguous-name rule.** When a bare word is used by two different styles, the node carries the qualifier: hardcore punk versus hardcore techno. Decided (AX1, 2026-10-20): the node `hardcore` is renamed `hardcore techno`; the bare word is kept only as a modifier, never as a synonym.
4. **Descriptors are not genres.** Epic (removed 2026-10-20, like lo-fi), instrumental and acoustic (medium), ethereal, industrial as a mood word. They go to the axis they belong to, or nowhere.
5. **Several parents, all equal** (ADR-0037). The `fusion` flag (needs two families; 14 genres today) controls whether the second family colours the genre on the map unless the Fusion toggle is on. "Two scenes" genres (disco, dub, noise) always show under all their families.
6. **Wikipedia is the evidence for assignments.** The song's page first, else the artist's page; artist-level genres do not count for a remix or a single track. The patterns that drove the clean-up (artist-level genre on a remix or cover, ambiguous name, family mismatch) are in [library-genre-cleanup.md](library-genre-cleanup.md).

## Modifiers

Decided: renamed from "flavours" on 2026-10-20 (BD1). A modifier qualifies a genre on the Form axis and is never assigned to a song alone.

| Kind | Meaning | Modifiers |
|---|---|---|
| sound | sonic technique or production feature | acid, progressive, melodic, vocal, hard, minimal, tech, hardcore |
| mood | atmosphere shared by a named sub-style | dark, deep, uplifting |
| scene | a place or scene; a value of the Tradition axis that appears in genre names | baltimore, berlin |

Decided AX1 (2026-10-20): `hardcore` is a modifier of kind sound (the hard, fast, aggressive variant of a style); its bearers will be hardcore techno, happy hardcore, hardcore punk, hardcore hip hop and melodic hardcore once modifiers are attached (task-0065, not built).

The API serves `modifiers` and, for one release, the deprecated alias `flavours` (GEN-082). Built: the block is defined and served, but no genre carries a modifier list yet (the proposed assignment is in [genre-flavours-proposal.md](genre-flavours-proposal.md)). Details: [genre-levels.md](genre-levels.md#modifiers).

## Descriptive aspects (planned)

Planned, not built (2026-10-21, Alex). Beyond the four axes a genre can be described by three groups of descriptors: beat and meter (time signature such as 4/4 or 3/4, tempo range, pulse), rhythm character (straight, syncopated, glitchy, loose) and texture and timbre (bright analog leads, warm muffled pads, tape hiss, gated reverb). They describe a genre; they are not tree levels and never move a genre. Terms, examples and open questions: [task-0070](../tasks/task-0070.md#descriptive-aspects-of-a-genre).

## Current state (Built, verified against `server/data/genre_levels.json` on 2026-10-20)

- (Amended 2026-10-21, task-0079: Latin and Folk, World & Country were removed as level 1 nodes, their genres moved under Others; 9 families remain.) 534 genres in 11 families: Blues, Classical, Electronic, Folk World & Country, Funk / Soul, Hip Hop, Jazz, Latin, Pop, Reggae, Rock. The data calls them families; under the model above Electronic, Latin and Folk, World & Country are groups or mixed.
- Electronic 146 members (54 at level 2, 87 at level 3, 5 at level 4: dark psytrance, forest psytrance, full-on psytrance, goa trance, progressive psytrance). Rock 123 (50, 73, 0). Memberships count a genre in every family it is classified under.
- The level is computed from the shortest path through all parents. Four levels exist in the data.
- Eight Electronic subfamilies: House, Techno, Trance, Breaks & bass, Synth & wave, Ambient & downtempo, Experimental industrial & noise (the data name is "Experimental, industrial & noise"), Eurodance & disco. These are the nodes of the data today; AN1 (decided) replaces them by the forms in [genre-electronic-forms.md](genre-electronic-forms.md) (proposal, not applied).
- Library mix, for scale (the owner's library, 2026-10-20): 0 country songs, about 8 folk, 4 world, 2 classical.
- Related and not built: [task-0064](../tasks/task-0064.md) (song and genre distance, similar songs, tag-outlier check), the EDM purpose flag, the medium facet.

## Decided since the model

All owner decisions of 2026-10-20 (the full list with letter ids is at the end). Plan and numbers: [task-0066](../tasks/task-0066.md); the proposed placement of the 146 Electronic genres: [genre-electronic-forms.md](genre-electronic-forms.md) (PROPOSAL, not applied to data).

- **AN1. Start the restructure.** The Electronic family stops being a node; `electronic` stops being a genre pill; the Electronic medium is derived from the tree. Not built.
- **Level 1 forms of Electronic (CB1).** house, techno, trance, drum and bass (separate from breakbeat), breakbeat, ambient, eurodance, synthwave, experimental; each is the genre itself, like Rock. `industrial` is a modifier of kind sound, not a node. uk garage is proposed (CG, open).
- **Groups.** Electronic, EDM (a purpose set: electronic dance music), Latin and World are groups, never assigned to a song. Electronic is not a genre.
- **`electronic` is ignored as suggestion evidence (CZ).** A source that names `electronic` or another name of the group Others is never a suggestion, never agreement, never a source group and never unlocks a genre (TAG-112).
- **Step 1 of the Others plan (2026-10-20).** "Move dnb, trance, synthwave, techno, house, synthpop, disco out of Others": house, techno, trance, drum and bass and synthwave became level 1 forms; synthpop lost the parent Others (parents Pop and new wave, level 2, still not level 1); disco lost the parent Others (parent Funk / Soul, level 2). Built, not deployed; details and numbers in [task-0066](../tasks/task-0066.md), rule GEN-084.
- **synthpop (CC1, CD1).** Not level 1: parents Pop and new wave (Rock), `related` disco, electronic by medium. Synonyms `techno-pop` and `technopop`.
- **jungle (BZ1).** Parents breakbeat and drum and bass, `related` reggae.
- **bass music (CA).** Not a form: it names a sound, so its genres are redistributed (proposal in the mapping doc, pending as CG).
- **AX1. Hardcore rename.** The Electronic node `hardcore` is now `hardcore techno` (rule 3), no synonym `hardcore`; `happy hardcore` sits under it; `hardcore` is a `sound` modifier. Stored song tags are migrated at start (TAG-110). Implemented, not deployed.
- **epic** is removed as a genre (a descriptor, like lo-fi).
- **Modifier kinds.** dark, deep, uplifting are mood.
- **witch house.** Stays under experimental. Defaults, unconfirmed: BV `related` synthwave, darksynth, vaporwave; BU synonyms drag, screwgaze, haunted house, crunk shoegaze. BT: no `related` link to house.
- **Depth (AD, my pick, unconfirmed).** Level is computed; no "subgenre" or "microgenre" names. Wikipedia uses "microgenre" only descriptively. A separate `microgenre` boolean flag (not a depth name) is under review: [microgenre-candidates.md](microgenre-candidates.md) (task-0100, CH1).

## Worked examples

| Case | Result and why |
|---|---|
| techno-pop | A synonym of synthpop ("technological pop"), not a techno genre: Detroit techno was influenced by it, it is not a child of it |
| witch house | Under experimental, not a house subgenre: the name is a pun, the sound is dark and slow; only `related` links |
| jungle | Two parents, breakbeat and drum and bass (equal, ADR-0037); `related` reggae |
| hardcore | The bare word qualifies several styles, so it is a modifier (sound); the node is `hardcore techno`, next to hardcore punk and hardcore hip hop |
| industrial | A modifier of kind sound (industrial techno, industrial metal), not a node; ebm and noise are the genres |
| drum and bass vs breakbeat | Separate level 1 forms; jungle is the shared child; a breakbeat is a rhythm, drum and bass a style |
| synthpop parents | Pop and new wave (Rock); electronic by medium, not by tree; `related` disco |
| italo disco | A genre (rule 1: it keeps its meaning without the place), a child of disco; electronic by medium only through the CE override flag (open) |
| Latin, World | Groups by tradition: they mean nothing as a style (rule 1) |

## Open decisions

None is applied. Each has the options and the recommended pick; data changes follow as a reviewable change (task-0066).

- **CE. Disco kin stay electronic?** italo disco, nu-disco, hi-nrg, space disco and electronic rock are not under an Electronic form. Options: 1. an override flag keeps the electronic medium; 2. they lose it. Recommended: 1. Without it the medium count drops from 290 to 277 songs.
- **CF/CG. uk garage and the bass-music genres.** Options: 1. uk garage as a level 1 form with dubstep, speed garage, bassline, grime [uk garage, Hip Hop], future bass under dubstep; juke, footwork, ghettotech under ghetto house under house; moombahton under house, `related` Latin; baltimore club [breakbeat, house]; glitch hop [experimental, Hip Hop]; electro [breakbeat, Hip Hop]; 2. no new form, put them under house and breakbeat. halftime and kuduro are unsure in both. Recommended: 1.
- **BJ. 7 songs left with no genre** (Goom Gum - Moonlight; Pascal Letoublon - Friendships; MOGUAI - U Know Y; Pional - Tempest; Electro Fusion - Splash of Euphoria; Die Antwoord - Enter The Ninja; Wild Pogo - Francis a. Preve). Options: 1. the owner picks genres; 2. keep the pill for them. Recommended: 1.
- **BK. 5 songs that stop being electronic** (Две Тысячи Лет, The Magic Key, Crazy, ODIUM, Called Out In The Dark). Recommended: review each and fix the genres.
- **BM. Electronic rock under synthwave?** Recommended: no; keep it under Rock plus the CE flag.
- **BP. Multi-parent genres keep all parents** (hands up, tech house, hard trance...). Recommended: yes.
- **BQ. The Discogs mirror and the extras move too** (`genre_discogs.json`, `genre_extras.json`). Recommended: yes.
- **BR. Removal of the `electronic` pill by a generic pass**, not by editing `library_genre_removals.json`: that file is hash-marked, so any edit re-runs the whole plan (and would remove a genre the owner re-added after an earlier row). Recommended: yes.
- **BS. `/genres/graph` keeps the 11 colour families.** The Mac app hardcodes 11 families plus Other and the old graph page reads them. Recommended: yes.
- **BG. Boney M. - Sunny.** Remove `reggae`; Wikipedia lists only Eurodisco for this version. Recommended: remove.
- **AO. Groups on the map.** Groups drawn dashed; EDM as a toggle that highlights its genres. Recommended: yes.
- **AP. Split Folk, World, & Country.** Folk and Country genres, World and Latin groups, an `origin` attribute. Recommended: yes (library: 0 country, about 8 folk, 4 world; 6 songs touch reggae, 2 plain `reggae`).
- **AQ. The level 1 list.** Genres: Blues, Classical, Country, Folk, Funk / Soul, Hip Hop, Jazz, Pop, Reggae, Rock, plus the Electronic forms; groups Electronic, EDM, Latin, World. Pop and Classical are the weakest. Recommended: adopt with AP.
- **AR. Modern classical on Final Frontier.** Kept for now.
- **AT. Reggae family.** Calypso and soca are Trinidadian. Options: 1. keep; 2. "Reggae & Caribbean"; 3. move. No recommendation.
- **EDM purpose flag.** The 89 genres are to be stored as a flag; the list is in the analysis files and repository history.
- **Later tasks:** the modifier filter ([task-0065](../tasks/task-0065.md), AY) and audio distance ([task-0064](../tasks/task-0064.md)).

Data-quality notes: Mattafix and Gorillaz were checked and kept; `dub` was removed from Gogol Bordello - Immigraniada; `soft rock` and `eurodance` were removed from Ace of Base.

## How to decide a new label

Ask in this order; the first yes wins.

1. Is it a style you can assign to a song, and does it keep its meaning without any place name? It is a **genre**; give it parents, and add the ambiguous-name qualifier if a bare word is shared.
2. Does the same word qualify several base genres (progressive, dark, deep)? It is a **modifier**.
3. Does it say how the music is made (electronic, acoustic, instrumental, lo-fi)? It is a **medium**, not a genre.
4. Does it say what the music is for (dance, film score, military, children's)? It is a **purpose**, not a genre.
5. Does it name a tradition, scene or country (Latin, Berlin, Italo, K-)? It is a **tradition**: a group if it means nothing as a style, a modifier or an origin attribute if it qualifies a style.

### The etalon test

Can you name a reference (etalon) song of this genre? A rock song has one ("Johnny B. Goode", "Satisfaction"); house ("Your Love"), techno ("No UFOs"), trance ("For an Angel"), drum and bass ("Brown Paper Bag"), synthwave ("Nightcall") and ambient ("Music for Airports") each have one. Electronic has none, because any answer is really a house, techno or ambient track: so it is a group, not a genre.

- A genre has a reference song; a group does not.
- It is also the criterion for promoting a form to level 1: if you cannot name a reference track, it is a drawer, not a form.
- The reference songs are the genre's prototype songs ([task-0070](../tasks/task-0070.md), `prototypes`).

If none fits, it is probably a mood or a descriptor (epic, ethereal): leave it out of the vocabulary.

## Source policy for new genres

Decided 2026-10-24 (owner: "I'd consider RYM (Rate Your Music) as a reliable source for subgenres. If a subgenre is not there, it is questionable whether it is a subgenre."). A style becomes a vocabulary genre or subgenre only when it is attested by Rate Your Music, by Discogs styles or by Musicmap. Blog, guide, Last.fm and Wikipedia pages alone are not enough.

- Example: Rate Your Music lists Dark, Progressive, Forest and Full-On Psytrance directly under psytrance, so these are genres, and `psycore` is a genre because its own Rate Your Music page (236 releases, breadcrumb All genres > Dark Psytrance > Psycore) puts it under Dark Psytrance (level 4). Hi-Tech Psytrance is a child of Dark Psytrance there too (owner, 2026-10-24: breadcrumb Hi-Tech Psytrance > Dark Psytrance > Psytrance), so it sits beside Psycore at level 4: the tree is grouping, not lineage, and Rate Your Music decides the parent. `nitzhonot` is a genre because its own Rate Your Music page (549 releases, breadcrumb All genres > Goa Trance > Nitzhonot, owner 2026-10-24) puts it under Goa Trance (level 4); its later strands Greek Uplifting and Nitzhogoa are described there as strands of it, so they are not synonyms or genres. `zenonesque` ("a form of Progressive Psytrance", 48 releases) and `suomisaundi` ("a Finnish-based deviation of Psytrance", 175 releases) are genres because the owner found their Rate Your Music pages (2026-10-24); the breadcrumbs were not shown, so their parents (`progressive psytrance`, level 4, and `psytrance`, level 3) are inferred from that text. `twilight psytrance` is not a genre: Rate Your Music calls it a variant of full-on ("night full-on, also known as twilight psytrance"), so it is a synonym of `full-on psytrance`.
- Rate Your Music search page caveat: the search page for a genre name does not list sub-subgenres (psycore was dropped in beee034 for that reason and restored on 2026-10-24; nitzhonot, left out as unattested the same day, is attested on its own page); check the genre page itself, or its parent's page, before declaring a candidate unattested.
- Rate Your Music cannot be fetched by Claude (HTTP 403): when a check is needed, the owner pastes the Rate Your Music genre page.
- All research links with their trust level: [genre-research-sources.md](genre-research-sources.md).
- A candidate without attestation is recorded as a note, not added. Considered and left out so far (psytrance): twilight psytrance (a full-on variant), psybreaks, hard psy, psychill, psydub, psystep. Not on this list any more: nitzhonot, suomisaundi and zenonesque (genres since 2026-10-24, see the example above). Details: [genre-levels.md](genre-levels.md#psytrance-sub-genres-added-owner-2026-10-23).

## Grouping, not lineage

Decided 2026-10-24 (owner: "because we depict grouping, not lineage."). The genre tree (`parents[]`, levels, families) states what is classified under what; it does not claim historical descent. Goa trance under psytrance is fine although psytrance developed from goa trance. History and influence live in `related[]` and in eras, not in the parents. ADR-0038 has the dated amendment.

## Sources

- [Musicmap — The Genealogy and History of Popular Music Genres](https://musicmap.info/): reference for genre theory, history, genealogy and relationships between genres. Added at Alex's request, 2026-10-22.
- Verified here: https://en.wikipedia.org/wiki/Music_genre (first 100,000 of 123,544 characters read; paraphrased above).
- Not verified: Discogs help pages on genres and styles (blocked); the statements about iTunes/Apple Music, AllMusic and record stores are from memory.
- From memory, not verified here: Franco Fabbri, "A Theory of Musical Genres" (the Wikipedia article attributes the "socially accepted rules" definition to him).
- Our data: `server/data/genre_discogs.json`, `server/data/genre_levels.json`.

## Session decisions 2026-10-20

Owner decisions from the chat of 2026-10-20 ("Decided" = owner decision; "Default" = my pick, not confirmed; "Open" = see Open decisions).

| Id | Question | Decision |
|---|---|---|
| AN1 | Start the Electronic restructure? | Yes (task-0066) |
| AO | Draw groups on the map? | Open (recommended: dashed groups, EDM toggle) |
| AP | Split Folk, World & Country; Latin and World groups? | Open (recommended: yes) |
| AQ | The level 1 list | Open (recommended: adopt with AP) |
| AR | Modern classical on Final Frontier | Kept for now |
| AT | Reggae family: calypso and soca | Open, no recommendation |
| AX1 | Hardcore | Node `hardcore techno`, bare word a sound modifier, no synonym; implemented, not deployed |
| AY | Modifier filter | Later task ([task-0065](../tasks/task-0065.md)) |
| AD | Depth names | Default: computed, no "subgenre" or "microgenre" |
| BD1 | Flavour wording | Renamed modifier; kinds sound, mood, scene |
| BG | Boney M. - Sunny | Open (recommended: remove `reggae`) |
| BJ | 7 songs without a genre | Open |
| BK | 5 songs that stop being electronic | Open |
| BM | Electronic rock under synthwave | Open (recommended: no) |
| BP | Multi-parent genres | Open (recommended: keep all parents) |
| BQ | Discogs mirror and extras move too | Open (recommended: yes) |
| BR | Generic removal pass, not the hash-marked file | Open (recommended: yes) |
| BS | `/genres/graph` on the 11 colour families | Open (recommended: yes) |
| BT | witch house related to house | Decided: no link |
| BU | witch house synonyms | Default: drag, screwgaze, haunted house, crunk shoegaze |
| BV | witch house `related` | Default: synthwave, darksynth, vaporwave |
| BZ1 | jungle | Parents breakbeat and drum and bass, `related` reggae |
| CA | bass music | Not a form: it names a sound; genres redistributed |
| CB1 | Level 1 forms | house, techno, trance, drum and bass, breakbeat, ambient, eurodance, synthwave, experimental; industrial is a modifier |
| CC1 | synthpop level 1? | No: parents Pop and new wave, `related` disco, electronic by medium |
| CD1 | techno-pop | Synonyms `techno-pop`, `technopop` of synthpop; not techno |
| CE | Disco kin and electronic rock keep the medium? | Open (recommended: override flag) |
| CF/CG | uk garage as a form; bass-music genres | Open (recommended: proposal table) |
| groups | Electronic, EDM, Latin, World | Groups, never assigned; Electronic is not a genre |
| CW1 | Are genres arbitrary? | No: prototype categories, a clear centre and a soft border (like colour names); recorded here and on the About page |
| CY1 | Etalon test | A genre has a reference (etalon) song, a group does not; also the criterion for a level 1 form; the etalon songs are the prototype songs |
| axes | Four axes | Form, Medium, Purpose, Tradition (+ personal Mood) |
| epic | Is epic a genre? | No, removed |
| kinds | dark, deep, uplifting | mood |

## Useful external resources

- Rate Your Music genres (https://rateyourmusic.com/genres/): genre tree and descriptions.
- Musicmap (https://musicmap.info/): genealogy of popular music genres.
- Trance Classics Official (YouTube channel, https://www.youtube.com/@TranceClassicsOfficial): classic trance tracks.

## Musicmap super-genres compared with our level 1

Observation, not a decision. Source: the blueprint image and method note on https://musicmap.info/ (paraphrased).

### Musicmap's method

- More than 230 genres need one overarching framework; a super-genre is the parent family of a genre.
- Boundaries between super-genres are fluid; the map shows 23 of them, grouped into three primary clusters by colour.
  - Blue Note (blue): gospel and pioneers, blues, jazz.
  - Rock (yellow): rock 'n' roll, golden age, punk/wave, hardcore punk, alternative/indie, contemporary.
  - EDM/Dance (red): breakbeat, drum 'n' bass/jungle, hardcore techno, techno, house, trance.
  - Others: industrial and gothic, (heavy) metal, pop, country, rhythm 'n' blues, Jamaican/reggae, rap/hip-hop, downtempo/ambient.
- Blueprint arrows: straight line = important evolution, dotted = weaker influence, double arrow = strong mutual influence.
- Musicmap says UK garage and UK bass might become a 24th super-genre.
- EDM keeps its original broad meaning (all electronic dance music), as in our group EDM.
- The picture also shows faint FOLK, CLASSICAL and WORLD columns outside the 23.

### Our level 1 today

Genres: Blues, Classical, Funk / Soul, Hip Hop, Jazz, Pop, Reggae, Rock, and the promoted house, techno, trance, drum and bass, synthwave. Group: Others (holds the rest, including ambient, breakbeat, country, folk, gospel, latin and world genres).

### Comparison

| Musicmap super-genre | Our node today | Fit |
|---|---|---|
| Gospel and pioneers | `gospel`, parent Others, `related` Funk / Soul | Missing at level 1; provisional |
| Blues | Blues | Exact |
| Jazz | Jazz | Exact |
| Rock 'n' roll | `rock and roll`, under Rock | Level 2 |
| Golden age | none | No equivalent (a period, not a form) |
| Punk/wave | `punk` and `new wave`, under Rock | Level 2 |
| Hardcore punk | `hardcore punk`, under `punk` | Level 3 |
| Alternative/indie | `alternative rock`, `indie rock`, under Rock | Level 2 |
| Contemporary (rock) | Rock and its subgenres | Covered by Rock, no node |
| Breakbeat | `breakbeat`, parent Others | Missing at level 1 (CB1 lists it as a form) |
| Drum 'n' bass/jungle | drum and bass (level 1); `jungle` under `breakbeat`, `related` drum and bass | Exact; jungle sits on the breakbeat side |
| Hardcore techno | `hardcore techno`, parent Others, subfamily Techno | Missing; not under techno |
| Techno | techno | Exact |
| House | house | Exact |
| Trance | trance | Exact |
| Industrial and gothic | `industrial rock` and `goth rock` under Rock and `post-punk`; EBM under synthpop; industrial is a modifier | Missing |
| (Heavy) metal | `heavy metal` (synonym metal), under Rock | Level 2, not its own |
| Pop | Pop | Exact |
| Country | `country`, parent Others, provisional | Missing at level 1 |
| Rhythm 'n' blues | `rhythm and blues` under Funk / Soul and Blues; `contemporary r&b` under Funk / Soul | Merged into Funk / Soul |
| Jamaican/reggae | Reggae | Exact |
| Rap/hip-hop | Hip Hop | Exact |
| Downtempo/ambient | `ambient`, `downtempo`, `new age`, parent Others | Missing at level 1 |
| (outside the 23) Folk, Classical, World | `folk`, parent Others; Classical level 1; world genres under Others | Classical exact; Folk and World are Others |

Net: the gaps are mostly forms we hold in Others (gospel, country, breakbeat, hardcore techno, industrial and gothic, downtempo/ambient) plus metal buried under Rock (level 2).

### Ideas to consider (not decided)

1. Colour the level 1 nodes in three Musicmap-style clusters (blue note, rock, EDM/dance) plus a neutral rest.
2. Promote metal, industrial and downtempo/ambient to level 1 (each has a clear etalon, see the etalon test).
3. Use straight, dotted and double arrows for lineage in [task-0076](../tasks/task-0076.md): important evolution, weaker influence, strong mutual influence.

## Structure v2

Decided 2026-10-23 (ADR-0045, [task-0096](../tasks/task-0096.md)): a new hierarchy v2 is built beside v1 on Musicmap's terms. Super-genre = top-level family (level 1, no parents); cluster = a group of super-genres (primary: Blue Note, Rock, EDM / Dance), stored on the genre, not as a parent. Alex curates it; the first step is the six EDM / Dance super-genres (Breakbeat, Drum 'n' Bass, Hardcore, House, Techno, Trance) without children. v1 stays as is until a migration is decided.

### Structure v2

Built in parallel (2026-10-23): a separate structure v2 (`server/data/genres_v2.json`, `GET /genres/v2`, screen `#/genres2`, GEN-102) follows Musicmap's method with super-genres as top-level families and clusters as colour groups; v1 stays untouched, and everything below the top level is curated by Alex. First step: the six EDM / Dance super-genres without children.

Colours (2026-10-23, Alex: use the Musicmap colours for now): a cluster carries one `colour` and all its circles use it. In use: EDM / Dance red #D52633; Synthwave purple #881DF7 (the v1 synthwave hex, owner decision IK1, 2026-10-25) and Vapor pink #D0549A (the light value of the chart-2 token, owner decision IL2, 2026-10-25); neither is a Musicmap colour. Reserved for later clusters, not in the data yet: Blue Note blue #4364B3, Rock yellow #DCB250 (read from musicmap.info CSS; its blueprint paints each super-genre in a darker shade of the cluster colour, which we skip for now).
