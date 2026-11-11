package com.alexisayenko.audioplayer.android.ui.songform

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.data.Outcome
import com.alexisayenko.audioplayer.android.logic.libraryMatch
import com.alexisayenko.audioplayer.android.logic.trimSpaces
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSButton
import com.alexisayenko.audioplayer.android.ui.DSButtonKind
import com.alexisayenko.audioplayer.android.ui.DSConfirmDialog
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.SheetGrabber
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsFloat
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.onStrong
import com.alexisayenko.audioplayer.android.ui.strongFill
import kotlinx.coroutines.launch

/** A small turning arc for "busy" inside a button or a header; TalkBack reads [label]. */
@Composable
internal fun DSSpinner(label: String, modifier: Modifier = Modifier, size: Dp = DS.Icon.iconAction, color: Color = DS.colors.accentInk) {
    val turn by rememberInfiniteTransition(label = "spinner").animateFloat(0f, 360f, infiniteRepeatable(tween(DS.Motion.durPulse, easing = LinearEasing)), label = "turn")
    val stroke = DS.Stroke.strokeMedium
    Canvas(modifier.size(size).graphicsLayer { rotationZ = turn }.semantics { contentDescription = label }) {
        val w = stroke.toPx()
        drawArc(color, 0f, 270f, false, Offset(w / 2, w / 2), Size(this.size.width - w, this.size.height - w), style = Stroke(w, cap = StrokeCap.Round))
    }
}

/** A word that is a button: "Cancel", "Save", "Play" in the accent ink, with the 44dp hit area. */
@Composable
private fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, small: Boolean = false, align: Alignment = Alignment.Center) {
    Box(modifier.defaultMinSize(DS.Space.hit, DS.Space.hit).dsClickable(enabled = enabled, onClick = onClick), contentAlignment = align) {
        DSText(text, style = if (small) DS.Type.caption else DS.Type.subheadStrong, color = DS.colors.accentInk, maxLines = 1, weight = FontWeight.W600)
    }
}

/**
 * The bottom sheet both forms sit in: full height, the surface colour, the tray corner and the grab handle of the
 * design system, nothing of Material's own look. [confirmHide] is asked before a swipe, the back button or a tap
 * outside may close it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SongSheet(onDismiss: () -> Unit, confirmHide: () -> Boolean = { true }, content: @Composable ColumnScope.() -> Unit) {
    val confirm by rememberUpdatedState(confirmHide)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != androidx.compose.material3.SheetValue.Hidden || confirm() })
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = DS.Radius.radiusTray, topEnd = DS.Radius.radiusTray),
        containerColor = DS.colors.surface,
        contentColor = DS.colors.ink,
        tonalElevation = 0.dp,
        scrimColor = DS.colors.coverScrim,
        dragHandle = { SheetGrabber() },
    ) {
        Column(Modifier.fillMaxSize(), content = content)
    }
}

/**
 * The Add flow as a sheet over Library (Swift `AddSheet`, IOS-020): paste a YouTube or SoundCloud link, Fetch,
 * edit the preview in [SongForm], "Add to library". The download, when asked for, continues on the song's Library row.
 * [initialLink] is the link that arrived through the Android share sheet, or null. YouTube text search is not in v1 (AND-039).
 */
@Composable
fun AddSongSheet(initialLink: String?, onDismiss: () -> Unit) {
    SongSheet(onDismiss) { AddSongContent(initialLink, onDismiss) }
}

/** What [AddSongSheet] shows, without the sheet around it; [state] can be handed in already filled. */
@Composable
fun AddSongContent(
    initialLink: String?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    state: AddSongState = remember { AddSongState(initialLink) },
) {
    val graph = LocalAppGraph.current
    val colors = DS.colors
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val haptics = LocalHapticFeedback.current
    val songs by graph.library.songs.collectAsState()
    val phoneIds by graph.library.phoneIds.collectAsState()
    val autoDownload by graph.settings.downloadNewAutomatically.collectAsState()
    val session by graph.account.session.collectAsState()

    val waiting = state.phase == AddSongState.Phase.Idle || state.phase == AddSongState.Phase.Loading
    val known = if (waiting) libraryMatch(state.url, songs) else null
    val failed = state.phase == AddSongState.Phase.Idle && state.message != null
    val fetchOff = state.busy || state.url.trimSpaces().isEmpty() || known != null || session == null
    val preview = state.preview

    fun fetch() {
        if (fetchOff) return
        focus.clearFocus()
        scope.launch { state.loadPreview(graph.library) }
    }

    fun save(download: Boolean) {
        focus.clearFocus()
        scope.launch { state.save(graph.library, download) }
    }

    LaunchedEffect(state.phase) {
        if (state.phase == AddSongState.Phase.Saved) {
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            onDismiss()
        }
    }

    Column(modifier.fillMaxSize().background(colors.surface).imePadding()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = DS.Space.space4).padding(top = DS.Space.space2, bottom = DS.Space.space4),
            verticalArrangement = Arrangement.spacedBy(DS.Space.space4),
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    DSText("Add a song", Modifier.weight(1f).semantics { heading() }, DS.Type.title)
                    TextAction("Cancel", onDismiss, align = Alignment.CenterEnd)
                }
                DSText(
                    "YouTube link or video id, or SoundCloud link" + if (autoDownload) "; downloaded to this phone" else "",
                    style = DS.Type.caption,
                    color = colors.inkMuted,
                )
            }

            if (!state.hasPreview) {
                Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
                    LinkField(state, fetchOff, failed, ::fetch)
                    if (session == null) FormNote("Sign in on the Settings tab to add songs.")
                    if (known != null) {
                        KnownSong(known, onPhone = known.id in phoneIds) {
                            graph.player.playNow(known)
                            onDismiss()
                        }
                    }
                    val message = state.message
                    if (failed && message != null) FormNote(message, error = true)
                }
            }

            if (preview != null && state.hasPreview) {
                if (preview.in_library == true) {
                    FormNote("This song is already in your library.", error = true)
                    val saved = songs.firstOrNull { it.id == preview.id }
                    if (saved != null && saved.id in phoneIds) {
                        DSButton("Play now", {
                            graph.player.playNow(saved)
                            onDismiss()
                        }, kind = DSButtonKind.Primary)
                    } else if (saved != null) {
                        DSButton("Download to phone", {
                            graph.library.download(saved)
                            onDismiss()
                        })
                    }
                }
                SongForm(state)
            } else if (failed) {
                DSButton("Add to library", {}, Modifier.fillMaxWidth(), DSButtonKind.Primary, enabled = false)
            }
        }

        if (preview != null && state.hasPreview) {
            val saving = state.phase == AddSongState.Phase.Saving
            val blocked = preview.in_library == true || state.title.trimSpaces().isEmpty() || saving
            Column(
                Modifier.navigationBarsPadding().padding(horizontal = DS.Space.space2).padding(bottom = DS.Space.space2)
                    .fillMaxWidth().dsFloat(DS.Radius.radiusTray).padding(DS.Space.space3),
                verticalArrangement = Arrangement.spacedBy(DS.Space.space1),
            ) {
                state.message?.let { FormNote(it, Modifier.padding(bottom = DS.Space.space2), error = true) }
                DSButton(if (saving) "Adding…" else "Add to library", { save(autoDownload) }, Modifier.fillMaxWidth(), DSButtonKind.Primary, enabled = !blocked)
                // With "Download new songs automatically" on, the button above already downloads.
                if (!autoDownload) TextAction("Add and download to phone", { save(true) }, Modifier.fillMaxWidth(), enabled = !blocked)
            }
        }
    }
}

/** The link field with Fetch inside it; a red ring while the last Fetch failed. */
@Composable
private fun LinkField(state: AddSongState, fetchOff: Boolean, failed: Boolean, fetch: () -> Unit) {
    val colors = DS.colors
    val shape = dsRounded(DS.Radius.radiusKey)
    val placeholder = "YouTube or SoundCloud link"
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight).background(colors.surfaceSunken, shape)
            .then(if (failed) Modifier.border(DS.Stroke.strokeThin, colors.power, shape) else Modifier)
            .padding(start = DS.Space.space4, end = DS.Space.space2),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = state.url,
            onValueChange = state::onUrlInput,
            modifier = Modifier.weight(1f).semantics { contentDescription = placeholder },
            textStyle = DS.Type.subhead.copy(color = colors.ink),
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { fetch() }),
            cursorBrush = SolidColor(colors.accentInk),
            decorationBox = { inner ->
                Box(Modifier.defaultMinSize(minHeight = DS.Space.hit), contentAlignment = Alignment.CenterStart) {
                    if (state.url.isEmpty()) DSText(placeholder, style = DS.Type.subhead, color = colors.inkMuted, maxLines = 1)
                    inner()
                }
            },
        )
        Box(
            Modifier.defaultMinSize(minWidth = 64.dp, minHeight = DS.Control.control).alpha(if (fetchOff) 0.5f else 1f)
                .dsClickable(enabled = !fetchOff, pressedAlpha = 0.7f, onClick = fetch)
                .background(colors.strongFill, CircleShape).padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (state.phase == AddSongState.Phase.Loading) {
                DSSpinner("Fetching", color = colors.onStrong)
            } else {
                DSText("Fetch", style = DS.Type.subheadStrong, color = colors.onStrong, maxLines = 1)
            }
        }
    }
}

/** "Already in your library": the pasted link is a song the library holds; Play when it is on this phone (IOS-062). */
@Composable
private fun KnownSong(song: Song, onPhone: Boolean, onPlay: () -> Unit) {
    val colors = DS.colors
    val text = "Already in your library: " + listOf(song.title, song.artist).filter { it.isNotEmpty() }.joinToString(" · ")
    Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space2), verticalAlignment = Alignment.CenterVertically) {
        DSIcon(Icons.check, size = DS.Icon.iconInline, tint = colors.accentInk)
        DSText(text, Modifier.weight(1f), DS.Type.caption, maxLines = 2)
        if (onPhone) TextAction("Play", onPlay, Modifier.clearAndSetSemantics { contentDescription = "Play ${song.title}" }, small = true)
    }
}

/**
 * The Edit form as a sheet over [song] (the form part of the Swift `SongEditView`): Cancel, "Song", Save.
 * Save calls `library.update`; closing with unsaved changes asks first.
 */
@Composable
fun EditSongSheet(song: Song, onDismiss: () -> Unit) {
    val state = remember(song.id) { SongFormState(song) }
    var confirmDiscard by remember { mutableStateOf(false) }
    SongSheet(
        onDismiss = onDismiss,
        confirmHide = {
            if (state.hasChanges) confirmDiscard = true
            !state.hasChanges
        },
    ) {
        EditSongContent(song, onDismiss, state = state, onCancel = { if (state.hasChanges) confirmDiscard = true else onDismiss() })
    }
    if (confirmDiscard) {
        DSConfirmDialog("Discard changes?", "Your edits to \"${song.title}\" are not saved.", "Discard", onConfirm = onDismiss, onDismiss = { confirmDiscard = false })
    }
}

/**
 * What [EditSongSheet] shows, without the sheet around it, so the song details sheet can show the form in place
 * (AND-035). [onCancel] runs for the Cancel word; by default it closes without asking.
 */
@Composable
fun EditSongContent(
    song: Song,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    state: SongFormState = remember(song.id) { SongFormState(song) },
    onCancel: () -> Unit = onDismiss,
) {
    val graph = LocalAppGraph.current
    val colors = DS.colors
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var saving by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    fun save() {
        focus.clearFocus()
        saving = true
        note = null
        scope.launch {
            when (val r = graph.library.update(state.toSong(song))) {
                is Outcome.Ok -> onDismiss()
                is Outcome.Failed -> note = r.message
            }
            saving = false
        }
    }

    Column(modifier.fillMaxSize().background(colors.surface).imePadding()) {
        Box(Modifier.fillMaxWidth().padding(horizontal = DS.Space.space4), contentAlignment = Alignment.Center) {
            DSText("Song", Modifier.semantics { heading() }, DS.Type.headline)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                TextAction("Cancel", onCancel, align = Alignment.CenterStart)
                if (saving) {
                    Box(Modifier.size(DS.Space.hit), contentAlignment = Alignment.CenterEnd) { DSSpinner("Saving") }
                } else {
                    TextAction("Save", ::save, enabled = state.title.trimSpaces().isNotEmpty(), align = Alignment.CenterEnd)
                }
            }
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding()
                .padding(horizontal = DS.Space.space4).padding(top = DS.Space.space2, bottom = DS.Space.space4),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            note?.let { FormNote(it, error = true) }
            SongForm(state)
        }
    }
}
