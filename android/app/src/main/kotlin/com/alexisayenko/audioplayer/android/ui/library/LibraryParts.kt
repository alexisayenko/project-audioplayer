@file:OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)

package com.alexisayenko.audioplayer.android.ui.library

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.logic.LibraryQuery
import com.alexisayenko.audioplayer.android.logic.LibrarySort
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSIconButton
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.SheetGrabber
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsFloat
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.dsShadow
import com.alexisayenko.audioplayer.android.ui.dsSlab
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.onStrong
import com.alexisayenko.audioplayer.android.ui.strongFill
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The small parts of the Library screen: Kotlin counterparts of ios/Sources/LibraryComponents.swift. Sizes come from
// the design tokens; a literal here is the same literal as in the Swift file.

/** Opacity of a pressed Library control (iOS `LibraryPressStyle`). */
internal const val PRESSED = 0.8f

/**
 * A tap and long-press target without the Material ripple: the content dims while pressed (iOS `LibraryPressStyle`).
 * The long-press counterpart of `dsClickable`, which has no long press.
 */
@Composable
internal fun Modifier.dsPressable(
    onClickLabel: String? = null,
    onLongClickLabel: String? = null,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    return alpha(if (pressed) PRESSED else 1f).combinedClickable(
        interactionSource = source,
        indication = null,
        role = Role.Button,
        onClickLabel = onClickLabel,
        onLongClickLabel = onLongClickLabel,
        onLongClick = onLongClick,
        onClick = onClick,
    )
}

/**
 * One row of a list drawn as a single slab (iOS `librarySlab` around the rows): surface fill, the slab shadow kept
 * out of the neighbouring rows, round corners only on the [first] and the [last] row.
 */
@Composable
internal fun Modifier.slabPiece(first: Boolean, last: Boolean): Modifier {
    val radius = DS.Radius.radiusCard
    val top = if (first) radius else 0.dp
    val bottom = if (last) radius else 0.dp
    val shape = RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)
    val density = LocalDensity.current.density
    // The shadow is cast by a shape that runs on into the neighbouring rows, so it does not thin out at the seams;
    // the clip then keeps it out of them.
    val far = with(LocalDensity.current) { DS.Space.space8.toPx() }
    val cast = remember(first, last, far) {
        GenericShape { size, _ ->
            val topRadius = if (first) CornerRadius(radius.value * density) else CornerRadius.Zero
            val bottomRadius = if (last) CornerRadius(radius.value * density) else CornerRadius.Zero
            addRoundRect(
                RoundRect(
                    left = 0f, top = if (first) 0f else -far, right = size.width, bottom = if (last) size.height else size.height + far,
                    topLeftCornerRadius = topRadius, topRightCornerRadius = topRadius,
                    bottomRightCornerRadius = bottomRadius, bottomLeftCornerRadius = bottomRadius,
                ),
            )
        }
    }
    return drawWithContent {
        clipRect(left = -far, top = if (first) -far else 0f, right = size.width + far, bottom = if (last) size.height + far else size.height) {
            this@drawWithContent.drawContent()
        }
    }.dsShadow(DS.Shadow.depthSlab, cast).background(DS.colors.surface, shape).clip(shape)
}

/**
 * The search field of the Library and of the filter sheets (iOS `LibrarySearchField`): sunken fill, a magnifier,
 * a clear button while there is text, an accent ring while focused. The keyboard's Search key hides the keyboard.
 */
@Composable
internal fun LibrarySearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search songs, artists, tags",
    label: String = "Search songs, artists and tags",
    minHeight: Dp = DS.Space.hit,
) {
    val colors = DS.colors
    val focus = LocalFocusManager.current
    var focused by remember { mutableStateOf(false) }
    val shape = dsRounded(DS.Radius.radiusKey)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.onFocusChanged { focused = it.isFocused }.semantics { contentDescription = label },
        textStyle = DS.Type.body.copy(color = colors.ink),
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        cursorBrush = SolidColor(colors.accentInk),
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = minHeight).background(colors.surfaceSunken, shape)
                    .border(DS.Stroke.strokeMedium, if (focused) colors.accentInk else Color.Transparent, shape)
                    .padding(start = DS.Space.space3, end = if (value.isEmpty()) DS.Space.space3 else 0.dp),
                horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                DSIcon(Icons.search, size = DS.Icon.iconAction, tint = colors.inkMuted)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) DSText(placeholder, style = DS.Type.body, color = colors.inkMuted, maxLines = 1)
                    inner()
                }
                if (value.isNotEmpty()) {
                    DSIconButton(Icons.clear, "Clear search", { onValueChange("") }, size = DS.Icon.iconAction, tint = colors.inkMuted)
                }
            }
        },
    )
}

/**
 * A chip of the Library filter row (iOS `LibraryFilterChip`): a surface pill when off; the accent tint with an
 * accent-ink rim when on, plus a count badge for a category with picked values. The touch target is 44dp tall.
 */
@Composable
internal fun LibraryFilterChip(
    title: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    count: Int? = null,
    hint: String = "Opens the filter",
) {
    val colors = DS.colors
    val pill = if (selected) {
        Modifier.background(colors.accentTint, CircleShape).border(DS.Stroke.strokeThin, colors.accentInk, CircleShape)
    } else {
        Modifier.dsShadow(DS.Shadow.depthSlab, CircleShape).background(colors.surface, CircleShape)
    }
    Box(
        modifier.defaultMinSize(minHeight = DS.Space.hit).dsClickable(pressedAlpha = PRESSED, label = hint, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = title
                stateDescription = count?.let { "$it selected" } ?: if (selected) "On" else "Off"
                this.selected = selected
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.defaultMinSize(minHeight = DS.Control.control).then(pill).padding(horizontal = DS.Space.space3),
            horizontalArrangement = Arrangement.spacedBy(DS.Space.space1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DSIcon(icon, size = DS.Icon.iconInline, tint = if (selected) colors.ink else colors.inkMuted)
            DSText(title, style = DS.Type.subhead, maxLines = 1, weight = if (selected) FontWeight.W600 else FontWeight.W500)
            if (count != null && count > 0) {
                Box(
                    Modifier.defaultMinSize(DS.Component.badge, DS.Component.badge).background(colors.strongFill, CircleShape)
                        .padding(horizontal = DS.Space.space1),
                    contentAlignment = Alignment.Center,
                ) { DSText("$count", style = DS.Type.caption, color = colors.onStrong, maxLines = 1, weight = FontWeight.W600) }
            }
        }
    }
}

/** A round 36dp icon button in a 44dp target (iOS `LibraryControls.icon`): a surface slab, or the select tint when [selected]. */
@Composable
internal fun CircleIconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, selected: Boolean = false) {
    val colors = DS.colors
    val circle = if (selected) {
        Modifier.background(colors.selectTint, CircleShape).border(DS.Stroke.strokeThin, colors.selectInk, CircleShape)
    } else {
        Modifier.dsShadow(DS.Shadow.depthSlab, CircleShape).background(colors.surface, CircleShape)
    }
    Box(
        modifier.size(DS.Space.hit).dsClickable(pressedAlpha = PRESSED, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(DS.Control.control).then(circle), contentAlignment = Alignment.Center) {
            DSIcon(icon, size = DS.Icon.iconNav, tint = if (selected) colors.selectInk else colors.ink)
        }
    }
}

/**
 * The controls line (iOS `LibraryControls`): Sort by and the direction on the left, "N of M songs" with the total
 * length of the listed songs on the right, then the actions button. The count is blank until the library is ready
 * (IOS-124) and turns select-ink while anything narrows the list.
 */
@Composable
internal fun LibraryControls(
    query: LibraryQuery,
    matches: Int,
    total: Int,
    length: String?,
    showsCount: Boolean,
    onSort: () -> Unit,
    onReverse: () -> Unit,
    onActions: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val descending = query.sort.descending != query.reversed
    Row(modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit), verticalAlignment = Alignment.CenterVertically) {
        CircleIconButton(Icons.sortCriteria, "Sort by, ${query.sort.label}", onSort, selected = query.sort != LibrarySort.Newest)
        CircleIconButton(
            if (descending) Icons.sortDesc else Icons.sortAsc,
            "Sort direction, ${if (descending) "descending" else "ascending"}",
            onReverse,
            selected = query.reversed,
        )
        val count = "$matches of $total ${if (total == 1) "song" else "songs"}"
        DSText(
            if (showsCount) listOfNotNull(count, length.takeIf { LocalDensity.current.fontScale < STACK_FONT_SCALE }).joinToString(" · ") else "",
            Modifier.weight(1f).padding(horizontal = DS.Space.space2).clearAndSetSemantics {
                contentDescription = if (showsCount) "$matches of $total songs matched" else "Loading songs"
            },
            style = DS.Type.caption.copy(fontFeatureSettings = "tnum"),
            color = if (query.narrowing) DS.colors.selectInk else DS.colors.inkMuted,
            maxLines = 2,
            align = TextAlign.End,
        )
        CircleIconButton(Icons.more, "Library actions", onActions)
    }
}

/**
 * The one banner of the Library (iOS `offlineBanner`, `OfflineDownloadNote`): what is wrong with the link to the
 * server in one line, with the action that mends it.
 */
@Composable
internal fun LibraryBanner(icon: ImageVector, text: String, action: String, onAction: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Row(
        modifier.fillMaxWidth().dsSlab(DS.Radius.radiusKey).padding(horizontal = DS.Space.space3),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSIcon(icon, size = DS.Icon.iconInline, tint = DS.colors.inkMuted)
        DSText(text, Modifier.weight(1f).padding(vertical = DS.Space.space2), DS.Type.caption)
        Box(Modifier.defaultMinSize(DS.Space.hit, DS.Space.hit).dsClickable(enabled = enabled, onClick = onAction), contentAlignment = Alignment.Center) {
            DSText(action, style = DS.Type.caption, color = DS.colors.accentInk, weight = FontWeight.W600, maxLines = 1)
        }
    }
}

/** The lit capsule for the main action of a block (iOS `LibraryPrimaryStyle`); disabled it is an unlit tint with a muted label. */
@Composable
internal fun LibraryPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    label: String = text,
) {
    val colors = DS.colors
    val ink = if (enabled) colors.onAccent else colors.inkMuted
    val fill = if (enabled) {
        Modifier.dsClickable(pressedAlpha = PRESSED, onClick = onClick).dsShadow(DS.Shadow.depthGlow, CircleShape).background(colors.accent, CircleShape)
    } else {
        Modifier.semantics { role = Role.Button; disabled() }.background(colors.accentTint, CircleShape)
    }
    Row(
        modifier.defaultMinSize(minHeight = DS.Space.hit).semantics(mergeDescendants = true) { contentDescription = label }
            .then(fill).padding(horizontal = DS.Space.space5),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) DSIcon(icon, size = DS.Icon.iconAction, tint = ink)
        DSText(text, style = DS.Type.headline, color = ink, maxLines = 2, align = TextAlign.Center)
    }
}

/** A block that stands in for the list: a glyph, a headline, one explaining line and the actions (iOS `LibraryEmpty`). */
@Composable
internal fun LibraryEmpty(title: String, icon: ImageVector, detail: String, modifier: Modifier = Modifier, actions: @Composable ColumnScope.() -> Unit = {}) {
    Column(
        modifier.fillMaxWidth().padding(vertical = DS.Space.space6, horizontal = DS.Space.space4),
        verticalArrangement = Arrangement.spacedBy(DS.Space.space3),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        DSIcon(icon, size = DS.Component.coverSm, tint = DS.colors.inkMuted)
        DSText(title, Modifier.semantics { heading() }, DS.Type.headline, align = TextAlign.Center)
        DSText(detail, style = DS.Type.body, color = DS.colors.inkMuted, align = TextAlign.Center)
        actions()
    }
}

/**
 * The placeholder list of a first load (iOS `LibrarySkeleton`): eight grey rows. It does not pulse: it is drawn at
 * the opacity iOS uses under Reduce Motion.
 */
@Composable
internal fun LibrarySkeleton(modifier: Modifier = Modifier) {
    val grey = DS.colors.surfaceSunken
    val bar = dsRounded(DS.Radius.radiusXs)
    Column(modifier.fillMaxWidth().dsSlab().alpha(0.7f).clearAndSetSemantics { contentDescription = "Loading your library" }) {
        repeat(8) { index ->
            Row(Modifier.padding(DS.Space.space3), horizontalArrangement = Arrangement.spacedBy(DS.Space.space3), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(DS.Component.coverRow).background(grey, dsRounded(DS.Radius.radiusSm)))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
                    Box(Modifier.fillMaxWidth(0.6f).height(DS.Icon.iconXs + DS.Stroke.strokeMedium).background(grey, bar))
                    Box(Modifier.fillMaxWidth(0.4f).height(DS.Icon.iconXs).background(grey, bar))
                }
                Box(Modifier.size(DS.Control.control, DS.Icon.iconXs).background(grey, bar))
            }
            if (index < 7) Hairline(Modifier.padding(horizontal = DS.Space.space3))
        }
    }
}

/** The short message a screen shows after an action (the iOS Library toast): one at a time, gone after two seconds. */
@Stable
internal class ToastState {
    var message by mutableStateOf<String?>(null)
        private set
    var tick by mutableIntStateOf(0)
        private set

    fun show(text: String) {
        message = text
        tick += 1
    }

    fun clear() {
        message = null
    }
}

/** Draws the message of [state] as a floating slab and announces it to TalkBack (iOS `toastView`). */
@Composable
internal fun ToastHost(state: ToastState, modifier: Modifier = Modifier) {
    val message = state.message ?: return
    LaunchedEffect(state.tick) {
        delay(2_000)
        state.clear()
    }
    DSText(
        message,
        modifier.padding(horizontal = DS.Space.space4).dsFloat(DS.Radius.radiusKey).padding(DS.Space.space3).semantics { liveRegion = LiveRegionMode.Polite },
        DS.Type.caption,
    )
}

/**
 * A bottom sheet in the Electrophone look: surface fill, the tray corner, the grab handle, the vinyl scrim. Material's
 * `ModalBottomSheet` gives the gesture and the window; every colour and shape is a design token (AND-012).
 * [fill] is the sheet's colour: surface, or ground for a sheet that holds slabs. [tall] fixes the height to the tall detent, so a sheet with a search field does not jump when the keyboard opens.
 * The content gets `close`, which slides the sheet away and then calls [onDismiss].
 */
@Composable
internal fun DSSheet(onDismiss: () -> Unit, tall: Boolean = false, fill: Color = DS.colors.surface, content: @Composable ColumnScope.(close: () -> Unit) -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = { scope.launch { state.hide() }.invokeOnCompletion { onDismiss() } }
    val corner = DS.Radius.radiusTray
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        shape = RoundedCornerShape(topStart = corner, topEnd = corner),
        containerColor = fill,
        contentColor = DS.colors.ink,
        tonalElevation = 0.dp,
        scrimColor = DS.colors.vinyl.copy(alpha = 0.45f),
        dragHandle = { Box(Modifier.fillMaxWidth().padding(bottom = DS.Space.space2), contentAlignment = Alignment.Center) { SheetGrabber() } },
    ) {
        Column(if (tall) Modifier.fillMaxWidth().fillMaxHeight(DS.Component.sheetTall) else Modifier.fillMaxWidth()) { content(close) }
    }
}

/** The heading line of a sheet: the title on the left, text buttons on the right. */
@Composable
internal fun SheetHeader(title: String, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit), verticalAlignment = Alignment.CenterVertically) {
        DSText(title, Modifier.weight(1f).semantics { heading() }, DS.Type.title, maxLines = 2)
        trailing()
    }
}

/** A word that is a button, in a 44dp target ("Done", "Clear", "Edit"). */
@Composable
internal fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = DS.colors.selectInk) {
    Box(
        modifier.defaultMinSize(DS.Space.hit, DS.Space.hit).dsClickable(enabled = enabled, pressedAlpha = PRESSED, onClick = onClick)
            .padding(horizontal = DS.Space.space2),
        contentAlignment = Alignment.Center,
    ) { DSText(text, style = DS.Type.body, color = color, maxLines = 1, weight = FontWeight.W600) }
}

/** One action of a sheet or a slab: an icon in a fixed frame, so the labels line up, and the label (iOS `SongDetailsView.action`). */
@Composable
internal fun ActionRow(
    title: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = DS.colors.ink,
    enabled: Boolean = true,
    sublabel: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight).dsClickable(enabled = enabled, pressedAlpha = PRESSED, onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(DS.Component.navIconFrame), contentAlignment = Alignment.Center) { DSIcon(icon, size = DS.Icon.iconNav, tint = tint) }
        Column(Modifier.weight(1f).padding(vertical = DS.Space.space1)) {
            DSText(title, style = DS.Type.body, color = tint)
            if (sublabel != null) DSText(sublabel, style = DS.Type.caption, color = DS.colors.inkMuted)
        }
        trailing?.invoke()
    }
}
