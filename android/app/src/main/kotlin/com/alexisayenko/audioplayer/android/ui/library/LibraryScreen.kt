@file:OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)

package com.alexisayenko.audioplayer.android.ui.library

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.data.AudioState
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.logic.LibraryFacet
import com.alexisayenko.audioplayer.android.logic.LibraryListeningEntry
import com.alexisayenko.audioplayer.android.logic.LibraryQuery
import com.alexisayenko.audioplayer.android.logic.LibrarySort
import com.alexisayenko.audioplayer.android.logic.formatTotalLength
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSButton
import com.alexisayenko.audioplayer.android.ui.DSConfirmDialog
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.LitCircleButton
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.shell.AppTab
import com.alexisayenko.audioplayer.android.ui.shell.LocalDockHeight
import com.alexisayenko.audioplayer.android.ui.shell.LocalSelectTab
import com.alexisayenko.audioplayer.android.ui.shell.ScreenHeader
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

/** How long a first load may take before the screen says so (iOS `LibraryView.loadTimeout`, IOS-124). */
private const val LOAD_TIMEOUT_MS = 20_000L

/** Keeps the Library query (search, chips, toggles, sort, direction) across a menu switch and a rotation. */
private val LibraryQuerySaver = listSaver<LibraryQuery, Any>(
    save = { listOf(it.search, ArrayList(it.selection), it.neverListened, it.downloadedOnly, it.sort.label, it.reversed) },
    restore = { saved ->
        @Suppress("UNCHECKED_CAST")
        LibraryQuery(
            search = saved[0] as String,
            selection = (saved[1] as List<String>).toSet(),
            neverListened = saved[2] as Boolean,
            downloadedOnly = saved[3] as Boolean,
            sort = LibrarySort.fromLabel(saved[4] as String) ?: LibrarySort.Newest,
            reversed = saved[5] as Boolean,
        )
    },
)

private val LibraryFacet.icon
    get() = when (this) {
        LibraryFacet.Tags -> Icons.tag
        LibraryFacet.Genres -> Icons.music
        LibraryFacet.Era -> Icons.calendar
        LibraryFacet.Countries -> Icons.globe
    }

/**
 * The Library (iOS `LibraryView`, AND-032 to AND-034): the pinned header with the menu, the title and the lit +,
 * then one list whose first items are the search field and the chip row (they scroll away, IOS-118), the controls
 * line (Sort by, direction, "N of M songs", actions; it stays under the header) and the songs as one slab of rows.
 * Signed in it lists the catalog; signed out only the songs on the phone, and + leads to sign-in (AND-031).
 *
 * A tap plays the listed songs that are on the phone, starting at the tapped one (the current song toggles pause);
 * a tap on a song that is not on the phone opens its details. A long press opens the row's menu. Pulling down syncs
 * the catalog. [onAdd] opens the Add form; [onEdit] opens the song form for a song.
 *
 * The query lives in saved state, so search, filters and sort survive a menu switch. Listening counts are not read
 * on Android yet: the list is filtered and sorted with an empty listening map, so "Never listened" keeps every song
 * and "Last listened" is offered only once that data exists.
 */
@Composable
fun LibraryScreen(onAdd: () -> Unit, onEdit: (Song) -> Unit) {
    val graph = LocalAppGraph.current
    val library = graph.library
    val player = graph.player
    val selectTab = LocalSelectTab.current
    val focus = LocalFocusManager.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val session by graph.account.session.collectAsState()
    val songs by library.songs.collectAsState()
    val phoneIds by library.phoneIds.collectAsState()
    val transfers by library.transfers.collectAsState()
    val status by library.status.collectAsState()
    val playing by player.state.collectAsState()
    val signedIn = session != null
    val listening = remember { emptyMap<String, LibraryListeningEntry>() }

    var query by rememberSaveable(stateSaver = LibraryQuerySaver) { mutableStateOf(LibraryQuery()) }
    var facet by rememberSaveable { mutableStateOf<LibraryFacet?>(null) }
    var showSort by rememberSaveable { mutableStateOf(false) }
    var showActions by rememberSaveable { mutableStateOf(false) }
    var menuId by rememberSaveable { mutableStateOf<String?>(null) }
    var detailsId by rememberSaveable { mutableStateOf<String?>(null) }
    var removingId by rememberSaveable { mutableStateOf<String?>(null) }
    var wasSignedIn by rememberSaveable { mutableStateOf(signedIn) }
    var refreshing by remember { mutableStateOf(false) }
    var timedOut by remember { mutableStateOf(false) }
    val toast = remember { ToastState() }
    val actions = rememberSongActions(toast)
    val list = rememberLazyListState()
    val pull = rememberPullToRefreshState()

    val matches = remember(query, songs, phoneIds) { query.results(songs, phoneIds, listening) }
    val current = playing.current
    val waiting = signedIn && songs.isEmpty() &&
        (status.syncing || (!status.synced && status.reachable != false && !status.unauthorized && status.message == null))
    val loading = waiting && !timedOut
    val failed = signedIn && songs.isEmpty() && !loading && !status.synced
    val ready = !signedIn || status.synced || songs.isNotEmpty()
    val hideTools = !signedIn && songs.isEmpty()
    val expired = signedIn && (status.unauthorized || session?.expired() == true)
    val offline = signedIn && status.reachable == false
    val banner = songs.isNotEmpty() && (expired || offline)
    val leading = (if (hideTools) 0 else 2) + (if (banner) 1 else 0)

    val refresh: () -> Unit = {
        scope.launch {
            refreshing = true
            library.syncCatalog()
            refreshing = false
        }
    }
    val play: (Song) -> Unit = { song ->
        focus.clearFocus()
        if (current?.id == song.id) {
            player.toggle()
        } else {
            val phone = matches.filter { it.id in phoneIds }
            val index = phone.indexOfFirst { it.id == song.id }
            if (index >= 0) player.play(phone, index)
        }
    }
    val tap: (Song) -> Unit = { song -> if (song.id in phoneIds) play(song) else { focus.clearFocus(); detailsId = song.id } }
    val clearFilters: () -> Unit = { focus.clearFocus(); query = query.clear() }

    LaunchedEffect(signedIn) {
        if (wasSignedIn != signedIn) {
            wasSignedIn = signedIn
            query = query.clear()
            detailsId = null
            menuId = null
        }
    }
    LaunchedEffect(waiting) {
        timedOut = false
        if (waiting) {
            delay(LOAD_TIMEOUT_MS)
            timedOut = true
        }
    }
    // A new search or order starts at the top, where the search field and the chips are (IOS-118).
    LaunchedEffect(list) {
        snapshotFlow { Triple(query.search, query.sort, query.reversed) }.drop(1).collect { list.scrollToItem(0) }
    }

    Box(Modifier.fillMaxSize().background(DS.colors.ground).statusBarsPadding()) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Library", Modifier.padding(horizontal = DS.Space.space4).padding(top = DS.Space.space2)) {
                LitCircleButton(Icons.plus, if (signedIn) "Add a song" else "Sign in to add a song", {
                    focus.clearFocus()
                    if (signedIn) onAdd() else selectTab(AppTab.Settings)
                })
            }
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = refresh,
                modifier = Modifier.fillMaxSize(),
                state = pull,
                indicator = {
                    PullToRefreshDefaults.Indicator(
                        state = pull, isRefreshing = refreshing, modifier = Modifier.align(Alignment.TopCenter),
                        containerColor = DS.colors.surface, color = DS.colors.accentInk,
                    )
                },
            ) {
                val dock = LocalDockHeight.current
                val bars = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
                val pinned by remember { derivedStateOf { list.firstVisibleItemIndex > 0 } }
                val side = Modifier.padding(horizontal = DS.Space.space4)
                LazyColumn(
                    Modifier.fillMaxSize(),
                    state = list,
                    // The dock, when shown, already stands on the navigation bar; without it the list clears the bar itself.
                    contentPadding = PaddingValues(bottom = DS.Space.space4 + maxOf(dock, bars)),
                ) {
                    if (!hideTools) {
                        item(key = "library.tools") {
                            Column {
                                LibrarySearchField(query.search, { query = query.copy(search = it) }, side)
                                ChipRow(
                                    query = query,
                                    signedIn = signedIn,
                                    open = { focus.clearFocus(); facet = it },
                                    change = { query = it },
                                )
                            }
                        }
                        stickyHeader(key = "library.controls") {
                            Column(Modifier.background(DS.colors.ground)) {
                                LibraryControls(
                                    query = query,
                                    matches = matches.size,
                                    total = songs.size,
                                    length = matches.sumOf { it.duration ?: 0.0 }.takeIf { it > 0 }?.let(::formatTotalLength),
                                    showsCount = ready,
                                    onSort = { focus.clearFocus(); showSort = true },
                                    onReverse = { query = query.copy(reversed = !query.reversed) },
                                    onActions = { focus.clearFocus(); showActions = true },
                                    modifier = side,
                                )
                                Hairline(Modifier.alpha(if (pinned) 1f else 0f))
                            }
                        }
                    }
                    if (banner) {
                        item(key = "library.banner") {
                            val pad = side.padding(top = DS.Space.space2, bottom = DS.Space.space3)
                            if (expired) {
                                LibraryBanner(Icons.warning, "Sign-in expired. Your downloaded songs still play.", "Sign in", { selectTab(AppTab.Settings) }, pad)
                            } else {
                                LibraryBanner(
                                    Icons.wifiOff, if (status.syncing) "Checking…" else "Offline. Your downloaded songs still play.", "Retry", refresh, pad,
                                    enabled = !status.syncing,
                                )
                            }
                        }
                    }
                    when {
                        loading -> item(key = "library.loading") { LibrarySkeleton(side.padding(top = DS.Space.space2)) }
                        failed -> item(key = "library.failed") {
                            val slow = waiting
                            LibraryEmpty(
                                title = if (expired) "Sign-in expired" else if (slow) "Taking too long" else "Can't reach the server",
                                icon = if (expired) Icons.warning else Icons.wifiOff,
                                detail = when {
                                    expired -> "Sign in again to load your library. Your downloaded songs still play offline."
                                    slow -> "The server is slow to answer. Your downloaded songs still play offline."
                                    else -> "Check the connection and try again."
                                },
                            ) {
                                if (expired) {
                                    LibraryPrimaryButton("Sign in", { selectTab(AppTab.Settings) })
                                } else {
                                    LibraryPrimaryButton("Retry", { timedOut = false; refresh() })
                                }
                            }
                        }
                        songs.isEmpty() -> item(key = "library.empty") {
                            LibraryEmpty(
                                title = "No songs yet",
                                icon = Icons.music,
                                detail = if (signedIn) "Add a song to start your library." else "Your library is stored on this phone. Sign in to add songs and sync.",
                            ) {
                                if (signedIn) LibraryPrimaryButton("Add song", onAdd) else LibraryPrimaryButton("Sign in", { selectTab(AppTab.Settings) })
                            }
                        }
                        matches.isEmpty() -> item(key = "library.nomatch") {
                            LibraryEmpty("No songs found", Icons.search, "Try a different search or clear the filters.") {
                                if (query.narrowing) DSButton("Clear filters", clearFilters)
                            }
                        }
                        else -> itemsIndexed(matches, key = { _, song -> song.id }) { index, song ->
                            val onPhone = song.id in phoneIds
                            val isCurrent = current?.id == song.id
                            val transfer = transfers[song.id]
                            val audio = if (onPhone) AudioState.Phone else library.audioState(song)
                            val menu = songMenu(
                                song = song, audio = audio, transfer = transfer, current = isCurrent, signedIn = signedIn, actions = actions,
                                details = { detailsId = song.id }, edit = { onEdit(song) }, remove = { removingId = song.id },
                            )
                            val last = index == matches.lastIndex
                            Column((if (index == 0) side.padding(top = DS.Space.space2) else side).slabPiece(first = index == 0, last = last)) {
                                LibrarySongRow(
                                    song = song,
                                    audio = audio,
                                    transfer = transfer,
                                    playing = isCurrent,
                                    isPlaying = playing.isPlaying,
                                    offline = offline,
                                    tapLabel = if (onPhone) (if (isCurrent && playing.isPlaying) "Pause" else "Play") else "Show details",
                                    onTap = { tap(song) },
                                    onMenu = {
                                        focus.clearFocus()
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        menuId = song.id
                                    },
                                    onDownload = { focus.clearFocus(); actions.download(song) },
                                    actions = menu.map { item -> CustomAccessibilityAction(item.title) { item.run(); true } },
                                )
                                if (!last && !isCurrent && current?.id != matches[index + 1].id) Hairline(Modifier.padding(horizontal = DS.Space.space3))
                            }
                        }
                    }
                }
            }
        }
        ToastHost(toast, Modifier.align(Alignment.TopCenter).padding(top = DS.Space.space2))
    }

    facet?.let { open ->
        LibraryFilterSheet(open, songs, query, matches.size, onQuery = { query = it }, onDismiss = { facet = null })
    }
    if (showSort) {
        LibrarySortSheet(
            query = query,
            listeningAvailable = false,
            listeningNote = if (signedIn) "Not available on Android yet" else "Sign in to use this",
            onChoose = { query = query.choose(it) },
            onDismiss = { showSort = false },
        )
    }
    if (showActions) {
        val phone = matches.filter { it.id in phoneIds }
        LibraryActionsSheet(
            canPlay = matches.isNotEmpty() && !loading && !failed,
            canShowPlaying = current != null && songs.any { it.id == current.id },
            narrowing = query.narrowing,
            onPlayAll = {
                if (phone.isEmpty()) {
                    toast.show("No listed songs are on this phone")
                } else {
                    player.playAll(phone)
                    val skipped = matches.size - phone.size
                    toast.show("Playing ${phone.size} ${if (phone.size == 1) "song" else "songs"}" + if (skipped > 0) ", $skipped not on this phone skipped" else "")
                }
            },
            onShowPlaying = {
                val id = current?.id
                if (id != null) {
                    // A song the filters hide is shown by clearing them (iOS asks "Show" first); the sort stays.
                    val shown = if (matches.any { it.id == id }) query else query.clear()
                    if (shown != query) {
                        query = shown
                        toast.show("Filters cleared to show the song")
                    }
                    val index = shown.results(songs, phoneIds, listening).indexOfFirst { it.id == id }
                    if (index >= 0) scope.launch { list.animateScrollToItem(leading + index) }
                }
            },
            onClear = clearFilters,
            onDismiss = { showActions = false },
        )
    }
    songs.firstOrNull { it.id == menuId }?.let { song ->
        val audio = if (song.id in phoneIds) AudioState.Phone else library.audioState(song)
        val items = songMenu(
            song = song, audio = audio, transfer = transfers[song.id], current = current?.id == song.id, signedIn = signedIn, actions = actions,
            details = { detailsId = song.id }, edit = { onEdit(song) }, remove = { removingId = song.id },
        )
        SongMenuSheet(song, items, onDismiss = { menuId = null })
    }
    songs.firstOrNull { it.id == detailsId }?.let { song ->
        SongDetailsSheet(song, onDismiss = { detailsId = null }, onEdit = onEdit, onPlay = play)
    }
    songs.firstOrNull { it.id == removingId }?.let { song ->
        DSConfirmDialog(
            title = "Remove \"${song.title}\" from this phone?",
            message = "The song stays in your library. Tap Download to get it back.",
            confirm = "Remove from phone",
            onConfirm = { actions.removeAudio(song) },
            onDismiss = { removingId = null },
        )
    }
}

/**
 * What can be done to a song from its row, in menu order (the iOS context menu and VoiceOver actions, IOS-033):
 * queue actions only for a song on the phone that is not current, server actions only signed in, and a local-only
 * song never loses its only audio. "Song details" leads the list because a tap on a phone song plays it.
 */
private fun songMenu(
    song: Song,
    audio: AudioState,
    transfer: Transfer?,
    current: Boolean,
    signedIn: Boolean,
    actions: SongActions,
    details: () -> Unit,
    edit: () -> Unit,
    remove: () -> Unit,
): List<SongMenuItem> = buildList {
    val onPhone = audio == AudioState.Phone
    add(SongMenuItem("Song details", Icons.info, run = details))
    if (onPhone && !current) {
        add(SongMenuItem("Play next", Icons.playPlus) { actions.playNext(song) })
        add(SongMenuItem("Add to queue", Icons.listAdd) { actions.enqueue(song) })
    }
    if (signedIn && !onPhone && (transfer == null || transfer is Transfer.Failed)) {
        add(SongMenuItem(if (audio == AudioState.None) "Get audio" else "Download", Icons.download) { actions.download(song) })
    }
    if (signedIn) add(SongMenuItem("Edit", Icons.pencil, run = edit))
    if (signedIn && onPhone && !current && song.localOnly != true) {
        add(SongMenuItem("Remove from phone", Icons.phoneOff, destructive = true, run = remove))
    }
}

/**
 * The one chip row (iOS `chipRow`): Tags, Genres, Decades, Countries, then Never listened and Downloaded when signed
 * in. It scrolls sideways and never wraps; while more chips wait beyond the edge the row fades out there.
 */
@Composable
private fun ChipRow(query: LibraryQuery, signedIn: Boolean, open: (LibraryFacet) -> Unit, change: (LibraryQuery) -> Unit) {
    val scroll = rememberScrollState()
    val fade = DS.Component.chipFade
    Row(
        Modifier.fillMaxWidth()
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                if (scroll.canScrollForward) {
                    drawRect(
                        Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), startX = size.width - fade.toPx(), endX = size.width),
                        blendMode = BlendMode.DstIn,
                    )
                }
            }
            .horizontalScroll(scroll).padding(horizontal = DS.Space.space4, vertical = DS.Space.space2),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (category in LibraryFacet.entries) {
            val picked = query.selected(category).size
            LibraryFilterChip(category.title, category.icon, selected = picked > 0, onClick = { open(category) }, count = picked)
        }
        if (signedIn) {
            LibraryFilterChip(
                "Never listened", Icons.volumeMute, selected = query.neverListened,
                onClick = { change(query.copy(neverListened = !query.neverListened)) }, hint = "Shows only songs you have not played",
            )
            LibraryFilterChip(
                "Downloaded", Icons.phone, selected = query.downloadedOnly,
                onClick = { change(query.copy(downloadedOnly = !query.downloadedOnly)) }, hint = "Shows only songs on this phone",
            )
        }
    }
}
