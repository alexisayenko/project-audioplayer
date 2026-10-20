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
| `parents[]` | Subgenre-of links, an unordered set: all parents are equal, there is no primary parent (ADR-0037). A genre belongs to every family it descends from; its level is the shortest path depth to a family. A genre with several parents appears under each of them. |
| `related[]` | Influences and associations. Not parents: no effect on tree, counts or colours. |
| `fusion` | Flag on a blend of two or more families; with the map's "Fusion genres" switch off it keeps its genre parents (else the first family listed) and its other family parents are hidden. |
| subfamily | A label on Electronic genres (eight groups, e.g. House, Techno). Not a tree node; used for shading and filtering. Candidate to become families (AN). |
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
- Today `edm` is still a genre of the Electronic family in the data (DY1) and `electronic` is still a pill that can sit on songs. Both go away with AN.

## Axes

Decided 2026-10-20. Our own working model, not an established standard: a song is described along four axes. The tree is one of them.

| Axis | Question | Examples | State |
|---|---|---|---|
| **Form** (the genre tree) | Which style is it? | house, rock, synthpop | Built (the tree) |
| **Medium** | How is it made? | electronic, acoustic, instrumental, lo-fi | Not built; to be derived from the tree (see AN) |
| **Purpose / role** | What is it for? | dance, film score, military, children's | Not built; the EDM flag is the first case |
| **Tradition** | Which tradition or scene? Called "geography" before | Western, Latin, Chinese, Indian, Celtic; scene or city: Berlin, Detroit, Chicago; country: Italo, French, K- | Partly: country values feed the existing Countries filter, scene words appear as modifiers |
| **Mood** | How does it feel? | personal, per listener | Not built; not shared vocabulary |

Notes:

- Form is our design word for the lineage axis (how the music is built and what it descends from). In musicology "form" also means structure, such as twelve-bar blues; that is not meant here. The user-facing label stays "genre".
- **Modifiers are not an axis.** They qualify a genre on the Form axis (see Modifiers).
- Tradition: a country value (Italy, France, Korea) is the same data as the song's country and feeds the Countries filter. A scene value (Berlin, Baltimore) that shows up in genre names is carried by the `scene` kind of the modifiers.
- Mood is the listener's subjective perception: a personal tag, not vocabulary that Wikipedia can confirm. The shared modifiers of kind `mood` (dark, deep, uplifting) are a different thing: genre-bound words for named sub-styles.
- Medium: acoustic and instrumental are medium (instrumental means no vocals; a cappella is the opposite). They are also version types in the data model: an acoustic or instrumental version of a song is a version of an original, whereas a piece that was always instrumental is a medium attribute, not a version. Lo-fi is a production aesthetic (medium); beat is a format.
- Other purposes seen: ceremonial, background, study. Discogs' top level mixes axes: purpose (Stage & Screen, Children's, Brass & Military, Non-Music; we dropped these four on 2026-10-18), region (Latin; Folk, World, & Country; Reggae has an origin place) and medium (Electronic). That is why our families are uneven.

## Tests and rules

All decided 2026-10-20 (owner), except where a date is given.

1. **Genre-versus-place test.** If the label keeps its meaning once the place name is removed, it is a genre with an origin: italo disco is a disco style with its own sound; Eurodance, French house and K-pop likewise. If it means nothing without the place, it is a tradition or a group: Latin, World, Western.
2. **Modifier test.** If the same word qualifies different base genres, it is a modifier, not a genre: progressive house and progressive trance; dark psytrance; deep house; acid house.
3. **Ambiguous-name rule.** When a bare word is used by two different styles, the node carries the qualifier: hardcore punk versus hardcore techno. OPEN (AX): rename the node `hardcore` to `hardcore techno`.
4. **Descriptors are not genres.** Epic (removed 2026-10-20, like lo-fi), instrumental and acoustic (medium), ethereal, industrial as a mood word. They go to the axis they belong to, or nowhere.
5. **Several parents, all equal** (ADR-0037). The `fusion` flag (needs two families; 14 genres today) controls whether the second family colours the genre on the map unless the Fusion toggle is on. "Two scenes" genres (disco, dub, noise) always show under all their families.
6. **Wikipedia is the evidence for assignments.** The song's page first, else the artist's page; artist-level genres do not count for a remix or a single track. The patterns that drove the clean-up (artist-level genre on a remix or cover, ambiguous name, family mismatch) are in [library-genre-cleanup.md](library-genre-cleanup.md).

## Modifiers

Decided: renamed from "flavours" on 2026-10-20 (BD1). A modifier qualifies a genre on the Form axis and is never assigned to a song alone.

| Kind | Meaning | Modifiers |
|---|---|---|
| sound | sonic technique or production feature | acid, progressive, melodic, vocal, hard, minimal, tech |
| mood | atmosphere shared by a named sub-style | dark, deep, uplifting |
| scene | a place or scene; a value of the Tradition axis that appears in genre names | baltimore, berlin |

The API serves `modifiers` and, for one release, the deprecated alias `flavours` (GEN-082). Built: the block is defined and served, but no genre carries a modifier list yet (the proposed assignment is in [genre-flavours-proposal.md](genre-flavours-proposal.md)). Details: [genre-levels.md](genre-levels.md#modifiers).

## Current state (Built, verified against `server/data/genre_levels.json` on 2026-10-20)

- 534 genres in 11 families: Blues, Classical, Electronic, Folk World & Country, Funk / Soul, Hip Hop, Jazz, Latin, Pop, Reggae, Rock. The data calls them families; under the model above Electronic, Latin and Folk, World & Country are groups or mixed.
- Electronic 146 members (54 at level 2, 87 at level 3, 5 at level 4: dark psytrance, forest psytrance, full-on psytrance, goa trance, progressive psytrance). Rock 123 (50, 73, 0). Memberships count a genre in every family it descends from.
- The level is computed from the shortest path through all parents. Four levels exist in the data.
- Eight Electronic subfamilies: House, Techno, Trance, Breaks & bass, Synth & wave, Ambient & downtempo, Experimental industrial & noise (the data name is "Experimental, industrial & noise"), Eurodance & disco.
- Library mix, for scale (the owner's library, 2026-10-20): 0 country songs, about 8 folk, 4 world, 2 classical.
- Related and not built: [task-0064](../tasks/task-0064.md) (song and genre distance, similar songs, tag-outlier check), the EDM purpose flag, the medium facet.

## Open decisions

Each item has the question and the recommended option. None is decided; docs come first, data changes follow as a reviewable change.

- **AN. Start the data change?** Promote the eight Electronic subfamilies to families, drop the `electronic` genre pill from songs, derive the medium facet. Recommended: yes, docs first (this document and ADR-0038), then a reviewable data change.
- **AO. Groups on the map.** Draw Electronic as a group node, drawn differently from genres, with EDM as a toggle that highlights its genres. Recommended: yes.
- **AP. Split Folk, World, & Country.** Folk and Country become genres, World becomes a group, Latin becomes a group, and genres get an `origin` attribute. Recommended: yes. Note: the library has 0 country songs, about 8 folk, 4 world.
- **AQ. The level 1 list.** Genres: Blues, Classical, Country, Folk, Funk / Soul, Hip Hop, Jazz, Pop, Reggae, Rock. Groups: Electronic, Latin, World. Pop and Classical are the weakest as styles. Recommended: adopt with AP.
- **AR. Modern classical on Final Frontier.** Kept as it is for now.
- **AT. Reggae family.** Calypso and soca are Trinidadian, not Jamaican. Options: 1. keep; 2. rename the family "Reggae & Caribbean"; 3. move them. No recommendation yet.
- **AX. Hardcore rename.** Rename the node `hardcore` to `hardcore techno` (rule 3). Recommended: yes.
- **AY. Modifier filter.** A Library filter and a map highlight by modifier. Later task.
- **AD. Level-4 depth.** Keep depth computed; do not introduce the names "subgenre" or "microgenre". Recommended: keep. Five level-4 genres exist today.

## How to decide a new label

Ask in this order; the first yes wins.

1. Is it a style you can assign to a song, and does it keep its meaning without any place name? It is a **genre**; give it parents, and add the ambiguous-name qualifier if a bare word is shared.
2. Does the same word qualify several base genres (progressive, dark, deep)? It is a **modifier**.
3. Does it say how the music is made (electronic, acoustic, instrumental, lo-fi)? It is a **medium**, not a genre.
4. Does it say what the music is for (dance, film score, military, children's)? It is a **purpose**, not a genre.
5. Does it name a tradition, scene or country (Latin, Berlin, Italo, K-)? It is a **tradition**: a group if it means nothing as a style, a modifier or an origin attribute if it qualifies a style.

If none fits, it is probably a mood or a descriptor (epic, ethereal): leave it out of the vocabulary.

## Sources

- Verified here: https://en.wikipedia.org/wiki/Music_genre (first 100,000 of 123,544 characters read; paraphrased above).
- Not verified: Discogs help pages on genres and styles (blocked); the statements about iTunes/Apple Music, AllMusic and record stores are from memory.
- From memory, not verified here: Franco Fabbri, "A Theory of Musical Genres" (the Wikipedia article attributes the "socially accepted rules" definition to him).
- Our data: `server/data/genre_discogs.json`, `server/data/genre_levels.json`.
