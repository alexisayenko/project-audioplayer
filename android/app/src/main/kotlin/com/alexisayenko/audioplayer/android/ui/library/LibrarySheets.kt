@file:OptIn(ExperimentalLayoutApi::class)

package com.alexisayenko.audioplayer.android.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import com.alexisayenko.audioplayer.android.logic.LibraryFacet
import com.alexisayenko.audioplayer.android.logic.LibraryFacetValue
import com.alexisayenko.audioplayer.android.logic.LibraryMatching
import com.alexisayenko.audioplayer.android.logic.LibraryQuery
import com.alexisayenko.audioplayer.android.logic.LibrarySort
import com.alexisayenko.audioplayer.android.logic.SongDisplay
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.onStrong
import com.alexisayenko.audioplayer.android.ui.strongFill
import java.util.Locale

// The bottom sheets of the Library: the filter pickers (iOS `LibraryFilterSheet`), Sort by (iOS `LibrarySortSheet`),
// the actions behind the ellipsis (an iOS menu) and the long-press menu of a row (an iOS context menu).

/** The picked values of [facet] first, then most used first, "Unknown" last; decades keep their order (as the iOS sheet). */
private fun frozenOrder(facet: LibraryFacet, values: List<LibraryFacetValue>, selection: Set<String>): List<LibraryFacetValue> {
    if (facet == LibraryFacet.Era) return values
    return values.sortedWith { a, b ->
        when {
            a.id == b.id -> 0
            a.id == facet.unknown -> 1
            b.id == facet.unknown -> -1
            (a.id in selection) != (b.id in selection) -> if (a.id in selection) -1 else 1
            a.count != b.count -> b.count.compareTo(a.count)
            else -> LibraryMatching.compare(a.label, b.label)
        }
    }
}

/**
 * The picker of one filter chip (iOS `LibraryFilterSheet`): the heading with Clear and Done, how many values exist
 * and are picked, how many songs match right now, a search field (not for decades) and the values as chips with
 * their counts. Decades are grouped by century. The order is fixed when the sheet opens, so picking a value never
 * moves a chip under the finger. [onQuery] gets the query with a value toggled or the facet cleared.
 */
@Composable
internal fun LibraryFilterSheet(
    facet: LibraryFacet,
    songs: List<Song>,
    query: LibraryQuery,
    matchCount: Int,
    onQuery: (LibraryQuery) -> Unit,
    onDismiss: () -> Unit,
) {
    val values = remember(facet) { frozenOrder(facet, facet.values(songs), query.selection) }
    var search by rememberSaveable(facet) { mutableStateOf("") }
    val picked = query.selected(facet)
    val needle = LibraryMatching.folded(search)
    val visible = if (needle.isEmpty()) values else values.filter { needle in LibraryMatching.folded(it.label) }
    val toggle: (LibraryFacetValue) -> Unit = { onQuery(query.toggle(it.id)) }

    DSSheet(onDismiss, tall = facet != LibraryFacet.Era) { close ->
        Column(Modifier.padding(horizontal = DS.Space.space4), verticalArrangement = Arrangement.spacedBy(DS.Space.space1)) {
            SheetHeader(facet.title) {
                TextAction("Clear", { onQuery(query.copy(selection = query.selection - picked)) }, enabled = picked.isNotEmpty())
                TextAction("Done", close)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DS.Space.space3)) {
                DSText("${values.size} ${facet.noun(values.size)} · ${picked.size} selected", Modifier.weight(1f), DS.Type.caption, DS.colors.inkMuted)
                DSText(
                    if (matchCount == 1) "1 song matches" else "$matchCount songs match",
                    style = DS.Type.caption.copy(fontFeatureSettings = "tnum"), color = DS.colors.inkMuted,
                )
            }
        }
        Column(
            Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                .padding(horizontal = DS.Space.space4).padding(top = DS.Space.space3, bottom = DS.Space.space4),
            verticalArrangement = Arrangement.spacedBy(DS.Space.space2),
        ) {
            if (facet != LibraryFacet.Era) {
                val nouns = facet.noun(2)
                LibrarySearchField(search, { search = it }, placeholder = "Search $nouns", label = "Search $nouns", minHeight = DS.Component.fieldHeight)
            }
            when {
                visible.isEmpty() -> DSText("Nothing here yet.", Modifier.padding(vertical = DS.Space.space2), DS.Type.body, DS.colors.inkMuted)
                facet == LibraryFacet.Era -> EraBlocks(facet, visible, picked, toggle)
                else -> ValueChips(facet, visible, picked, toggle)
            }
        }
    }
}

private fun eraYear(facet: LibraryFacet, value: LibraryFacetValue): Int? = value.id.drop(facet.prefix.length).toIntOrNull()

/** Decades under their century ("19xx", "20xx"), oldest first, then "Unknown" (iOS `eraBlocks`). */
@Composable
private fun EraBlocks(facet: LibraryFacet, values: List<LibraryFacetValue>, picked: Set<String>, toggle: (LibraryFacetValue) -> Unit) {
    val dated = values.filter { eraYear(facet, it) != null }.groupBy { eraYear(facet, it)!! / 100 }
    val unknown = values.filter { eraYear(facet, it) == null }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(DS.Space.space3)) {
        for (century in dated.keys.sorted()) {
            Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space1)) {
                DSText(
                    "${century}xx", Modifier.semantics { heading() },
                    DS.Type.subhead.copy(textDecoration = TextDecoration.Underline), DS.colors.inkMuted,
                )
                ValueChips(facet, dated.getValue(century).sortedBy { eraYear(facet, it) }, picked, toggle)
            }
        }
        if (unknown.isNotEmpty()) ValueChips(facet, unknown, picked, toggle)
    }
}

@Composable
private fun ValueChips(facet: LibraryFacet, values: List<LibraryFacetValue>, picked: Set<String>, toggle: (LibraryFacetValue) -> Unit) {
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
        for (value in values) {
            val year = eraYear(facet, value)
            val era = facet == LibraryFacet.Era && year != null
            ValueChip(
                text = if (era) String.format(Locale.ROOT, "the %02ds", (year!! % 100 + 100) % 100) else value.label,
                spoken = if (era) "${year}s" else value.label,
                count = value.count,
                on = value.id in picked,
                onClick = { toggle(value) },
            )
        }
    }
}

/**
 * A value of a filter with its song count (the chip of the iOS `LibraryFilterSheet`): a sunken pill, the strong fill
 * when picked. The pill is 36dp tall in a 44dp target, so rows of chips sit 8dp apart.
 */
@Composable
private fun ValueChip(text: String, spoken: String, count: Int, on: Boolean, onClick: () -> Unit) {
    val colors = DS.colors
    Box(
        Modifier.defaultMinSize(minHeight = DS.Space.hit).dsClickable(pressedAlpha = PRESSED, onClick = onClick).clearAndSetSemantics {
            contentDescription = "$spoken, $count ${if (count == 1) "song" else "songs"}"
            selected = on
            role = Role.Button
        },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.defaultMinSize(minHeight = DS.Control.control).background(if (on) colors.strongFill else colors.surfaceSunken, CircleShape)
                .padding(horizontal = DS.Space.space3),
            horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DSText(text, Modifier.weight(1f, fill = false), DS.Type.subhead, if (on) colors.onStrong else colors.ink, maxLines = 1, weight = if (on) FontWeight.W600 else null)
            DSText("$count", style = DS.Type.caption, color = if (on) colors.onStrong else colors.inkMuted, maxLines = 1)
        }
    }
}

private val LibrarySort.icon
    get() = when (this) {
        LibrarySort.Newest -> Icons.clock
        LibrarySort.Title -> Icons.textLetters
        LibrarySort.Artist -> Icons.account
        LibrarySort.Year -> Icons.calendar
        LibrarySort.Bpm -> Icons.metronome
        LibrarySort.Length -> Icons.timer
        LibrarySort.Listened -> Icons.headphones
    }

/**
 * "Sort by" (iOS `LibrarySortSheet`): the seven orders, the current one in accent ink with a check. "Last listened"
 * needs the listening data and is disabled, with the reason under it, while [listeningAvailable] is false.
 */
@Composable
internal fun LibrarySortSheet(query: LibraryQuery, listeningAvailable: Boolean, listeningNote: String, onChoose: (LibrarySort) -> Unit, onDismiss: () -> Unit) {
    val colors = DS.colors
    DSSheet(onDismiss) { close ->
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = DS.Space.space4).padding(bottom = DS.Space.space4)) {
            SheetHeader("Sort by")
            LibrarySort.entries.forEachIndexed { index, criterion ->
                val current = query.sort == criterion
                val disabled = criterion == LibrarySort.Listened && !listeningAvailable
                if (index > 0) Hairline()
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight)
                        .then(if (disabled) Modifier else Modifier.dsClickable(pressedAlpha = PRESSED) { onChoose(criterion); close() })
                        .semantics(mergeDescendants = true) {
                            selected = current
                            if (disabled) disabled()
                        },
                    horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DSIcon(criterion.icon, size = DS.Icon.iconNav, tint = if (disabled) colors.inkFaint else if (current) colors.accentInk else colors.inkMuted)
                    Column(Modifier.weight(1f).padding(vertical = DS.Space.space1)) {
                        DSText(criterion.label, style = DS.Type.body, color = if (disabled) colors.inkMuted else colors.ink, weight = if (current) FontWeight.W600 else null)
                        if (disabled) DSText(listeningNote, style = DS.Type.caption, color = colors.inkMuted)
                    }
                    if (current) DSIcon(Icons.check, size = DS.Icon.iconNav, tint = colors.accentInk)
                }
            }
        }
    }
}

/** The actions behind the ellipsis of the controls line (the iOS "Library actions" menu, IOS-031). */
@Composable
internal fun LibraryActionsSheet(
    canPlay: Boolean,
    canShowPlaying: Boolean,
    narrowing: Boolean,
    onPlayAll: () -> Unit,
    onShowPlaying: () -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit,
) {
    DSSheet(onDismiss) { close ->
        Column(Modifier.padding(horizontal = DS.Space.space4).padding(bottom = DS.Space.space4)) {
            ActionRow("Play all matched", Icons.playOutline, { close(); onPlayAll() }, enabled = canPlay)
            Hairline()
            ActionRow("Show currently playing song", Icons.crosshair, { close(); onShowPlaying() }, enabled = canShowPlaying)
            Hairline()
            ActionRow("Clear all filters", Icons.clear, { close(); onClear() }, enabled = narrowing)
        }
    }
}

/** One entry of the long-press menu. */
internal class SongMenuItem(val title: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val destructive: Boolean = false, val run: () -> Unit)

/**
 * The long-press menu of a row as a bottom sheet (the iOS context menu, AND-032): the song it is about, then its
 * actions; a destructive one is in the power colour.
 */
@Composable
internal fun SongMenuSheet(song: Song, items: List<SongMenuItem>, onDismiss: () -> Unit) {
    DSSheet(onDismiss) { close ->
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = DS.Space.space4).padding(bottom = DS.Space.space4)) {
            Row(
                Modifier.fillMaxWidth().padding(bottom = DS.Space.space3).semantics(mergeDescendants = true) { heading() },
                horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CoverImage(song.thumbnail, Modifier.size(DS.Component.coverSm).clip(dsRounded(DS.Radius.radiusSm)))
                Column(Modifier.weight(1f)) {
                    DSText(SongDisplay.titleLine(song), style = DS.Type.headline, maxLines = 2)
                    val subtitle = SongDisplay.subtitleLineUnbroken(song)
                    if (subtitle.isNotEmpty()) DSText(subtitle, style = DS.Type.subhead, color = DS.colors.inkMuted, maxLines = 1)
                }
            }
            for (item in items) {
                Hairline()
                ActionRow(item.title, item.icon, { close(); item.run() }, tint = if (item.destructive) DS.colors.powerText else DS.colors.ink)
            }
        }
    }
}
