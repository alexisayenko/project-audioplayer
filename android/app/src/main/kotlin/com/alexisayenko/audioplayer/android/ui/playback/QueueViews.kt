package com.alexisayenko.audioplayer.android.ui.playback

import com.alexisayenko.audioplayer.android.logic.PlaybackSeek
import com.alexisayenko.audioplayer.android.logic.formatTime
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListItemInfo
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.playback.RepeatMode
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSIconButton
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.dsShadow
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons

// The queue of Now playing: the iOS "Up next" card and `QueueSheet` as one card on the page. The card is drawn in
// segments (a head and one segment per song) so a long queue stays a lazy list.

/** The lazy-list key of the queue row at [index]; [queueIndex] reads the index back. */
internal fun queueKey(index: Int, song: Song): String = "q:$index:${song.id}"

private fun queueIndex(item: LazyListItemInfo): Int? =
    (item.key as? String)?.takeIf { it.startsWith("q:") }?.substring(2)?.substringBefore(':')?.toIntOrNull()

/**
 * A reorder in progress: the row being dragged by its handle, how far the finger has moved, and the place it would
 * take if dropped now. The queue itself changes only on the drop, through `PlayerController.moveQueueItem`.
 */
internal class QueueDrag {
    var from by mutableIntStateOf(-1)
        private set
    var target by mutableIntStateOf(-1)
        private set
    var delta by mutableFloatStateOf(0f)
        private set
    var height by mutableIntStateOf(0)
        private set

    fun start(index: Int, visible: List<LazyListItemInfo>) {
        height = visible.firstOrNull { queueIndex(it) == index }?.size ?: return
        from = index
        target = index
        delta = 0f
    }

    fun move(dy: Float, visible: List<LazyListItemInfo>) {
        if (from < 0) return
        delta += dy
        val rows = visible.mapNotNull { item -> queueIndex(item)?.let { it to item } }
        val me = rows.firstOrNull { it.first == from }?.second ?: return
        val centre = me.offset + me.size / 2 + delta
        target = rows.firstOrNull { (_, item) -> centre >= item.offset && centre < item.offset + item.size }?.first
            ?: if (centre < me.offset) rows.first().first else rows.last().first
    }

    /** Ends the drag; returns the move to make as (from, to), or null when the row was dropped where it was. */
    fun end(): Pair<Int, Int>? {
        val move = if (from >= 0 && target >= 0 && target != from) from to target else null
        from = -1
        target = -1
        delta = 0f
        return move
    }
}

/**
 * One piece of a card that is split over several list items: the fill with the card's corners only where the card
 * begins ([first]) or ends ([last]), and the card's shadow cut at the seams so the pieces read as one slab (`dsSlab`).
 */
@Composable
private fun CardSegment(
    first: Boolean,
    last: Boolean,
    modifier: Modifier = Modifier,
    fill: Color = DS.colors.surface,
    lifted: Boolean = false,
    content: @Composable () -> Unit,
) {
    val radius = DS.Radius.radiusCard
    val shape = RoundedCornerShape(
        topStart = if (first) radius else 0.dp,
        topEnd = if (first) radius else 0.dp,
        bottomStart = if (last) radius else 0.dp,
        bottomEnd = if (last) radius else 0.dp,
    )
    val reach = radius + DS.Shadow.depthSlab.radius * 2
    Box(modifier.fillMaxWidth()) {
        if (lifted) {
            Box(Modifier.matchParentSize().dsShadow(DS.Shadow.depthHover, shape))
        } else {
            Box(
                Modifier.matchParentSize().cutShadow(above = first, below = last)
                    .stretch(above = if (first) 0.dp else reach, below = if (last) 0.dp else reach)
                    .dsShadow(DS.Shadow.depthSlab, dsRounded(radius)),
            )
        }
        Box(Modifier.fillMaxWidth().background(fill, shape).clip(shape)) { content() }
    }
}

/** Lets what is drawn spill over the sides, and over the top or bottom edge only where asked. */
private fun Modifier.cutShadow(above: Boolean, below: Boolean): Modifier = drawWithContent {
    val far = size.width
    clipRect(left = -far, right = size.width + far, top = if (above) -far else 0f, bottom = if (below) size.height + far else size.height) {
        this@drawWithContent.drawContent()
    }
}

/** Lays the content out taller than its slot by [above] and [below], without taking more room. */
private fun Modifier.stretch(above: Dp, below: Dp): Modifier = layout { measurable, constraints ->
    val top = above.roundToPx()
    val height = constraints.maxHeight + top + below.roundToPx()
    val placeable = measurable.measure(constraints.copy(minHeight = height, maxHeight = height))
    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, -top) }
}

/**
 * The head of the queue card: "Queue (N)", the shuffle and repeat keys (iOS `TransportTray`'s ghost keys) and
 * "Clear queue" (iOS `QueueSheet`'s Clear). With an empty queue it is the whole card and says so.
 */
@Composable
internal fun QueueHeader(
    count: Int,
    shuffle: Boolean,
    repeat: RepeatMode,
    enabled: Boolean,
    onShuffle: () -> Unit,
    onRepeat: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    CardSegment(first = true, last = count == 0, modifier = modifier) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier.fillMaxWidth().padding(start = DS.Space.space4, end = DS.Space.space2, top = DS.Space.space1, bottom = DS.Space.space1),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                DSText("Queue ($count)", Modifier.weight(1f).padding(end = DS.Space.space1).semantics { heading() }, DS.Type.headline, maxLines = 2)
                TransportKey(Icons.shuffle, "Shuffle", onShuffle, Modifier.padding(end = DS.Space.space1), kind = TransportKeyKind.Ghost, on = shuffle, enabled = enabled, state = if (shuffle) "on" else "off", role = ToggleRole)
                TransportKey(
                    if (repeat == RepeatMode.One) Icons.repeatOne else Icons.repeat,
                    "Repeat",
                    onRepeat,
                    kind = TransportKeyKind.Ghost,
                    on = repeat != RepeatMode.Off,
                    enabled = enabled,
                    state = repeat.spokenName,
                )
                DSIconButton(Icons.trash, "Clear queue", onClear, size = DS.Icon.iconNav, tint = DS.colors.inkMuted, enabled = count > 0)
            }
            val note = when {
                count == 0 -> "Queue is empty. Add songs from Library."
                shuffle && count > 1 -> "Shuffle is on, so songs play in random order."
                else -> null
            }
            if (note != null) {
                DSText(
                    note,
                    Modifier.padding(start = DS.Space.space4, end = DS.Space.space4, bottom = DS.Space.space3),
                    if (count == 0) DS.Type.subhead else DS.Type.caption,
                    DS.colors.inkMuted,
                )
            }
        }
    }
}

/**
 * One song of the queue (iOS `QueueSheet` row with the `upNextRow` type sizes): tap to jump to it, the cross removes
 * it, the handle drags it to another place. The current song is washed in accent-tint. TalkBack gets "Remove from
 * queue", "Move up" and "Move down" as actions, because it cannot drag.
 */
@Composable
internal fun QueueRow(
    song: Song,
    index: Int,
    count: Int,
    current: Boolean,
    drag: QueueDrag,
    onJump: () -> Unit,
    onRemove: () -> Unit,
    onMove: (from: Int, to: Int) -> Unit,
    onDragStart: () -> Unit,
    onDrag: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = DS.colors
    val dragging = drag.from == index
    val shift = when {
        drag.from < 0 || dragging -> 0f
        drag.from < index && index <= drag.target -> -drag.height.toFloat()
        drag.target <= index && index < drag.from -> drag.height.toFloat()
        else -> 0f
    }
    val settled by animateFloatAsState(shift, if (drag.from < 0) snap() else tween(DS.Motion.durBase, easing = DS.Motion.easeIo), label = "queue row")
    val start by rememberUpdatedState(onDragStart)
    val move by rememberUpdatedState(onDrag)
    val drop by rememberUpdatedState { drag.end()?.let { (from, to) -> onMove(from, to) } }
    val subtitle = song.playbackSubtitle()
    val largeText = LocalDensity.current.fontScale > 1.3f
    val ink = if (current) colors.ink else colors.inkMuted
    val reorder = buildList {
        if (index > 0) add(CustomAccessibilityAction("Move up") { onMove(index, index - 1); true })
        if (index < count - 1) add(CustomAccessibilityAction("Move down") { onMove(index, index + 1); true })
    }

    CardSegment(
        first = false,
        last = index == count - 1,
        modifier = modifier.zIndex(if (dragging) 1f else 0f).graphicsLayer { translationY = if (dragging) drag.delta else settled },
        fill = if (current) colors.accentTint else colors.surface,
        lifted = dragging,
    ) {
        Column(Modifier.fillMaxWidth()) {
            Hairline()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.weight(1f).defaultMinSize(minHeight = DS.Component.rowHeight)
                        .dsClickable(label = "Play", onClick = onJump)
                        .semantics {
                            selected = current
                            customActions = listOf(CustomAccessibilityAction("Remove from queue") { onRemove(); true }) + reorder
                        }
                        .padding(start = DS.Space.space3, top = DS.Space.space2, bottom = DS.Space.space2),
                    horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CoverImage(song.thumbnail, Modifier.size(DS.Component.coverSm).clip(dsRounded(DS.Radius.radiusSm)))
                    Column(Modifier.weight(1f)) {
                        DSText(song.title, style = DS.Type.subheadStrong, maxLines = 2)
                        if (subtitle.isNotEmpty()) DSText(subtitle, style = DS.Type.caption, color = ink, maxLines = if (largeText) 2 else 1)
                    }
                    song.duration?.let { DSText(formatTime(it), style = DS.Type.time, color = ink, maxLines = 1) }
                }
                DSIconButton(Icons.clear, "Remove ${song.title} from queue", onRemove, size = DS.Icon.iconInline, tint = colors.inkMuted)
                Box(
                    Modifier.size(DS.Space.hit)
                        .semantics {
                            contentDescription = "Reorder ${song.title}"
                            customActions = reorder
                        }
                        .pointerInput(Unit) {
                            detectDragGestures(onDragStart = { start() }, onDragEnd = { drop() }, onDragCancel = { drag.end() }) { change, amount ->
                                change.consume()
                                move(amount.y)
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) { DSIcon(Icons.grip, size = DS.Icon.iconNav, tint = colors.inkMuted) }
            }
        }
    }
}
