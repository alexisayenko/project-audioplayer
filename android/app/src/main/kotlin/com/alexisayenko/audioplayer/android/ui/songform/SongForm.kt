package com.alexisayenko.audioplayer.android.ui.songform

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.logic.COUNTRY_CAP
import com.alexisayenko.audioplayer.android.logic.GENRE_CAP
import com.alexisayenko.audioplayer.android.logic.TagCount
import com.alexisayenko.audioplayer.android.logic.formatTime
import com.alexisayenko.audioplayer.android.logic.genresFromTags
import com.alexisayenko.audioplayer.android.logic.hasTag
import com.alexisayenko.audioplayer.android.logic.sourceLabel
import com.alexisayenko.audioplayer.android.logic.splitTagInput
import com.alexisayenko.audioplayer.android.logic.suggestGenres
import com.alexisayenko.audioplayer.android.logic.tagCounts
import com.alexisayenko.audioplayer.android.logic.tagGroups
import com.alexisayenko.audioplayer.android.logic.tagKey
import com.alexisayenko.audioplayer.android.logic.tagLabel
import com.alexisayenko.audioplayer.android.logic.trimSpaces
import com.alexisayenko.audioplayer.android.logic.wikiDisplay
import com.alexisayenko.audioplayer.android.logic.wikiNormalize
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.DSTextField
import com.alexisayenko.audioplayer.android.ui.SectionLabel
import com.alexisayenko.audioplayer.android.ui.TagChip
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons

private val hiddenKeys = setOf("lang", "genre", "country")
private val captionGap = 2.dp

/** A one-line note under a form: an info line, or an error with the red glyph (Swift `FormNote`). */
@Composable
fun FormNote(text: String, modifier: Modifier = Modifier, error: Boolean = false) {
    val colors = DS.colors
    Row(
        modifier.semantics(mergeDescendants = true) { if (error) contentDescription = "Error: $text" },
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSIcon(if (error) Icons.warning else Icons.info, size = DS.Icon.iconInline, tint = if (error) colors.power else colors.inkMuted)
        DSText(text, Modifier.weight(1f), DS.Type.caption, if (error) colors.ink else colors.inkMuted)
    }
}

@Composable
private fun Caption(text: String) {
    DSText(text, style = DS.Type.caption, color = DS.colors.inkMuted, weight = FontWeight.W600)
}

@Composable
private fun Labeled(label: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier, keyboardType: KeyboardType = KeyboardType.Text) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(captionGap)) {
        Caption(label)
        // DSTextField names itself by its placeholder only while empty; with text in it TalkBack still needs the name.
        DSTextField(value, onValueChange, label, Modifier.semantics { if (value.isNotEmpty()) contentDescription = label }, keyboardType = keyboardType)
    }
}

@Composable
private fun ReadOnly(label: String, text: String) {
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(captionGap)) {
        Caption(label)
        DSText(text, style = DS.Type.body)
    }
}

/**
 * The song fields shared by Add and Edit (AND-037): a Compose port of the Swift `SongFormView`, field for field and
 * in the same order: Title, Artist and Remix as pill fields, the "Wikipedia says" hint, Album and Year, the BPM
 * line, Genres with suggestions, Countries, Tags and the two Wikipedia links. Above them stands the song's cover
 * with its length and source, below them its link, read-only.
 *
 * BPM is never typed (IOS-069): the Add form says it is detected after saving, the Edit form shows the detected value.
 * Typed text that is not a chip yet is committed by [SongFormState.commitPending], which saving calls.
 */
@Composable
fun SongForm(state: SongFormState, modifier: Modifier = Modifier) {
    val songs by LocalAppGraph.current.library.songs.collectAsState()
    val drag = remember { TokenDragController() }
    var origin by remember { mutableStateOf(Offset.Zero) }
    var addingTags by remember { mutableStateOf(false) }
    val pool = remember(songs) { tagCounts(songs.map { it.tags ?: emptyList() }) }
    val libraryGenres = remember(songs) { genresFromTags(songs.map { it.tags ?: emptyList() }) }

    fun target(kind: TokenKind) = when (kind) {
        TokenKind.Title -> TokenTarget(kind, { state.title }, { state.title = it })
        TokenKind.Artist -> TokenTarget(kind, { state.artist }, { state.artist = it })
        TokenKind.Remixer -> TokenTarget(kind, { state.remixer }, { state.remixer = it })
    }

    fun moves(from: TokenKind) = TokenKind.entries.filter { it != from && !(state.remixLocked && it == TokenKind.Remixer) }.map(::target)

    @Composable
    fun tokenField(kind: TokenKind) {
        val t = target(kind)
        Column(verticalArrangement = Arrangement.spacedBy(captionGap)) {
            Caption(kind.label)
            TokenField(kind, t.text(), t.setText, moves(kind))
        }
    }

    Box(modifier.onGloballyPositioned { origin = it.positionInRoot() }) {
        CompositionLocalProvider(LocalTokenDrag provides drag) {
            Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space4)) {
                Summary(state)

                Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space3)) {
                    tokenField(TokenKind.Title)
                    tokenField(TokenKind.Artist)
                    state.featuredSummary?.let { ReadOnly("Featured", it) }
                    val version = state.versionSummary
                    if (state.remixLocked && version != null) ReadOnly("Version", version) else tokenField(TokenKind.Remixer)
                    state.hint?.let { SuggestionHint(it) { state.applyHint() } }
                    state.metaNote?.let { FormNote(it, error = it == "Couldn't load metadata") }
                    Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space3), verticalAlignment = Alignment.Top) {
                        Labeled("Album", state.album, { state.album = it }, Modifier.weight(1f))
                        Labeled("Year", state.year, { state.year = it }, Modifier.width(96.dp), KeyboardType.Number)
                    }
                    BpmRow(state)
                }

                NamespaceField("Genres", "genre", GENRE_CAP, state.tags, { state.tags = it }, state.pendingGenre, { state.pendingGenre = it }, libraryGenres)
                NamespaceField("Countries", "country", COUNTRY_CAP, state.tags, { state.tags = it }, state.pendingCountry, { state.pendingCountry = it }, emptyList())

                Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
                    Caption("Tags")
                    TagFlow(
                        tags = state.tags.filter { tagKey(it) !in hiddenKeys },
                        adding = addingTags,
                        onRemove = { t -> state.tags = state.tags.filter { it != t } },
                        onAdd = { addingTags = !addingTags },
                    )
                    if (addingTags) {
                        TagEditor(state.tags, { state.tags = it }, state.suggested, pool, state.pendingTag, { state.pendingTag = it })
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space3), verticalAlignment = Alignment.Top) {
                    WikiLinkField("Wikipedia: song", state.wikiSong, { state.wikiSong = it }, Modifier.weight(1f))
                    WikiLinkField("Wikipedia: band", state.wikiArtist, { state.wikiArtist = it }, Modifier.weight(1f))
                }

                state.sourceUrl?.takeIf { it.isNotEmpty() }?.let { SourceLink(it, sourceLabel(state.source)) }
            }
        }
        TokenDragGhost(drag, origin)
    }
}

/** The cover with the song's name, length and source: the preview line of the Swift Add sheet. */
@Composable
private fun Summary(state: SongFormState) {
    val colors = DS.colors
    val summary = listOf(state.artist, state.year).filter { it.isNotEmpty() }.joinToString(" · ")
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        CoverImage(state.cover, Modifier.size(DS.Component.coverLg).clip(dsRounded(DS.Radius.radiusSm)))
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(captionGap)) {
            DSText(state.title.ifEmpty { "Untitled" }, style = DS.Type.headline, maxLines = 2)
            if (summary.isNotEmpty()) DSText(summary, style = DS.Type.subhead, color = colors.inkMuted, maxLines = 1)
            Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space2), verticalAlignment = Alignment.CenterVertically) {
                state.duration?.let { DSText(formatTime(it), style = DS.Type.time, color = colors.inkMuted) }
                DSText(
                    sourceLabel(state.source),
                    Modifier.background(colors.surfaceSunken, CircleShape).padding(horizontal = DS.Space.space2, vertical = DS.Space.space1 / 2),
                    DS.Type.micro,
                    colors.inkMuted,
                    weight = FontWeight.W600,
                )
            }
        }
    }
}

@Composable
private fun BpmRow(state: SongFormState) {
    val colors = DS.colors
    if (state.base == null) {
        DSText("BPM is detected after saving", style = DS.Type.caption, color = colors.inkMuted)
    } else {
        val bpm = state.bpm
        Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(captionGap)) {
            Caption("BPM")
            DSText(if (bpm == null) "Not detected yet" else "$bpm BPM", style = DS.Type.body, color = if (bpm == null) colors.inkMuted else colors.ink)
        }
    }
}

@Composable
private fun SuggestionHint(hint: SongHint, onApply: () -> Unit) {
    val colors = DS.colors
    val parts = listOfNotNull(hint.artist, hint.title)
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit).dsClickable(onClick = onApply)
            .clearAndSetSemantics { contentDescription = "Use Wikipedia's artist and title: ${parts.joinToString(" - ")}" },
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSIcon(Icons.sparkles, size = DS.Icon.iconInline, tint = colors.accentInk)
        DSText("Wikipedia says: ${parts.joinToString(" / ")}", Modifier.weight(1f), DS.Type.caption, colors.accentInk, weight = FontWeight.W600)
    }
}

/** Where the song came from, read-only; a tap opens the link. */
@Composable
private fun SourceLink(url: String, source: String) {
    val colors = DS.colors
    val opener = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(captionGap)) {
        Caption("Link")
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit)
                .dsClickable(label = "Open on $source") { runCatching { opener.openUri(url) } }
                .semantics { contentDescription = "$source link, $url" },
            horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DSIcon(Icons.link, size = DS.Icon.iconInline, tint = colors.accentInk)
            DSText(url.removePrefix("https://").removePrefix("http://").removePrefix("www."), Modifier.weight(1f), DS.Type.subhead, colors.inkMuted, maxLines = 1)
            DSIcon(Icons.externalLink, size = DS.Icon.iconInline, tint = colors.inkMuted)
        }
    }
}

/** A tag on the song: accent-tint pill, ink label and the remove glyph (Swift `TagPill`). */
@Composable
private fun TagPill(text: String, onRemove: () -> Unit) {
    val colors = DS.colors
    Row(
        Modifier.defaultMinSize(minHeight = DS.Component.iconButton).dsClickable(onClick = onRemove).semantics { contentDescription = "Remove $text" }
            .background(colors.accentTint, CircleShape).padding(horizontal = DS.Space.space3),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText(text, style = DS.Type.subhead, maxLines = 1, weight = FontWeight.W500)
        DSIcon(Icons.clear, size = DS.Icon.iconXs, tint = colors.accentInk)
    }
}

/** The outlined round "+" that opens the tag editor (Swift `AddTagButton`). */
@Composable
private fun AddTagButton(open: Boolean, onClick: () -> Unit) {
    val colors = DS.colors
    Box(
        Modifier.size(DS.Component.iconButton).dsClickable(onClick = onClick).semantics { contentDescription = if (open) "Hide tag editor" else "Add tag" }
            .border(DS.Stroke.strokeThin, colors.line, CircleShape),
        contentAlignment = Alignment.Center,
    ) { DSIcon(if (open) Icons.chevronUp else Icons.plus, size = DS.Icon.iconInline, tint = colors.accentInk) }
}

/** A song's tags as removable pills with the "+" after them; the last pill and the "+" wrap together (Swift `TagFlow`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagFlow(tags: List<String>, adding: Boolean, onRemove: (String) -> Unit, onAdd: () -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(DS.Space.space2), verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
        for (t in tags.dropLast(1)) TagPill(tagLabel(t)) { onRemove(t) }
        Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space2), verticalAlignment = Alignment.CenterVertically) {
            tags.lastOrNull()?.let { last -> TagPill(tagLabel(last)) { onRemove(last) } }
            AddTagButton(adding, onAdd)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipFlow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(DS.Space.space2), verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) { content() }
}

/** Chosen tags, suggestions and the library's tags to pick from (Swift `TagEditor`, a port of web/js/tag-editor.js). */
@Composable
private fun TagEditor(
    tags: List<String>,
    onTags: (List<String>) -> Unit,
    suggested: List<String>,
    pool: List<TagCount>,
    input: String,
    onInput: (String) -> Unit,
) {
    val colors = DS.colors
    var showPool by remember { mutableStateOf(false) }
    fun toggle(t: String) = onTags(if (hasTag(tags, t)) tags.filter { !it.equals(t, ignoreCase = true) } else tags + t)
    fun commit(text: String) {
        val r = splitTagInput(text)
        var out = tags
        for (t in r.tags) if (!hasTag(out, t) && tagKey(t) !in hiddenKeys) out = out + t
        if (out != tags) onTags(out)
        onInput(r.rest)
    }

    Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space3)) {
        DSTextField(
            input,
            { if (it.contains(',')) commit(it) else onInput(it) },
            "Add a tag (plain or key:value)",
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { commit(input) }),
        )
        val open = suggested.filter { !hasTag(tags, it) && tagKey(it) !in hiddenKeys }
        if (open.isNotEmpty()) {
            SectionLabel("Suggested")
            ChipFlow { for (t in open) TagChip(tagLabel(t), { toggle(t) }) }
        }
        if (pool.isNotEmpty()) {
            val shown = showPool || input.isNotEmpty()
            Row(
                Modifier.defaultMinSize(minHeight = DS.Space.hit).dsClickable { showPool = !showPool },
                horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                DSIcon(if (shown) Icons.chevronUp else Icons.chevron, size = DS.Icon.iconInline, tint = colors.accentInk)
                DSText(if (shown) "Hide library tags" else "Library tags", style = DS.Type.subheadStrong, color = colors.accentInk)
            }
            if (shown) {
                val q = input.trimSpaces().lowercase()
                val groups = tagGroups(pool.filter { tagKey(it.tag) !in hiddenKeys }.filter { q.isEmpty() || it.tag.lowercase().contains(q) || tagLabel(it.tag).lowercase().contains(q) })
                for (g in groups) {
                    SectionLabel(g.name)
                    ChipFlow { for (t in g.tags) TagChip(tagLabel(t.tag), { toggle(t.tag) }, count = t.count, on = hasTag(tags, t.tag)) }
                }
            }
        }
    }
}

/**
 * A chip field that is a view over one namespaced tag (`genre:`, `country:`), capped (Swift `NamespaceField`).
 * A comma or a slash commits what was typed before it; Done and leaving the field commit the rest. Genres offer
 * up to six suggestions from [genres] under the field (IOS-067).
 */
@Composable
private fun NamespaceField(
    title: String,
    key: String,
    cap: Int,
    tags: List<String>,
    onTags: (List<String>) -> Unit,
    input: String,
    onInput: (String) -> Unit,
    genres: List<String>,
) {
    var note by remember { mutableStateOf<String?>(null) }
    var focused by remember { mutableStateOf(false) }
    val mine = tags.filter { tagKey(it) == key }
    val placeholder = if (key == "country") "Add a country" else "Add a genre"

    fun commit(text: String, final: Boolean = true) {
        val r = commitNamespaced(tags, key, cap, text, final)
        note = r.note
        if (r.tags != tags) onTags(r.tags)
        onInput(r.input)
    }

    Column(verticalArrangement = Arrangement.spacedBy(captionGap)) {
        DSText(title, Modifier.semantics { heading() }, DS.Type.caption, DS.colors.inkMuted, weight = FontWeight.W600)
        if (mine.isNotEmpty()) {
            ChipFlow(Modifier.padding(vertical = DS.Space.space1)) {
                for (t in mine) TagChip(tagLabel(t), { onTags(tags.filter { it != t }) }, on = true, removable = true)
            }
        }
        if (mine.size < cap) {
            DSTextField(
                input,
                { if (it.any(::isNamespaceSeparator)) commit(it, final = false) else onInput(it) },
                placeholder,
                Modifier.onFocusChanged {
                    if (focused && !it.isFocused) commit(input)
                    focused = it.isFocused
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = if (key == "country") KeyboardCapitalization.Words else KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { commit(input) }),
            )
            val hints = if (key == "genre") suggestGenres(lastNamespacePart(input), genres, mine.map(::tagLabel)) else emptyList()
            if (hints.isNotEmpty()) {
                ChipFlow(Modifier.padding(top = DS.Space.space1)) {
                    for (g in hints) TagChip(g, { commit(replaceLastNamespacePart(input, g)) })
                }
            }
        }
        note?.let { DSText(it, style = DS.Type.caption, color = DS.colors.inkMuted) }
    }
}

/**
 * A Wikipedia link shown as its article name (Swift `WikiLinkField`, IOS-068): the stored value stays the full link,
 * a typed name or pasted link is stored as a link while it is typed and shown as a name once the field is left.
 */
@Composable
private fun WikiLinkField(title: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier) {
    var text by remember { mutableStateOf(wikiDisplay(value)) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(value) { if (!focused) text = wikiDisplay(value) }

    // The stored link follows the typing, so a Save tapped while the field still has focus loses nothing.
    fun type(typed: String) {
        text = typed
        val stored = if (typed == wikiDisplay(value)) value else wikiNormalize(typed)
        if (stored != value) onValueChange(stored)
    }

    fun commit() {
        text = wikiDisplay(value)
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(captionGap)) {
        Caption(title)
        DSTextField(
            text,
            ::type,
            "Article name or link",
            Modifier
                .onFocusChanged {
                    if (focused && !it.isFocused) commit()
                    focused = it.isFocused
                }
                .semantics { contentDescription = title },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { commit() }),
        )
    }
}
