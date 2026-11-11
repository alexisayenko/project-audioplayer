package com.alexisayenko.audioplayer.android.ui.playback

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.R
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.playback.RepeatMode
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSColorsLight
import com.alexisayenko.audioplayer.android.ui.DSConfirmDialog
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.dsSlab
import com.alexisayenko.audioplayer.android.ui.shell.LocalDockHeight
import com.alexisayenko.audioplayer.android.ui.shell.ScreenHeader

/**
 * The Now playing screen (iOS `PlaybackView`, AND-036): the cover with the title and artist on it, the genre chips,
 * the seek bar, the transport tray and the queue. It shows the player's state and sends every action to the
 * `PlayerController`; it holds no playback logic of its own.
 */
@Composable
fun PlaybackScreen() = PlaybackContent(rememberLazyListState())

/** [PlaybackScreen] over a given list state, so a test can open it scrolled to the queue. */
@Composable
internal fun PlaybackContent(listState: LazyListState) {
    val player = LocalAppGraph.current.player
    val state by player.state.collectAsState()
    val song = state.current
    val hasSong = song != null
    // As iOS at accessibility text sizes: a small cover with the title under it, so long titles are never cut.
    val stacked = LocalDensity.current.fontScale > 1.3f
    val genres = remember(song?.genres) { song?.genres.orEmpty().filter { it.isNotBlank() }.distinct().sortedWith(String.CASE_INSENSITIVE_ORDER) }
    val drag = remember { QueueDrag() }
    var confirmClear by remember { mutableStateOf(false) }
    val gutter = Modifier.padding(horizontal = DS.Space.space4)
    val bottom = DS.Space.space4 + LocalDockHeight.current + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    LazyColumn(
        Modifier.fillMaxSize().background(DS.colors.ground).statusBarsPadding(),
        state = listState,
        contentPadding = PaddingValues(top = DS.Space.space2, bottom = bottom),
    ) {
        item(key = "header") { ScreenHeader("Now playing", gutter) }
        item(key = "cover") { CoverBlock(song, stacked, gutter.padding(top = DS.Space.space4)) }
        if (genres.isNotEmpty()) item(key = "genres") { GenreChips(genres, Modifier.padding(top = DS.Space.space4)) }
        item(key = "progress") { SeekBar(state.positionMs, state.durationMs, hasSong, player::seekTo, gutter.padding(top = DS.Space.space2)) }
        item(key = "transport") {
            TransportTray(
                playing = state.isPlaying,
                enabled = hasSong,
                onPrevious = player::previous,
                onBack = { player.skipBy(-SKIP_MS) },
                onToggle = player::toggle,
                onForward = { player.skipBy(SKIP_MS) },
                onNext = player::next,
                modifier = gutter.padding(top = DS.Space.space4),
            )
        }
        item(key = "queue") {
            QueueHeader(
                count = state.queue.size,
                shuffle = state.shuffle,
                repeat = state.repeat,
                enabled = hasSong,
                onShuffle = { player.setShuffle(!state.shuffle) },
                onRepeat = { player.setRepeat(state.repeat.next) },
                onClear = { confirmClear = true },
                modifier = gutter.padding(top = DS.Space.space4),
            )
        }
        itemsIndexed(state.queue, key = { index, item -> queueKey(index, item) }, contentType = { _, _ -> "queue" }) { index, item ->
            QueueRow(
                song = item,
                index = index,
                count = state.queue.size,
                current = index == state.index,
                drag = drag,
                onJump = { player.jumpTo(index) },
                onRemove = { player.removeFromQueue(index) },
                onMove = player::moveQueueItem,
                onDragStart = { drag.start(index, listState.layoutInfo.visibleItemsInfo) },
                onDrag = { drag.move(it, listState.layoutInfo.visibleItemsInfo) },
                modifier = gutter,
            )
        }
    }

    if (confirmClear) {
        DSConfirmDialog(
            title = "Clear the queue?",
            message = "Removes the up-next songs. The current song keeps playing.",
            confirm = "Clear queue",
            onConfirm = player::clearQueue,
            onDismiss = { confirmClear = false },
        )
    }
}

/** The step of the two skip keys; the same 10 seconds as the notification's skip commands (AND-061). */
private const val SKIP_MS = 10_000L

private val RepeatMode.next: RepeatMode
    get() = when (this) {
        RepeatMode.Off -> RepeatMode.All
        RepeatMode.All -> RepeatMode.One
        RepeatMode.One -> RepeatMode.Off
    }

/** "Artist · year", the line under a title on the cover and in a queue row. */
internal fun Song.playbackSubtitle(): String =
    listOfNotNull(artist.takeIf { it.isNotBlank() }, (releaseYear ?: year)?.toString()).joinToString(" · ")

/**
 * The cover with the title block on a dark gradient at its bottom (iOS `PlaybackView.cover`); the record shows when
 * the song has no cover or nothing is loaded. With large text the cover is small and the title sits under it.
 */
@Composable
private fun CoverBlock(song: Song?, stacked: Boolean, modifier: Modifier = Modifier) {
    val vinyl = DS.colors.vinyl
    val spoken = song?.let { listOf(it.title, it.playbackSubtitle()).filter(String::isNotEmpty).joinToString(", ") } ?: "Nothing playing"
    Column(
        modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(DS.Space.space3),
    ) {
        Box(
            Modifier.align(Alignment.CenterHorizontally).widthIn(max = if (stacked) DS.Space.hit * 3 + DS.Space.space2 else DS.Space.hit * 10)
                .fillMaxWidth().aspectRatio(1f).dsSlab(DS.Radius.radiusCard).clip(dsRounded(DS.Radius.radiusCard)),
        ) {
            if (song?.thumbnail.isNullOrEmpty()) {
                Image(painterResource(R.drawable.vinyl_record), contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            } else {
                CoverImage(song?.thumbnail, Modifier.fillMaxSize())
            }
            if (!stacked) {
                TitleBlock(
                    song,
                    onCover = true,
                    Modifier.align(Alignment.BottomStart).fillMaxWidth()
                        .background(Brush.verticalGradient(0f to vinyl.copy(alpha = 0f), 0.4f to vinyl.copy(alpha = 0.65f), 1f to vinyl.copy(alpha = 0.9f)))
                        .padding(start = DS.Space.space4, end = DS.Space.space4, top = 56.dp, bottom = 14.dp),
                )
            }
        }
        if (stacked) TitleBlock(song, onCover = false)
    }
}

/** Title and "Artist · year" (iOS `titleBlock`): paper-coloured on the cover in both themes, ink below it. */
@Composable
private fun TitleBlock(song: Song?, onCover: Boolean, modifier: Modifier = Modifier) {
    val paper = DSColorsLight.surface
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        DSText(song?.title ?: "Nothing playing", style = DS.Type.title, color = if (onCover) paper else DS.colors.ink, maxLines = if (onCover) 3 else Int.MAX_VALUE)
        DSText(
            song?.playbackSubtitle() ?: "Pick a song in Library.",
            style = DS.Type.body,
            color = if (onCover) paper.copy(alpha = 0.8f) else DS.colors.inkMuted,
            maxLines = if (onCover) 2 else Int.MAX_VALUE,
        )
    }
}

/** The current song's genres as read-only pills in one scrolling line (iOS `genreChips`). */
@Composable
private fun GenreChips(genres: List<String>, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = DS.Space.space4)
            .clearAndSetSemantics { contentDescription = "Genres: ${genres.joinToString(", ")}" },
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
    ) {
        genres.forEach { genre ->
            Box(
                Modifier.defaultMinSize(minHeight = DS.Control.control).background(DS.colors.accentTint, CircleShape).padding(horizontal = DS.Space.space3),
                contentAlignment = Alignment.Center,
            ) { DSText(genre, style = DS.Type.subhead, color = DS.colors.accentInk, maxLines = 1, weight = FontWeight.W500) }
        }
    }
}

/** What TalkBack says after "Repeat" (iOS `RepeatMode.spokenName`). */
internal val RepeatMode.spokenName: String
    get() = when (this) {
        RepeatMode.Off -> "off"
        RepeatMode.All -> "whole list"
        RepeatMode.One -> "one song"
    }

/** The role of a two-state key such as Shuffle. */
internal val ToggleRole = Role.Switch
