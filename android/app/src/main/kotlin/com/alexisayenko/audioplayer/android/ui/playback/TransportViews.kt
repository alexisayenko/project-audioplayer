package com.alexisayenko.audioplayer.android.ui.playback

import com.alexisayenko.audioplayer.android.logic.PlaybackSeek
import com.alexisayenko.audioplayer.android.logic.formatTime
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.LocalDarkTheme
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsFloat
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.dsShadow
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.strongFill
import kotlin.math.roundToInt

// The transport controls of Now playing: Kotlin counterparts of ios/Sources/TransportViews.swift. The key sizes
// (64 x 48 lit, 56 x 44 raised) are the literals of the Swift `TransportKeyStyle`.

/** How a transport key is drawn (iOS `TransportKeyStyle.Kind`); `Flat` is a ghost key that is an action, not a toggle. */
internal enum class TransportKeyKind { Key, Lit, Ghost, Flat }

/**
 * One key of the transport (iOS `TransportKeyStyle`): a raised key, the lit play/pause key, or a ghost key that is
 * tinted while [on]. [label] and [state] are what TalkBack reads ("Shuffle", "on").
 */
@Composable
internal fun TransportKey(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: TransportKeyKind = TransportKeyKind.Key,
    on: Boolean = false,
    enabled: Boolean = true,
    state: String? = null,
    role: Role = Role.Button,
) {
    val colors = DS.colors
    val shape = dsRounded(DS.Radius.radiusKey)
    val lit = kind == TransportKeyKind.Lit
    val width = when (kind) {
        TransportKeyKind.Lit -> 64.dp
        TransportKeyKind.Key -> 56.dp
        else -> DS.Space.hit
    }
    val fill = when (kind) {
        TransportKeyKind.Lit -> Modifier.dsShadow(DS.Shadow.depthGlow, shape).background(colors.accent, shape)
        TransportKeyKind.Key -> Modifier.dsShadow(DS.Shadow.depthKey, shape).background(colors.surfaceKey, shape)
        TransportKeyKind.Ghost -> if (on) Modifier.background(colors.accentTint, shape) else Modifier
        TransportKeyKind.Flat -> Modifier
    }
    val tint = when (kind) {
        TransportKeyKind.Lit -> colors.onAccent
        TransportKeyKind.Ghost -> if (on) colors.accentInk else colors.inkMuted
        else -> colors.ink
    }
    Box(
        modifier.size(width, if (lit) 48.dp else DS.Space.hit)
            .dsClickable(enabled = enabled, role = role, pressedAlpha = 0.75f, onClick = onClick)
            .semantics {
                contentDescription = label
                if (state != null) stateDescription = state
            }
            .then(fill),
        contentAlignment = Alignment.Center,
    ) { DSIcon(icon, size = if (lit) DS.Icon.iconNavLg else DS.Icon.iconNav, tint = tint) }
}

/**
 * The transport tray (iOS `TransportTray`): previous, back 10 seconds, the lit play/pause key, forward 10 seconds, next,
 * on a floating slab. All keys are dimmed and inert while [enabled] is false (no song loaded, IOS-129).
 */
@Composable
internal fun TransportTray(
    playing: Boolean,
    enabled: Boolean,
    onPrevious: () -> Unit,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onForward: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().dsFloat(DS.Radius.radiusTray).padding(horizontal = DS.Space.space3, vertical = DS.Space.space2),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TransportKey(Icons.prev, "Previous song", onPrevious, enabled = enabled)
        TransportKey(Icons.back10, "Back 10 seconds", onBack, kind = TransportKeyKind.Flat, enabled = enabled)
        TransportKey(if (playing) Icons.pause else Icons.play, if (playing) "Pause" else "Play", onToggle, kind = TransportKeyKind.Lit, enabled = enabled)
        TransportKey(Icons.forward10, "Forward 10 seconds", onForward, kind = TransportKeyKind.Flat, enabled = enabled)
        TransportKey(Icons.next, "Next song", onNext, enabled = enabled)
    }
}

/**
 * The seek bar with its time labels (iOS `PlaybackProgress` over `DSSlider`): a sunken track, the progress in the strong
 * fill and a round paper thumb with a ring. Dragging scrubs: the thumb and the labels follow the finger and [onSeek]
 * is called once, on release. A tap steps 5 seconds towards the tapped side ([PlaybackSeek]).
 */
@Composable
internal fun SeekBar(positionMs: Long, durationMs: Long, enabled: Boolean, onSeek: (Long) -> Unit, modifier: Modifier = Modifier) {
    val colors = DS.colors
    val density = LocalDensity.current
    val active = enabled && durationMs > 0
    var scrub by remember { mutableStateOf<Long?>(null) }
    var width by remember { mutableIntStateOf(0) }
    val shown = (scrub ?: positionMs).coerceIn(0L, maxOf(durationMs, 0L))
    val fraction = if (durationMs > 0) shown.toFloat() / durationMs else 0f
    val position by rememberUpdatedState(positionMs)
    val duration by rememberUpdatedState(durationMs)
    val seek by rememberUpdatedState(onSeek)
    val thumb = DS.Control.thumbSeek
    val trackHeight = DS.Control.trackSeek
    // The track sits near the top of the 44dp touch strip, so the strip also covers the time labels below it.
    val centre = thumb * DS.Control.dragScale / 2 + 2.dp
    val scale by animateFloatAsState(if (scrub != null) DS.Control.dragScale else 1f, tween(DS.Motion.durFast), label = "thumb")
    val fill = colors.strongFill
    val sunken = colors.surfaceSunken

    fun at(x: Float): Long {
        val inset = with(density) { thumb.toPx() / 2 }
        val track = (width - inset * 2).coerceAtLeast(1f)
        return (duration * ((x - inset) / track).coerceIn(0f, 1f)).toLong()
    }

    Box(modifier.fillMaxWidth()) {
        Box(
            Modifier.fillMaxWidth().height(DS.Space.hit).alpha(if (active) 1f else 0.5f)
                .onSizeChanged { width = it.width }
                .semantics {
                    contentDescription = "Position"
                    stateDescription = formatTime(shown)
                    progressBarRangeInfo = ProgressBarRangeInfo(shown / 1000f, 0f..maxOf(durationMs, 1L) / 1000f)
                    if (active) setProgress { seconds -> seek((seconds * 1000).toLong().coerceIn(0L, duration)); true } else disabled()
                }
                .pointerInput(active) {
                    if (!active) return@pointerInput
                    detectTapGestures { tap ->
                        PlaybackSeek.tapTarget(position / 1000.0, duration / 1000.0, at(tap.x) / 1000.0)?.let { seek((it * 1000).toLong()) }
                    }
                }
                .pointerInput(active) {
                    if (!active) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragStart = { scrub = at(it.x) },
                        onDragEnd = {
                            scrub?.let { target -> seek(target) }
                            scrub = null
                        },
                        onDragCancel = { scrub = null },
                    ) { change, _ ->
                        change.consume()
                        scrub = at(change.position.x)
                    }
                }
                .drawBehind {
                    val h = trackHeight.toPx()
                    val top = centre.toPx() - h / 2
                    val radius = CornerRadius(h / 2)
                    val travel = (size.width - thumb.toPx()).coerceAtLeast(0f)
                    drawRoundRect(sunken, Offset(0f, top), Size(size.width, h), radius)
                    drawRoundRect(fill, Offset(0f, top), Size(travel * fraction + thumb.toPx() / 2, h), radius)
                },
        ) {
            Box(
                Modifier.offset {
                    val travel = (width - thumb.toPx()).coerceAtLeast(0f)
                    IntOffset((travel * fraction).roundToInt(), (centre - thumb / 2).roundToPx())
                }.size(thumb).graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                }.dsShadow(DS.Shadow.depthThumb, CircleShape)
                    .background(if (LocalDarkTheme.current) colors.ink else colors.surface, CircleShape)
                    .border(DS.Stroke.strokeFocus, fill, CircleShape),
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(top = centre + trackHeight / 2 + 6.dp).clearAndSetSemantics {},
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            DSText(formatTime(shown), style = DS.Type.time, color = colors.inkMuted, maxLines = 1)
            DSText("-" + formatTime(maxOf(durationMs - shown, 0L)), style = DS.Type.time, color = colors.inkMuted, maxLines = 1)
        }
    }
}
