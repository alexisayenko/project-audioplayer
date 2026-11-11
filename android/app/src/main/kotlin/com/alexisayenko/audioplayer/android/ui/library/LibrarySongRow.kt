package com.alexisayenko.audioplayer.android.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import com.alexisayenko.audioplayer.android.data.AudioState
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.logic.SongDisplay
import com.alexisayenko.audioplayer.android.logic.formatTime
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSColorsLight
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import kotlin.math.ceil

/** The words a download in flight shows in a row and in Song details (AND-033). */
internal fun transferText(transfer: Transfer, nowMs: Long = System.currentTimeMillis()): String = when (transfer) {
    Transfer.Waiting -> "Waiting…"
    is Transfer.Fetching -> transfer.progress?.let { "Fetching ${percent(it)}%" } ?: "Fetching…"
    is Transfer.Copying -> "Downloading ${percent(transfer.progress)}%"
    is Transfer.Paused -> "Paused · ${minutesLeft(transfer.resumeAtMs, nowMs)} min"
    is Transfer.Failed -> "Retry"
}

/** The same state for TalkBack, as a part of the row's label. */
internal fun transferSpoken(transfer: Transfer, nowMs: Long = System.currentTimeMillis()): String = when (transfer) {
    Transfer.Waiting -> "waiting for the server"
    is Transfer.Fetching -> transfer.progress?.let { "fetching on the server ${percent(it)} percent" } ?: "fetching on the server"
    is Transfer.Copying -> "downloading ${percent(transfer.progress)} percent"
    is Transfer.Paused -> "paused, ${minutesLeft(transfer.resumeAtMs, nowMs)} minutes left"
    is Transfer.Failed -> "on server, download failed"
}

private fun percent(progress: Float): Int = (progress.coerceIn(0f, 1f) * 100).toInt()

private fun minutesLeft(resumeAtMs: Long, nowMs: Long): Int = ceil((resumeAtMs - nowMs).coerceAtLeast(0L) / 60_000.0).toInt()

/**
 * One song of the Library (iOS `LibrarySongRow`): cover, title, "Artist · year" and, at the trailing edge, exactly one
 * of the duration (on the phone), Download (on the server), "No audio yet" (dimmed) or the state of the download in
 * flight. The row of the current song has the accent wash and a Pause or Play glyph on its cover; a song on the
 * phone shows a small play badge (IOS-117).
 *
 * The row is one TalkBack element whose label says everything it shows; [actions] are its custom actions.
 * A tap calls [onTap], a long press [onMenu]; the Download and Retry words call [onDownload].
 */
@Composable
internal fun LibrarySongRow(
    song: Song,
    audio: AudioState,
    transfer: Transfer?,
    playing: Boolean,
    isPlaying: Boolean,
    offline: Boolean,
    tapLabel: String,
    onTap: () -> Unit,
    onMenu: () -> Unit,
    onDownload: () -> Unit,
    actions: List<CustomAccessibilityAction>,
    modifier: Modifier = Modifier,
) {
    val colors = DS.colors
    val onPhone = audio == AudioState.Phone
    val moving = if (onPhone) null else transfer
    val noAudio = audio == AudioState.None && moving == null
    val dim = if (noAudio) DS.Opacity.dim else 1f
    val secondary = if (playing) colors.ink else colors.inkMuted
    val duration = song.duration?.takeIf { it > 0 }
    val subtitle = SongDisplay.subtitleLineUnbroken(song)
    val state = when {
        onPhone -> "on phone"
        moving != null -> transferSpoken(moving)
        noAudio -> "no audio yet"
        offline -> "on server, offline"
        else -> "on server"
    }
    val spoken = listOf(
        SongDisplay.titleLine(song), SongDisplay.artistLine(song), SongDisplay.year(song)?.toString().orEmpty(),
        duration?.let(::formatTime).orEmpty(), state, if (!playing) "" else if (isPlaying) "playing" else "paused",
    ).filter { it.isNotEmpty() }.joinToString(", ")

    Row(
        modifier.fillMaxWidth().background(if (playing) colors.accentTint else Color.Transparent)
            .dsPressable(onClickLabel = tapLabel, onLongClickLabel = "More actions", onLongClick = onMenu, onClick = onTap)
            .clearAndSetSemantics {
                contentDescription = spoken
                selected = playing
                customActions = actions
            }
            .padding(end = DS.Space.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.padding(DS.Space.space3).size(DS.Component.coverRow).alpha(dim).clip(dsRounded(DS.Radius.radiusSm)),
            contentAlignment = Alignment.Center,
        ) {
            CoverImage(song.thumbnail, Modifier.fillMaxSize())
            if (playing) {
                Box(Modifier.fillMaxSize().background(colors.coverScrim), contentAlignment = Alignment.Center) {
                    CoverGlyph(if (isPlaying) Icons.pause else Icons.play, DS.Icon.iconPlay)
                }
            } else if (onPhone) {
                Box(Modifier.size(DS.Component.iconButton).background(colors.coverScrim, CircleShape), contentAlignment = Alignment.Center) {
                    CoverGlyph(Icons.play, DS.Icon.iconInline)
                }
            }
        }
        val trailing: @Composable () -> Unit = {
            when {
                moving is Transfer.Failed -> RowWord(transferText(moving), onDownload)
                moving is Transfer.Paused -> DSText(transferText(moving), style = DS.Type.caption, color = secondary, maxLines = 1)
                moving != null -> DSText(transferText(moving), style = DS.Type.caption, color = colors.accentInk, maxLines = 1)
                onPhone -> if (duration != null) DSText(formatTime(duration), style = DS.Type.time, color = secondary, maxLines = 1)
                noAudio -> DSText("No audio yet", Modifier.alpha(dim), DS.Type.caption, secondary, maxLines = 1)
                offline -> DSText("Offline", style = DS.Type.caption, color = colors.inkMuted, maxLines = 1)
                else -> RowWord("Download", onDownload)
            }
        }
        // At large text the state moves under the lines instead of squeezing them (IOS-113, IOS-130).
        val stacked = LocalDensity.current.fontScale >= STACK_FONT_SCALE
        Column(Modifier.weight(1f).padding(vertical = DS.Space.space3), verticalArrangement = Arrangement.spacedBy(DS.Space.space1)) {
            DSText(SongDisplay.titleLine(song), Modifier.alpha(dim), DS.Type.headline, maxLines = if (stacked) 3 else 2)
            if (subtitle.isNotEmpty()) DSText(subtitle, Modifier.alpha(dim), DS.Type.subhead, secondary, maxLines = if (stacked) 3 else 1)
            if (stacked) trailing()
        }
        if (!stacked) {
            Box(Modifier.padding(start = DS.Space.space2).defaultMinSize(minHeight = DS.Space.hit), contentAlignment = Alignment.CenterEnd) { trailing() }
        }
    }
}

/** From this system font scale on, rows stack their state under the text (the iOS accessibility sizes start near here). */
internal const val STACK_FONT_SCALE = 1.3f

/** "Download" or "Retry" at the end of a row: accent-ink words in a 44dp target (the iOS row's download button). */
@Composable
private fun RowWord(text: String, onClick: () -> Unit) {
    Box(Modifier.defaultMinSize(DS.Space.hit, DS.Space.hit).dsClickable(pressedAlpha = PRESSED, onClick = onClick), contentAlignment = Alignment.Center) {
        DSText(text, style = DS.Type.caption, color = DS.colors.accentInk, maxLines = 1, weight = FontWeight.W600)
    }
}

/** The glyph on a cover's scrim: the day surface colour in both themes, so it reads on the dark scrim at night (iOS `CoverGlyph`). */
@Composable
private fun CoverGlyph(icon: ImageVector, size: Dp) {
    DSIcon(icon, size = size, tint = DSColorsLight.surface)
}
