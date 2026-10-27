# UX preferences (Alex)

Living rulebook of Alex's UI/UX expectations, so UI decisions can be taken from known preferences instead of asking.

**How to use.** Agents building or changing UI (web, iOS, macOS) read this file first. When Alex states a new UX preference, add it here in the same change (one line, rule + why/example + date). Rules marked "(inferred)" were demonstrated, not stated; confirm before treating them as hard. Look and tokens live elsewhere and are not repeated: [brand README](../brand/README.md), [web spec](../specs/web.md), [library spec](../specs/library.md), [genres spec](../specs/genres.md), [visualizer spec](../specs/visualizer.md).

## General principles

- Consistency: the same component and format everywhere in the app. Ex: reference-track rows must use the Library item's own styles, not a lookalike (2026-10-23).
- Reuse existing styles and tokens; no custom one-off CSS. Ex: copy button takes the earlier icon style (azure), "use exactly that one" (2026-10-19).
- Icons instead of long text buttons, with tooltip and `aria-label`. Ex: "too long - can use simply youtube picture", "use icon" (2026-10-27); Add to list as an icon button (2026-10-16).
- Compact and aesthetically tidy; no wasted air. Ex: "too much air on the sides" (2026-10-19), "make it more compact" (2026-10-21), "too tall" (2026-10-23).
- No duplicated info: do not show data already shown nearby. Ex: dates in the genre panel (2026-10-23), decade next to a year, Download in a menu next to a Download button (2026-10-14), duplicated genres (2026-10-27).
- Drop buttons that add no value. Ex: remove "..." and Add to list from Library rows, "Open source" button, Play/Pause in the info panel (2026-10-19, 2026-10-23).
- No editing UI where curation is done through Claude. Ex: "don't make these editable" for genre panel content (2026-10-23); matching songs to entities stays user-curated, i.e. by Alex with Claude (2026-10-21).
- Floating overlays and panels must not move or resize the content under them. Ex: genre infobox overlays without shifting circles (2026-10-23).
- Short labels. Ex: "Wiki", "RYM" (2026-10-23, 2026-10-27).
- Do not show field captions where the value is self-explanatory (2026-10-21).
- Text must stay readable: no truncation to unreadable widths, no jerking text (2026-10-21, 2026-10-27).
- Pointer: clickable titles show the hand cursor in every state (2026-10-16).
- Hover affordances: an action icon appears on hover at the item and hides when the pointer leaves; never wrap it onto its own line (2026-10-19, 2026-10-20).
- State must survive navigation (a colour that reverted after switching screens was reported as a bug) (2026-10-23).
- Auto-reveal context: Now Playing scrolls to the current song as if "show playing" were pressed (2026-10-20).
- Mouse wheel over the dock panel controls volume (2026-10-20).

## Forms

- One shared song form for Add and Edit, on every platform (CLAUDE.md, 2026-10).
- Title and Artist use the same token/pill field everywhere (per Alex, 2026-10-27).
- Narrow fields for short values, e.g. a 4-digit year (per Alex, 2026-10-27).
- One label per field; no repeated captions (per Alex, 2026-10-27).
- A summary bar sits directly next to the thing it summarises (per Alex, 2026-10-27).
- Advanced or rare controls are collapsed by default (per Alex, 2026-10-27).
- All inputs in a form share one height (version dropdown matched other edit boxes) (2026-10-16).
- Text boxes get an "x" clear button on the right edge (2026-10-19).
- Album artists and album title go on separate lines (2026-10-27).

## Lists and rows

- Library item style is the reference: cover, bold title, muted "Artist · year" (2026-10-23).
- Narrow widths: two-line rows instead of squeezing columns (inferred, from "track column even narrower", 2026-10-14).
- Durations right-aligned in one column; a linked row's length sits under the upper row's length (2026-10-27).
- Badges (BPM) sit inline with the metadata line like a genre, without a comma; or after the length (2026-10-19).
- Sub-rows (a song linked to an album track) are indented, with extra gap before the next group so groups read apart; unlink icon at the left (2026-10-27).
- Link/unlink are icons; the unlinked state shows the link icon (2026-10-27).
- Lists of items to review: read-only text labels by default, edit on demand via a pencil icon (2026-10-27).
- Songs not downloaded show a download icon in place of the queue mark, same styling (2026-10-19).

## Dialogs

- A click inside a dialog or popup must not close it; only the backdrop closes it (2026-10-27).
- Close button must not take a whole row (2026-10-19).
- Do not show the "to" part in range text where it adds nothing (2026-10-27).
- A multi-step add flow keeps Back state, auto-skips a step with nothing to decide (and shows it as skipped), shows a "Step n of m" status, and has one primary button on the last step (2026-10-27, Add album wizard).

## Maps and Genres screens

- Children spring-follow the parent with delay; they are not rigid (2026-10-23).
- Dragging a group moves it rigidly as a whole (parent plus cluster) (2026-10-23, "movement mechanics is amazing").
- Links are clipped at circle edges, never visible beneath a circle (2026-10-23).
- A dropped circle stays where it was dropped; selecting must not leave it glued to the pointer (2026-10-16, 2026-10-23).
- Circle colours are per cluster, taken from musicmap for now (2026-10-23).
- Arrows depict children (2026-10-20).
- Show structure (groups), keep detail low at first: "let's not put too much details yet" (2026-10-23).

## Info panels

- Content: short description, links (Wiki, RYM), eras timeline, reference tracks (2026-10-23).
- Description should help identify the genre, summarised short (about 10 lines) (2026-10-23).
- Reference-track captions are clickable and open the song infobox (2026-10-23).
- Reference tracks appear in the Library item format (2026-10-23).
- No decade, no country where the year or the list already says it (2026-10-16, 2026-10-21).
- Panel overlays; collapsed state must not leave a tall empty strip (2026-10-23).

## Process

- Alex sketches mockups and describes problems one by one; acknowledge only until he says go ("let me first describe you problems", 2026-10-27).
- "cpd" = commit, push, deploy.
- Lettered questions with numbered options; he answers like "A1" (global CLAUDE.md).
- Short replies: 50 words max (2026-10-23).
- Step-by-step knowledge building over bulk scraping; he wants to absorb it (2026-10-23).
- "Make your own decisions" (2026-10-27): decide from this file, then report briefly; do not ask about covered preferences.

## Open questions

1. Is "Artist · year" also the format in dialogs and info panels, or only in Library and reference rows?
2. Exact narrow-width breakpoint for switching to two-line rows.
3. Do tooltips on icon buttons also apply on touch (iOS), where there is no hover?
4. Which collapsed "advanced" controls exist today (candidates: identify from audio, version credits)?
5. Does "no editing UI" extend to song cards, or only genre/reference curation?
