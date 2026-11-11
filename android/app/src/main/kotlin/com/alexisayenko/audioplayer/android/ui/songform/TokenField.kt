package com.alexisayenko.audioplayer.android.ui.songform

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsFloat
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons

/**
 * Follows one pill while it is dragged and tells the pill fields where it would land. The fields of one form share
 * one controller, so a pill can leave Title and land in Artist. It stands in for the system drag and drop that the
 * Swift `TokenField` uses (`.draggable` and `.dropDestination`).
 */
class TokenDragController {
    internal class Field(var bounds: Rect, val pills: () -> Map<Int, Rect>, val drop: (TokenDrag, Int) -> Boolean)

    private val fields = mutableMapOf<TokenKind, Field>()

    /** The pill in the air, or null. */
    var drag by mutableStateOf<TokenDrag?>(null)
        private set

    /** Its label, for the lifted copy. */
    var label by mutableStateOf("")
        private set

    /** Where the finger is, in the coordinates of the Compose root. */
    var position by mutableStateOf(Offset.Zero)
        private set

    /** The field under the finger. */
    var targetField by mutableStateOf<TokenKind?>(null)
        private set

    /** The pill under the finger (the dragged pill lands before it); null means the end of [targetField]. */
    var targetPill by mutableStateOf<Int?>(null)
        private set

    internal fun register(kind: TokenKind, field: Field) {
        fields[kind] = field
    }

    internal fun unregister(kind: TokenKind, field: Field) {
        if (fields[kind] === field) fields.remove(kind)
    }

    internal fun start(d: TokenDrag, text: String, at: Offset) {
        drag = d
        label = text
        position = at
        retarget()
    }

    internal fun dragBy(delta: Offset) {
        if (drag == null) return
        position += delta
        retarget()
    }

    private fun retarget() {
        val hit = fields.entries.firstOrNull { it.value.bounds.contains(position) }
        targetField = hit?.key
        targetPill = hit?.value?.pills()?.entries?.firstOrNull { it.value.contains(position) }?.key
    }

    /** The finger lifted: the pill lands where it is. True when a field took it. */
    internal fun end(): Boolean {
        val d = drag
        val field = targetField?.let { fields[it] }
        val index = targetPill ?: Int.MAX_VALUE
        cancel()
        return d != null && field != null && field.drop(d, index)
    }

    internal fun cancel() {
        drag = null
        targetField = null
        targetPill = null
    }
}

/** The drag controller shared by the pill fields of the form around them; null outside a form. */
val LocalTokenDrag = compositionLocalOf<TokenDragController?> { null }

private val pillHeight = DS.Control.control

/**
 * Title, Artist or Remix as wrapped pills over ONE plain string: a Compose port of the Swift `TokenField`
 * (ADD-071, ADD-072, IOS-065, IOS-066).
 *
 * Each pill is `[pencil] text [x]`. The pencil opens a menu (Edit text, Move to the other fields, Remove) and the x
 * removes the pill. Enter, or a typed " - ", " | " or " / ", turns the entry text into a pill. A long press lifts a
 * pill; dropped on another pill it lands before it, dropped elsewhere in a field it lands at the end. TalkBack users
 * move pills with the menu or with the pill's "Move to ..." actions.
 *
 * [text] is the field's value and [onTextChange] gets every new value; [moves] are the other pill fields.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TokenField(
    kind: TokenKind,
    text: String,
    onTextChange: (String) -> Unit,
    moves: List<TokenTarget>,
    modifier: Modifier = Modifier,
) {
    val colors = DS.colors
    val onChange by rememberUpdatedState(onTextChange)
    val targets by rememberUpdatedState(moves)
    val state = remember(kind) { TokenFieldState(kind, text) { onChange(it) } }
    SideEffect { state.onExternalText(text) }

    val drag = LocalTokenDrag.current ?: remember { TokenDragController() }
    val pillBounds = remember { mutableMapOf<Int, Rect>() }
    val field = remember(drag) { TokenDragController.Field(Rect.Zero, { pillBounds }, { d, i -> state.drop(d, i, targets) }) }
    DisposableEffect(drag, kind) {
        drag.register(kind, field)
        onDispose { drag.unregister(kind, field) }
    }

    val entryFocus = remember { FocusRequester() }
    val editFocus = remember { FocusRequester() }
    var entryFocused by remember { mutableStateOf(false) }
    var editFocused by remember { mutableStateOf(false) }
    LaunchedEffect(state.editing) { if (state.editing != null) runCatching { editFocus.requestFocus() } }

    val shown = state.shown
    SideEffect { pillBounds.keys.retainAll(shown.map { it.index }.toSet()) }
    val targeted = drag.drag != null && drag.targetField == kind
    val shape = dsRounded(DS.Radius.radiusKey)
    val textStyle = DS.Type.subhead.copy(color = colors.ink)

    FlowRow(
        modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.fieldHeight)
            .onGloballyPositioned { field.bounds = it.boundsInRoot() }
            .background(colors.surfaceSunken, shape)
            .then(if (targeted && drag.targetPill == null) Modifier.border(DS.Stroke.strokeFocus, colors.accent, shape) else Modifier)
            .pointerInput(Unit) { detectTapGestures { runCatching { entryFocus.requestFocus() } } }
            .padding(horizontal = DS.Space.space3, vertical = DS.Space.space1),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
        verticalArrangement = Arrangement.spacedBy(DS.Space.space2),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        for (item in shown) {
            if (state.editing == item.index) {
                BasicTextField(
                    value = state.editText,
                    onValueChange = { state.editText = it },
                    modifier = Modifier.widthIn(min = 120.dp).height(pillHeight).background(colors.accentTint, CircleShape)
                        .padding(horizontal = DS.Space.space3)
                        .focusRequester(editFocus)
                        .onFocusChanged {
                            if (editFocused && !it.isFocused) state.finishEdit()
                            editFocused = it.isFocused
                        }
                        .semantics { contentDescription = "Edit ${state.editOriginal}" },
                    textStyle = textStyle,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = {
                        runCatching { entryFocus.requestFocus() }
                        state.finishEdit()
                    }),
                    cursorBrush = SolidColor(colors.accentInk),
                    decorationBox = { inner -> Box(contentAlignment = Alignment.CenterStart) { inner() } },
                )
            } else {
                Pill(
                    kind = kind,
                    item = item,
                    moves = moves,
                    drag = drag,
                    insertBefore = targeted && drag.targetPill == item.index,
                    lifted = drag.drag == TokenDrag(kind, item.index),
                    onBounds = { pillBounds[item.index] = it },
                    onEdit = { state.startEdit(item.index, item.text) },
                    onMove = { state.move(item.index, it) },
                    onRemove = { state.remove(item.index) },
                )
            }
        }
        BasicTextField(
            value = state.pending,
            onValueChange = { state.onPendingChange(it) },
            modifier = Modifier.weight(1f).widthIn(min = 80.dp).defaultMinSize(minHeight = pillHeight)
                .focusRequester(entryFocus)
                .onFocusChanged {
                    if (entryFocused && !it.isFocused) state.onEntryBlur()
                    entryFocused = it.isFocused
                }
                .semantics { contentDescription = kind.label },
            textStyle = textStyle,
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { state.commitPending() }),
            cursorBrush = SolidColor(colors.accentInk),
            decorationBox = { inner ->
                Box(Modifier.defaultMinSize(minHeight = pillHeight), contentAlignment = Alignment.CenterStart) {
                    if (shown.isEmpty() && state.editing == null && state.pending.isEmpty()) {
                        DSText(kind.label, style = DS.Type.subhead, color = colors.inkMuted, maxLines = 1)
                    }
                    inner()
                }
            },
        )
    }
}

@Composable
private fun Pill(
    kind: TokenKind,
    item: TokenPill,
    moves: List<TokenTarget>,
    drag: TokenDragController,
    insertBefore: Boolean,
    lifted: Boolean,
    onBounds: (Rect) -> Unit,
    onEdit: () -> Unit,
    onMove: (TokenTarget) -> Unit,
    onRemove: () -> Unit,
) {
    val colors = DS.colors
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val label = item.text
    val edit by rememberUpdatedState(onEdit)
    val move by rememberUpdatedState(onMove)
    val remove by rememberUpdatedState(onRemove)
    val accent = colors.accent
    val gap = DS.Space.space2
    val lineWidth = DS.Stroke.strokeProgress

    Row(
        Modifier
            .onGloballyPositioned {
                coords = it
                onBounds(it.boundsInRoot())
            }
            .drawBehind {
                if (insertBefore) {
                    val w = lineWidth.toPx()
                    drawRoundRect(accent, Offset(-(gap.toPx() / 2 + w / 2), 0f), Size(w, size.height), CornerRadius(w / 2))
                }
            }
            .alpha(if (lifted) DS.Opacity.dim else 1f)
            .pointerInput(kind, item.index, label) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { at ->
                        val c = coords
                        if (c != null && c.isAttached) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            drag.start(TokenDrag(kind, item.index), label, c.localToRoot(at))
                        }
                    },
                    onDrag = { change, amount ->
                        change.consume()
                        drag.dragBy(amount)
                    },
                    onDragEnd = { drag.end() },
                    onDragCancel = { drag.cancel() },
                )
            }
            .height(pillHeight).background(colors.accentTint, CircleShape),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(30.dp, pillHeight).dsClickable { menu = true }.semantics { contentDescription = "Edit $label" },
                contentAlignment = Alignment.Center,
            ) { DSIcon(Icons.pencil, size = DS.Icon.iconXs, tint = colors.accentInk) }
            if (menu) {
                DSPopupMenu(
                    onDismiss = { menu = false },
                    items = buildList {
                        add(DSMenuItem("Edit text") { edit() })
                        for (m in moves) add(DSMenuItem("Move to ${m.kind.moveName}") { move(m) })
                        add(DSMenuItem("Remove", destructive = true) { remove() })
                    },
                )
            }
        }
        DSText(
            label,
            Modifier.weight(1f, fill = false).padding(horizontal = DS.Space.space1).semantics {
                customActions = moves.map { m ->
                    CustomAccessibilityAction("Move to ${m.kind.moveName}") {
                        move(m)
                        true
                    }
                }
            },
            style = DS.Type.subhead,
            maxLines = 1,
            weight = FontWeight.W500,
        )
        Box(
            Modifier.size(30.dp, pillHeight).dsClickable { remove() }.semantics { contentDescription = "Remove $label" },
            contentAlignment = Alignment.Center,
        ) { DSIcon(Icons.clear, size = DS.Icon.iconXs, tint = colors.accentInk) }
    }
}

/**
 * The lifted copy of the pill being dragged. Put it last in a Box that covers the pill fields; [origin] is that
 * Box's top left corner in root coordinates.
 */
@Composable
internal fun TokenDragGhost(drag: TokenDragController, origin: Offset) {
    if (drag.drag == null) return
    val colors = DS.colors
    Box(
        Modifier
            .offset {
                val p = drag.position - origin
                IntOffset((p.x - DS.Space.space6.toPx()).toInt(), (p.y - pillHeight.toPx() * 1.5f).toInt())
            }
            .height(pillHeight).dsFloat(DS.Radius.radiusPill).background(colors.accentTint, CircleShape)
            .padding(horizontal = DS.Space.space3),
        contentAlignment = Alignment.Center,
    ) { DSText(drag.label, style = DS.Type.subhead, maxLines = 1, weight = FontWeight.W500) }
}

/** One row of a [DSPopupMenu]. */
internal class DSMenuItem(val text: String, val destructive: Boolean = false, val onClick: () -> Unit)

/**
 * A small menu that drops from the control it is placed in: a floating slab of text rows, each at least 44dp tall.
 * It stands in for the system menu of the Swift pill (`Menu`); a tap outside closes it.
 */
@Composable
internal fun DSPopupMenu(items: List<DSMenuItem>, onDismiss: () -> Unit) {
    val colors = DS.colors
    Popup(alignment = Alignment.TopStart, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.padding(DS.Space.space3).width(IntrinsicSize.Max)
                .dsFloat(DS.Radius.radiusKey).padding(vertical = DS.Space.space1),
        ) {
            for (item in items) {
                Box(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit)
                        .dsClickable {
                            onDismiss()
                            item.onClick()
                        }
                        .padding(horizontal = DS.Space.space4),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    DSText(item.text, style = DS.Type.subhead, color = if (item.destructive) colors.powerText else colors.ink, maxLines = 1)
                }
            }
        }
    }
}
