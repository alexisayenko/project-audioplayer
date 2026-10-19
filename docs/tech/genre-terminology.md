# Genre terminology and classification aspects

Decision record: ADR-0034 (terms) and ADR-0030 (levels and parents) in [decisions.md](decisions.md). Data shape: [genre-levels.md](genre-levels.md).

## Glossary

| Term | Meaning here |
|---|---|
| genre | Any node of our vocabulary, at any level. Subgenres are genres too. Shown in lowercase. |
| family | A level 1 genre (11 kept Discogs level-1 names, e.g. Rock, Electronic). Shown capitalised. This is what many catalogues call "the genre". |
| sub-genre, sub-sub-genre | Level 2 and level 3 genres, and deeper ones: there is no depth cap (ADR-0037); the interface says "genre" for every level. |
| `parents[]` | Subgenre-of links, an unordered set: all parents are equal, there is no primary parent (ADR-0037). A genre belongs to every family it descends from; its level is the shortest path depth to a family. A genre with several parents appears under each of them. |
| `related[]` | Influences and associations. Not parents: no effect on tree, counts or colours. |
| `fusion` | Flag on a blend of two or more families; with the map's "Fusion genres" switch off it keeps its genre parents (else the first family listed) and its other family parents are hidden. |
| subfamily | A label on Electronic genres (eight groups, e.g. House, Techno). Not a tree node; used for shading and filtering. |
| Discogs "style" | What Discogs calls a genre of ours at level 2 or 3. The API names `styles` and `style=` stay in code that talks to Discogs. |

## How "genre" is used elsewhere

- Wikipedia ([Music genre](https://en.wikipedia.org/wiki/Music_genre)): a genre is a conventional category grouping music by shared conventions and tradition (techniques, cultural context, themes, sometimes geographic origin). A subgenre is a narrower genre that keeps the parent's traits and adds its own; fusion genres blend two or more. So every level is a genre. The article also separates genre from form (violin concertos share a genre but differ in form) and notes that scholars disagree on genre versus style (one treats them as the same, another as distinct).
- Catalogues (Discogs, iTunes/Apple Music, AllMusic, record stores): "genre" is usually the broad top-level category (Rock, Jazz, Electronic) and "style" the finer categories below it. Discogs uses exactly "genres and styles". Could not be verified from Discogs' own help pages (HTTP 403 for automated fetches); we rely only on the data we hold: `server/data/genre_discogs.json` has 15 genres and about 500 styles.
- Ours (ADR-0030): every node is a genre; level 1 is a family; Discogs' "style" is our genre. We keep the song field name `genre` for any level.

## Aspects (axes) of describing music

Our own working model, not an established standard. Real taxonomies mix three main axes, and we add a fourth, subjective one:

| Axis | Question | Examples |
|---|---|---|
| **Genre by form** (the genre tree) | What kind of music is it? | house, techno, rock, hip hop, jazz |
| **Genre by medium** | What is it made with? | electronic, acoustic, orchestral, guitar |
| **Genre by purpose** | What is it for? | dance, film score, military, children's |
| **Mood** (subjective) | How does it feel? | melancholic, uplifting, epic, calm, dreamy, aggressive |

"Form" in "genre by form" is our design word for the lineage axis (how the music is built and what it descends from); "lineage" was the alternative word considered. In musicology "form" also means structure, such as twelve-bar blues or verse-chorus; that is not meant here. The user-facing label stays "genre". Geography or region, era and scene are secondary aspects that mix into the tree (Latin, European, Italian, 80s, rave). Other purposes seen: ceremonial, background, study.

Mood is the listener's subjective perception, so it is a personal tag that belongs to a listener, not shared vocabulary that a source such as Wikipedia can confirm. Some genre names already blend lineage with a mood word (uplifting trance, happy hardcore, dark ambient, dream pop, chillwave). "Epic" is a mood, which is why it never fitted as a genre. Mood would support finding music ("play something calm"). Not built: there is no data model yet.

Clarified examples: acoustic and instrumental are genre by medium (instrumental means no vocals; a cappella is the opposite). They are also version types in the data model: an acoustic or instrumental version of a song is a version of an original, whereas a piece that was always instrumental is not a version, it is a medium attribute. Lo-fi is a production style (medium). Beat is a format.

Consequences seen in Discogs' top level: some genres are purpose-based (Stage & Screen, Children's, Brass & Military, Non-Music; we dropped these four), some region-based (Latin; Folk, World, & Country; Reggae has an origin place), and Electronic is mainly defined by medium (electronic production). "Dance" (EDM) is a purpose. So families are uneven and Electronic is a super-umbrella (about 145 genres). Handling now: subfamily shading.

## Examples

- House and drum and bass are farther apart than jazz and blues, yet both sit under Electronic: the family is a medium, not a lineage.
- Latin and "European music" are region labels, not genres.
- Euro disco and eurodance are real genres despite the place in the name.
- Industrial (a genre) differs from industrial metal (a rock-metal blend that also has industrial as a parent).
- EDM is a purpose-led subset of electronic music; synthwave is electronic but not EDM.

## Open decisions

Facets versus families (proposed): promote the Electronic subfamilies to families and keep "electronic" and "dance" as separate facets (attributes), or keep the single Electronic family with subfamilies. Owner's current preference: finish the release first, then decide.

Next step: the facets (medium, purpose, mood) as attributes beside the genre tree; mood is a personal per-listener tag. Not built.

## Sources

- Verified here: https://en.wikipedia.org/wiki/Music_genre (first 100,000 of 123,544 characters read; paraphrased above).
- Not verified: Discogs help pages on genres and styles (blocked); the statements about iTunes/Apple Music, AllMusic and record stores are from memory.
- From memory, not verified here: Franco Fabbri, "A Theory of Musical Genres" (the Wikipedia article attributes the "socially accepted rules" definition to him).
- Our data: `server/data/genre_discogs.json`, `server/data/genre_levels.json`.
