package com.alexisayenko.audioplayer.android.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons

// The shared controls of the app: Kotlin counterparts of ios/Sources/Components.swift, drawn from foundation with the
// design tokens only (AND-012). Sizes that are literals here are the same literals as in the Swift file.

/** True in the night theme. Set by [ElectrophoneTheme]. */
val LocalDarkTheme = staticCompositionLocalOf { false }

/** Fill for primary buttons and selected chips: accent-strong by day, the lit accent by night (as iOS `strongFill`). */
val DSColors.strongFill: Color
    @Composable @ReadOnlyComposable get() = if (LocalDarkTheme.current) accent else accentStrong

/** Label on [strongFill]: ink by day, on-accent by night (as iOS `onStrong`). */
val DSColors.onStrong: Color
    @Composable @ReadOnlyComposable get() = if (LocalDarkTheme.current) onAccent else ink

/** The shape of a card or sheet corner. */
fun dsRounded(radius: Dp = DS.Radius.radiusCard): Shape = RoundedCornerShape(radius)

/** One of the native depth shadows behind [shape], in the colour of the current theme. */
@Composable
fun Modifier.dsShadow(level: DSShadow, shape: Shape, tint: Color? = null): Modifier {
    val color = tint?.copy(alpha = level.light.alpha) ?: if (LocalDarkTheme.current) level.dark else level.light
    return dropShadow(shape, Shadow(radius = level.radius, color = color, offset = DpOffset(level.x, level.y)))
}

/** A flat slab: surface fill and the soft ambient shadow, no border (iOS `dsSlab`). */
@Composable
fun Modifier.dsSlab(radius: Dp = DS.Radius.radiusCard, fill: Color = DS.colors.surface): Modifier {
    val shape = dsRounded(radius)
    return dsShadow(DS.Shadow.depthSlab, shape).background(fill, shape)
}

/** A floating slab (mini player, transport tray): stronger lift and a hairline ring (iOS `dsFloat`). */
@Composable
fun Modifier.dsFloat(radius: Dp = DS.Radius.radiusTray): Modifier {
    val shape = dsRounded(radius)
    return dsShadow(DS.Shadow.depthLift, shape).background(DS.colors.surface, shape).border(DS.Stroke.strokeHairline, DS.colors.line, shape)
}

/**
 * A tap target without the Material ripple: the content dims while pressed, like the iOS button styles.
 * [label] is what TalkBack reads for the action.
 */
@Composable
fun Modifier.dsClickable(
    enabled: Boolean = true,
    role: Role? = Role.Button,
    label: String? = null,
    pressedAlpha: Float = 0.7f,
    onClick: () -> Unit,
): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val alpha = if (!enabled) 0.4f else if (pressed) pressedAlpha else 1f
    return alpha(alpha).clickable(interactionSource = source, indication = null, enabled = enabled, onClickLabel = label, role = role, onClick = onClick)
}

/** Text in a token style and colour. */
@Composable
fun DSText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = DS.Type.body,
    color: Color = DS.colors.ink,
    maxLines: Int = Int.MAX_VALUE,
    align: TextAlign? = null,
    weight: FontWeight? = null,
) {
    var merged = style.copy(color = color)
    if (weight != null) merged = merged.copy(fontWeight = weight)
    if (align != null) merged = merged.copy(textAlign = align)
    BasicText(text = text, modifier = modifier, style = merged, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

/** The eyebrow above a group of rows (iOS `SectionLabel`). */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    DSText(text, modifier.padding(start = DS.Space.space1).semantics { heading() }, DS.Type.caption, DS.colors.inkMuted, weight = FontWeight.W600)
}

/** Signal dot; [glow] adds the halo of a lit LED. */
@Composable
fun LED(color: Color, modifier: Modifier = Modifier, size: Dp = DS.Component.dotSm, glow: Boolean = false) {
    val base = if (glow) modifier.dropShadow(CircleShape, Shadow(radius = 3.dp, color = color.copy(alpha = 0.8f))) else modifier
    Box(base.size(size).background(color, CircleShape))
}

enum class DSButtonKind { Outline, Quiet, Danger, Primary }

/** The capsule button (iOS `DSButtonStyle`); `Primary` is the filled one used for the main action of a sheet. */
@Composable
fun DSButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: DSButtonKind = DSButtonKind.Outline,
    enabled: Boolean = true,
) {
    val colors = DS.colors
    val shape = CircleShape
    val decorated = when (kind) {
        DSButtonKind.Outline -> Modifier.border(DS.Stroke.strokeThin, colors.accentInk, shape)
        DSButtonKind.Quiet -> Modifier.dsShadow(DS.Shadow.depthKey, shape).background(colors.surfaceKey, shape)
        DSButtonKind.Danger -> Modifier.border(DS.Stroke.strokeThin, colors.power, shape)
        DSButtonKind.Primary -> Modifier.background(colors.strongFill, shape)
    }
    val ink = when (kind) {
        DSButtonKind.Outline -> colors.accentInk
        DSButtonKind.Primary -> colors.onStrong
        else -> colors.ink
    }
    Box(
        modifier.defaultMinSize(minHeight = DS.Space.hit).dsClickable(enabled = enabled, onClick = onClick).then(decorated).clip(shape)
            .padding(horizontal = DS.Space.space4),
        contentAlignment = Alignment.Center,
    ) {
        DSText(text, style = DS.Type.subheadStrong, color = ink, maxLines = 2, align = TextAlign.Center)
    }
}

/** An icon alone as a button, with the 44dp hit area. */
@Composable
fun DSIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = DS.Icon.iconNavLg,
    tint: Color = DS.colors.ink,
    enabled: Boolean = true,
) {
    Box(
        modifier.defaultMinSize(DS.Space.hit, DS.Space.hit).dsClickable(enabled = enabled, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { DSIcon(icon, size = size, tint = tint) }
}

/** The 44dp lit round button (accent fill, on-accent glyph, glow): the + in the Library header. */
@Composable
fun LitCircleButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(DS.Space.hit).dsClickable(pressedAlpha = 0.8f, onClick = onClick).semantics { contentDescription = label }
            .dsShadow(DS.Shadow.depthGlow, CircleShape).background(DS.colors.accent, CircleShape),
        contentAlignment = Alignment.Center,
    ) { DSIcon(icon, size = DS.Icon.iconNavLg, tint = DS.colors.onAccent) }
}

/** A filter category with its count; lit while it has a selection (iOS `CategoryChip`). */
@Composable
fun CategoryChip(title: String, count: Int, onClick: () -> Unit, modifier: Modifier = Modifier, selected: Int = 0) {
    val on = selected > 0
    val colors = DS.colors
    val shape = CircleShape
    val base = if (on) Modifier.background(colors.strongFill, shape) else Modifier.dsShadow(DS.Shadow.depthSlab, shape).background(colors.surface, shape)
    Row(
        modifier.defaultMinSize(minHeight = DS.Control.control)
            .dsClickable(onClick = onClick).semantics { contentDescription = "$title, ${if (on) "$selected selected" else "$count"}" }
            .then(base).padding(horizontal = DS.Space.space3),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space1, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(title, style = DS.Type.subhead, color = if (on) colors.onStrong else colors.ink, maxLines = 1, weight = if (on) FontWeight.W600 else FontWeight.W500)
        DSText("${if (on) selected else count}", style = DS.Type.caption, color = if (on) colors.onStrong else colors.inkMuted, maxLines = 1)
    }
}

/** A value chip: a sunken pill when off, the strong fill when on (iOS `TagChip`). */
@Composable
fun TagChip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, count: Int? = null, on: Boolean = false, removable: Boolean = false) {
    val colors = DS.colors
    val ink = if (on) colors.onStrong else colors.ink
    Row(
        modifier.defaultMinSize(minHeight = DS.Control.control)
            .dsClickable(onClick = onClick).semantics { contentDescription = if (removable) "Remove $text" else text; selected = on }
            .background(if (on) colors.strongFill else colors.surfaceSunken, CircleShape).padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(text, style = DS.Type.subhead, color = ink, maxLines = 1, weight = if (on) FontWeight.W600 else FontWeight.W500)
        if (count != null) DSText("$count", style = DS.Type.caption, color = if (on) colors.onStrong else colors.inkMuted, weight = FontWeight.W500)
        if (removable) DSIcon(Icons.clear, size = DS.Icon.iconXs, tint = ink)
    }
}

/** An outlined pill that is tinted when on: the "Downloaded N" toggle (iOS `ToggleChip`). */
@Composable
fun ToggleChip(title: String, count: Int, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DS.colors
    Row(
        modifier.defaultMinSize(minHeight = DS.Component.iconButton)
            .dsClickable(onClick = onClick).semantics { contentDescription = "$title, $count songs"; selected = on }
            .background(if (on) colors.accentTint else Color.Transparent, CircleShape)
            .border(DS.Stroke.strokeThin, if (on) colors.accentInk else colors.line, CircleShape).padding(horizontal = DS.Space.space3),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(title, style = DS.Type.caption, color = if (on) colors.accentInk else colors.ink, weight = FontWeight.W500, maxLines = 1)
        DSText("$count", style = DS.Type.caption, color = if (on) colors.accentInk else colors.inkMuted, maxLines = 1)
    }
}

/** The 48 x 28 switch: accent-strong track when on, sunken track when off, round paper thumb (iOS `DSSwitchStyle`). */
@Composable
fun DSSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val colors = DS.colors
    val thumb = DS.Component.switchThumb
    val travel by animateDpAsState(if (checked) 48.dp - thumb - 4.dp else 0.dp, tween(DS.Motion.durFast), label = "switch")
    Box(
        modifier.defaultMinSize(DS.Space.hit, DS.Space.hit)
            .dsClickable(enabled = enabled, role = Role.Switch, pressedAlpha = 1f) { onCheckedChange(!checked) }
            .semantics { contentDescription = label; stateDescription = if (checked) "On" else "Off" },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(48.dp, 28.dp).background(if (checked) colors.accentStrong else colors.surfaceSunken, CircleShape).padding(2.dp)) {
            Box(
                Modifier.offset(x = travel).size(thumb).dsShadow(DS.Shadow.depthThumb, CircleShape)
                    .background(if (LocalDarkTheme.current) colors.ink else colors.surface, CircleShape),
            )
        }
    }
}

/** A one-line text field on the sunken fill with the placeholder in ink-muted (iOS `DSTextField`). */
@Composable
fun DSTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    keyboardOptions: KeyboardOptions = KeyboardOptions(keyboardType = keyboardType),
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = true,
    leading: (@Composable RowScope.() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val colors = DS.colors
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.semantics { if (value.isEmpty()) contentDescription = placeholder },
        textStyle = DS.Type.subhead.copy(color = colors.ink),
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        cursorBrush = SolidColor(colors.accentInk),
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.fieldHeight)
                    .background(colors.surfaceSunken, dsRounded(DS.Radius.radiusKey)).padding(horizontal = DS.Space.space3),
                horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                leading?.invoke(this)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) DSText(placeholder, style = DS.Type.subhead, color = colors.inkMuted, maxLines = 1)
                    inner()
                }
                trailing?.invoke(this)
            }
        },
    )
}

/** A hairline separator between rows. */
@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(DS.Stroke.strokeHairline).background(DS.colors.line))
}

/** The grab handle at the top of a sheet. */
@Composable
fun SheetGrabber(modifier: Modifier = Modifier) {
    Box(modifier.padding(top = DS.Space.space2).size(DS.Control.grabW, DS.Control.grabH).background(DS.colors.inkFaint, CircleShape))
}

/** A settings-style row: label on the left, a value or control on the right, at least `rowHeight` tall. */
@Composable
fun DSRow(label: String, modifier: Modifier = Modifier, sublabel: String? = null, trailing: (@Composable RowScope.() -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight).padding(horizontal = DS.Space.space4, vertical = DS.Space.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
            DSText(label, style = DS.Type.body)
            if (sublabel != null) DSText(sublabel, style = DS.Type.caption, color = DS.colors.inkMuted)
        }
        if (trailing != null) {
            Spacer(Modifier.width(DS.Space.space3))
            trailing()
        }
    }
}

/** A confirmation before a destructive action (IOS-125): title, explanation, the destructive action and Cancel. */
@Composable
fun DSConfirmDialog(title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        androidx.compose.foundation.layout.Column(
            Modifier.fillMaxWidth().dsFloat(DS.Radius.radiusCard).padding(DS.Space.space5),
            verticalArrangement = Arrangement.spacedBy(DS.Space.space3),
        ) {
            DSText(title, Modifier.semantics { heading() }, DS.Type.headline)
            DSText(message, style = DS.Type.subhead, color = DS.colors.inkMuted)
            Row(Modifier.fillMaxWidth().padding(top = DS.Space.space2), horizontalArrangement = Arrangement.spacedBy(DS.Space.space3)) {
                DSButton("Cancel", onDismiss, Modifier.weight(1f), DSButtonKind.Quiet)
                DSButton(confirm, { onDismiss(); onConfirm() }, Modifier.weight(1f), DSButtonKind.Danger)
            }
        }
    }
}
