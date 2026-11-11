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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import com.alexisayenko.audioplayer.android.AppGraph
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.data.AudioState
import com.alexisayenko.audioplayer.android.data.Outcome
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.logic.LibraryFacet
import com.alexisayenko.audioplayer.android.logic.SongDisplay
import com.alexisayenko.audioplayer.android.logic.formatTime
import com.alexisayenko.audioplayer.android.logic.source
import com.alexisayenko.audioplayer.android.logic.sourceLabel
import com.alexisayenko.audioplayer.android.logic.splitTag
import com.alexisayenko.audioplayer.android.logic.wikiDisplay
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSConfirmDialog
import com.alexisayenko.audioplayer.android.ui.DSIconButton
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.dsShadow
import com.alexisayenko.audioplayer.android.ui.dsSlab
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * What a row menu and Song details do to a song, with the words the toast says (the private helpers of the iOS
 * `LibraryView` and `SongDetailsView`). Server actions need a session; a download asks only when the server answers.
 */
@Stable
internal class SongActions(private val graph: AppGraph, private val scope: CoroutineScope, val toast: ToastState) {
    val signedIn: Boolean get() = graph.account.session.value != null

    fun playNext(song: Song) {
        graph.player.playNext(song)
        toast.show("Plays next")
    }

    fun enqueue(song: Song) {
        val added = graph.player.enqueue(listOf(song)) > 0
        toast.show(if (added) "Added to queue" else "Already in queue")
    }

    /** Download and Get audio: the library fetches on the server first when the audio is not there yet. */
    fun download(song: Song) {
        if (!signedIn) return
        if (graph.library.status.value.reachable == false) {
            toast.show("Can't reach the server")
            return
        }
        graph.library.download(song)
    }

    fun removeAudio(song: Song) {
        scope.launch {
            graph.library.removeAudio(song.id)
            toast.show("Removed from this phone")
        }
    }

    /** Deletes the song from the library and takes it out of the queue; false (and a toast) when the server said no. */
    suspend fun delete(song: Song): Boolean {
        val result = graph.library.delete(song.id)
        if (result is Outcome.Failed) {
            toast.show(result.message)
            return false
        }
        val queue = graph.player.state.value.queue
        queue.indices.reversed().filter { queue[it].id == song.id }.forEach(graph.player::removeFromQueue)
        return true
    }
}

@Composable
internal fun rememberSongActions(toast: ToastState): SongActions {
    val graph = LocalAppGraph.current
    val scope = rememberCoroutineScope()
    return remember(graph, toast) { SongActions(graph, scope, toast) }
}

/** The song's genres as written (the `genres` field, then `genre:` tags), each once. */
private fun genreNames(song: Song): List<String> {
    val tagged = song.tags.orEmpty().map(::splitTag).filter { it.key.lowercase() == "genre" }.map { it.value }
    return (song.genres.orEmpty() + tagged).filter { it.isNotEmpty() }.distinctBy { it.lowercase() }
}

private fun facetLabels(facet: LibraryFacet, song: Song): List<String> =
    facet.keys(song).filter { it != facet.unknown }.sorted().map(facet::label)

/** The first http(s) link the song came from. */
private fun sourceLink(song: Song): String? =
    (listOf(song.sourceURL) + song.sources.orEmpty().map { it.url }).filterNotNull()
        .firstOrNull { it.startsWith("https://", ignoreCase = true) || it.startsWith("http://", ignoreCase = true) }

/**
 * Song details as a bottom sheet (iOS `SongDetailsView`, AND-035): the cover, the title, "Artist · year" and the
 * version line, one main button (Play or Pause for a song on the phone, Download for one on the server; Download is
 * listed nowhere else, IOS-128), the facts (duration, BPM, album, genres, tags, country, the source and Wikipedia
 * links, which open outside the app), then Play next, Add to queue and Remove from phone, and Delete from library,
 * which asks first. Nothing is edited here: Edit closes the sheet and calls [onEdit].
 *
 * [song] is followed in the library, so the sheet shows the song as it is now and closes when the song is gone.
 * [onPlay] plays a song that is on the phone and not current; without it the song is played now and the queue stays.
 */
@Composable
fun SongDetailsSheet(song: Song, onDismiss: () -> Unit, onEdit: (Song) -> Unit, onPlay: ((Song) -> Unit)? = null) {
    val graph = LocalAppGraph.current
    val scope = rememberCoroutineScope()
    val toast = remember { ToastState() }
    val actions = rememberSongActions(toast)
    val songs by graph.library.songs.collectAsState()
    val phoneIds by graph.library.phoneIds.collectAsState()
    val transfers by graph.library.transfers.collectAsState()
    val session by graph.account.session.collectAsState()
    val player by graph.player.state.collectAsState()
    val live = songs.firstOrNull { it.id == song.id } ?: song
    val signedIn = session != null
    val onPhone = live.id in phoneIds
    val current = player.current?.id == live.id
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val present = songs.any { it.id == song.id }
    var seen by remember { mutableStateOf(present) }
    LaunchedEffect(present) { if (present) seen = true else if (seen) onDismiss() }

    DSSheet(onDismiss, fill = DS.colors.ground) { close ->
        Box {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = DS.Space.space4).padding(bottom = DS.Space.space4),
                verticalArrangement = Arrangement.spacedBy(DS.Space.space4),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit), contentAlignment = Alignment.Center) {
                    DSText("Song Details", Modifier.semantics { heading() }, DS.Type.headline, maxLines = 1)
                    DSIconButton(Icons.chevron, "Close", close, Modifier.align(Alignment.CenterStart), size = DS.Icon.iconNav)
                    if (signedIn) {
                        TextAction("Edit", { close(); onEdit(live) }, Modifier.align(Alignment.CenterEnd), color = DS.colors.accentInk)
                    }
                }
                val coverShape = dsRounded(DS.Radius.radiusCard)
                CoverImage(live.thumbnail, Modifier.size(DS.Component.detailsCover).dsSlab().clip(coverShape))
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(DS.Space.space1)) {
                    DSText(SongDisplay.titleLine(live), style = DS.Type.title, maxLines = 3, align = TextAlign.Center)
                    val subtitle = SongDisplay.subtitleLineUnbroken(live)
                    if (subtitle.isNotEmpty()) DSText(subtitle, style = DS.Type.body, color = DS.colors.inkMuted, maxLines = 2, align = TextAlign.Center)
                    val version = SongDisplay.versionLine(live)
                    if (version.isNotEmpty()) DSText(version, style = DS.Type.subhead, color = DS.colors.inkMuted, align = TextAlign.Center)
                }
                PrimaryButton(
                    song = live,
                    audio = graph.library.audioState(live).let { if (onPhone) AudioState.Phone else it },
                    transfer = transfers[live.id],
                    pausing = current && player.isPlaying,
                    signedIn = signedIn,
                    play = {
                        when {
                            current -> graph.player.toggle()
                            onPlay != null -> onPlay(live)
                            else -> graph.player.playNow(live)
                        }
                    },
                    download = { actions.download(live) },
                )
                Facts(live)
                val rows = buildList<@Composable () -> Unit> {
                    if (onPhone && !current) {
                        add { ActionRow("Play next", Icons.playPlus, { actions.playNext(live) }) }
                        add { ActionRow("Add to queue", Icons.listAdd, { actions.enqueue(live) }) }
                    }
                    if (signedIn && onPhone && !current && live.localOnly != true) {
                        add { ActionRow("Remove from phone", Icons.phoneOff, { confirmRemove = true }) }
                    }
                }
                Slab(rows)
                ActionRow(
                    "Delete from library", Icons.trash, { confirmDelete = true },
                    Modifier.padding(top = DS.Space.space4).padding(horizontal = DS.Space.space4), tint = DS.colors.powerText, enabled = !deleting,
                )
            }
            ToastHost(toast, Modifier.align(Alignment.TopCenter))
        }
        if (confirmRemove) {
            DSConfirmDialog(
                title = "Remove \"${live.title}\" from this phone?",
                message = "The song stays in your library. Tap Download to get it back.",
                confirm = "Remove from phone",
                onConfirm = { actions.removeAudio(live) },
                onDismiss = { confirmRemove = false },
            )
        }
        if (confirmDelete) {
            DSConfirmDialog(
                title = "Delete \"${live.title}\" from the library?",
                message = if (signedIn && live.localOnly != true) {
                    "Removes the song from your library, on the server and on this phone."
                } else {
                    "Removes the song and its audio from this phone."
                },
                confirm = "Delete from library",
                onConfirm = {
                    scope.launch {
                        deleting = true
                        val gone = actions.delete(live)
                        deleting = false
                        if (gone) close()
                    }
                },
                onDismiss = { confirmDelete = false },
            )
        }
    }
}

/** The one main button: Play or Pause on the phone, Download from the server, the state of a download, or "No audio yet". */
@Composable
private fun PrimaryButton(
    song: Song,
    audio: AudioState,
    transfer: Transfer?,
    pausing: Boolean,
    signedIn: Boolean,
    play: () -> Unit,
    download: () -> Unit,
) {
    val width = Modifier.widthIn(min = DS.Component.detailsCover)
    val moving = if (audio == AudioState.Phone) null else transfer
    when {
        audio == AudioState.Phone -> LibraryPrimaryButton(if (pausing) "Pause" else "Play", play, width, icon = if (pausing) Icons.pause else Icons.play)
        moving is Transfer.Failed -> LibraryPrimaryButton("Retry download", download, width, icon = Icons.download, enabled = signedIn)
        moving != null -> LibraryPrimaryButton(transferText(moving), {}, width, enabled = false)
        audio == AudioState.None -> LibraryPrimaryButton("No audio yet", {}, width, enabled = false)
        else -> LibraryPrimaryButton("Download to phone", download, width, icon = Icons.download, enabled = signedIn, label = "Download ${song.title} to phone")
    }
}

/** The read-only facts in one slab (iOS `facts`). */
@Composable
private fun Facts(song: Song) {
    val uri = LocalUriHandler.current
    val open: (String) -> Unit = { link -> runCatching { uri.openUri(link) } }
    val compact = buildList {
        song.duration?.takeIf { it > 0 }?.let { add("Duration" to formatTime(it)) }
        song.bpm?.let { add("BPM" to "${it.roundToInt()} BPM") }
    }
    val album = song.album?.takeIf { it.isNotEmpty() } ?: song.albums?.firstOrNull { it.isNotEmpty() }
    val genres = genreNames(song)
    val tags = facetLabels(LibraryFacet.Tags, song)
    val countries = facetLabels(LibraryFacet.Countries, song)
    val source = sourceLink(song)
    val wiki = listOfNotNull(song.wikipediaSong, song.wikipediaArtist, song.wikipediaAlbum).filter { it.startsWith("http", ignoreCase = true) }.distinct()
    val rows = buildList<@Composable () -> Unit> {
        if (compact.isNotEmpty()) {
            add {
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight).padding(vertical = DS.Space.space3),
                    horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
                ) {
                    for ((label, value) in compact) {
                        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(DS.Space.space1)) {
                            DSText(label, style = DS.Type.caption, color = DS.colors.inkMuted)
                            DSText(value, style = DS.Type.subhead)
                        }
                    }
                }
            }
        }
        if (album != null) add { Fact("Album", album) }
        if (genres.isNotEmpty()) add { Pills("Genres", genres) }
        if (tags.isNotEmpty()) add { Pills("Tags", tags) }
        if (countries.isNotEmpty()) add { Fact("Country", countries.joinToString(", ")) }
        if (source != null) {
            val name = sourceLabel(if ("soundcloud" in source.lowercase()) "soundcloud" else song.source)
            add { LinkFact("Source", name) { open(source) } }
        }
        for (link in wiki) add { LinkFact("Wikipedia", wikiDisplay(link)) { open(link) } }
    }
    Slab(rows)
}

/** Rows in one surface slab with hairlines between them (iOS `slab`); nothing when there are no rows. */
@Composable
private fun Slab(rows: List<@Composable () -> Unit>) {
    if (rows.isEmpty()) return
    Column(Modifier.fillMaxWidth().dsSlab().padding(horizontal = DS.Space.space4)) {
        rows.forEachIndexed { index, row ->
            if (index > 0) Hairline()
            row()
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight).padding(vertical = DS.Space.space2).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(label, style = DS.Type.subhead, color = DS.colors.inkMuted, maxLines = 1)
        DSText(value, Modifier.weight(1f), DS.Type.subhead, align = TextAlign.End)
    }
}

/** A fact that is a link out of the app: the value in accent ink with the external-link glyph. */
@Composable
private fun LinkFact(label: String, value: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight)
            .dsClickable(pressedAlpha = PRESSED, label = "Open in the browser", onClick = onClick)
            .clearAndSetSemantics { contentDescription = "$label, $value" }.padding(vertical = DS.Space.space2),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(label, style = DS.Type.subhead, color = DS.colors.inkMuted, maxLines = 1)
        DSText(value, Modifier.weight(1f), DS.Type.subhead, DS.colors.accentInk, maxLines = 2, align = TextAlign.End)
        DSIcon(Icons.externalLink, size = DS.Icon.iconInline, tint = DS.colors.accentInk)
    }
}

/** A fact whose values are read-only pills on the accent tint (iOS `pills`). */
@Composable
private fun Pills(title: String, values: List<String>) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight).padding(vertical = DS.Space.space2)
            .clearAndSetSemantics { contentDescription = "$title, ${values.joinToString(", ")}" },
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(title, style = DS.Type.subhead, color = DS.colors.inkMuted, maxLines = 1)
        FlowRow(
            Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(DS.Space.space2, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(DS.Space.space2),
        ) {
            for (value in values) {
                Box(
                    Modifier.defaultMinSize(minHeight = DS.Component.iconButton).background(DS.colors.accentTint, dsRounded(DS.Component.iconButton / 2))
                        .padding(horizontal = DS.Space.space3),
                    contentAlignment = Alignment.Center,
                ) { DSText(value, style = DS.Type.subhead, maxLines = 2, weight = FontWeight.W500) }
            }
        }
    }
}
