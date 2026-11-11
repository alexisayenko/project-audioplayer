package com.alexisayenko.audioplayer.android.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.R
import com.alexisayenko.audioplayer.android.ui.CoverImage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSIconButton
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsFloat
import com.alexisayenko.audioplayer.android.ui.dsRounded
import com.alexisayenko.audioplayer.android.ui.dsShadow
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.strongFill
import kotlinx.coroutines.launch

/** The destinations of the drawer (iOS `AppTab`). v1 has three; the others appear when their screens are built (AND-016). */
enum class AppTab(val title: String, val icon: ImageVector) {
    Library("Library", Icons.library),
    Playback("Now playing", Icons.nowPlaying),
    Settings("Settings", Icons.settings),
}

/** Opens the drawer from a root screen's header; null when no drawer is installed (previews of a single screen). */
val LocalOpenMenu = staticCompositionLocalOf<(() -> Unit)?> { null }

/** Switches the root destination, e.g. "Sign in" in the Library opens Settings. */
val LocalSelectTab = staticCompositionLocalOf<(AppTab) -> Unit> { {} }

/** Height of the floating mini player while it is shown, else 0: lists add it as bottom content padding (iOS `dockHeight`). */
val LocalDockHeight = staticCompositionLocalOf { 0.dp }

/** The hamburger at the leading edge of a root screen header (iOS `MenuButton`). */
@Composable
fun MenuButton(modifier: Modifier = Modifier) {
    val open = LocalOpenMenu.current ?: return
    DSIconButton(Icons.menu, "Open menu", open, modifier)
}

/** The header of a root screen: menu button, the display title, trailing actions (iOS `ScreenHeader`). */
@Composable
fun ScreenHeader(title: String, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DS.Space.space1), verticalAlignment = Alignment.CenterVertically) {
        MenuButton()
        DSText(title, Modifier.weight(1f).semantics { heading() }, DS.Type.display, maxLines = 2)
        Spacer(Modifier.width(DS.Space.space2))
        trailing()
    }
}

/**
 * The app shell (iOS `RootView`, AND-016 to AND-018): a left drawer, the root destinations kept alive while the app runs,
 * and the mini player floating above every destination except Playback. Back closes the drawer first, then returns to
 * the Library, then leaves the app.
 */
@Composable
fun AppShell(
    library: @Composable () -> Unit,
    playback: @Composable () -> Unit,
    settings: @Composable () -> Unit,
    initialTab: AppTab = AppTab.Library,
    initialDrawerOpen: Boolean = false,
) {
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    val drawer = rememberDrawerState(if (initialDrawerOpen) DrawerValue.Open else DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val holder = rememberSaveableStateHolder()
    val player = LocalAppGraph.current.player
    val state by player.state.collectAsState()
    val density = LocalDensity.current
    val keyboardUp = WindowInsets.ime.getBottom(density) > 0
    val showsDock = tab != AppTab.Playback && state.current != null && !keyboardUp
    var dockHeight by remember { mutableStateOf(0.dp) }

    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(enabled = !drawer.isOpen && tab != AppTab.Library) { tab = AppTab.Library }

    ModalNavigationDrawer(
        drawerState = drawer,
        scrimColor = DS.colors.vinyl.copy(alpha = 0.45f),
        drawerContent = {
            // A closed drawer sits just off screen; its shadow would still fall on the edge of the page.
            val lifted = drawer.currentValue == DrawerValue.Open || drawer.targetValue == DrawerValue.Open
            DrawerPanel(selection = tab, lifted = lifted) { picked ->
                tab = picked
                scope.launch { drawer.close() }
            }
        },
    ) {
        CompositionLocalProvider(
            LocalOpenMenu provides { scope.launch { drawer.open() } },
            LocalSelectTab provides { tab = it },
            LocalDockHeight provides if (showsDock) dockHeight else 0.dp,
        ) {
            Box(Modifier.fillMaxSize().background(DS.colors.ground)) {
                holder.SaveableStateProvider(tab) {
                    when (tab) {
                        AppTab.Library -> library()
                        AppTab.Playback -> playback()
                        AppTab.Settings -> settings()
                    }
                }
                if (showsDock) {
                    val pad = DS.Space.space2
                    Box(
                        Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(DS.colors.ground)
                            .windowInsetsPadding(WindowInsets.navigationBars)
                            .padding(horizontal = DS.Space.space4, vertical = pad)
                            .onHeight { dockHeight = it + pad * 2 },
                    ) { MiniPlayer(open = { tab = AppTab.Playback }) }
                }
            }
        }
    }
}

@Composable
private fun Modifier.onHeight(report: (Dp) -> Unit): Modifier {
    val density = LocalDensity.current
    return onSizeChanged { report(with(density) { it.height.toDp() }) }
}

/** The drawer panel: brand lockup, the destinations, the account row pinned to the bottom (iOS `SideDrawer`). */
@Composable
private fun DrawerPanel(selection: AppTab, lifted: Boolean, select: (AppTab) -> Unit) {
    val session by LocalAppGraph.current.account.session.collectAsState()
    val shape = RoundedCornerShape(topEnd = DS.Radius.radiusTray, bottomEnd = DS.Radius.radiusTray)
    Column(
        Modifier.fillMaxHeight().widthIn(max = 320.dp).fillMaxWidth(0.75f)
            .then(if (lifted) Modifier.dsShadow(DS.Shadow.depthDrawer, shape) else Modifier).background(DS.colors.surface, shape)
            .windowInsetsPadding(WindowInsets.statusBars).windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = DS.Space.space3, vertical = DS.Space.space4)) {
            Row(
                Modifier.padding(horizontal = DS.Space.space6).padding(bottom = DS.Space.space6),
                horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(painterResource(R.drawable.drawer_logo), contentDescription = null, modifier = Modifier.size(42.dp).clip(CircleShape))
                Image(
                    painterResource(R.drawable.lockup),
                    contentDescription = "Electrophone Vega 108",
                    modifier = Modifier.weight(1f).height(DS.Component.navRowHeight).semantics { heading() },
                    alignment = Alignment.CenterEnd,
                )
            }
            AppTab.entries.forEach { tab ->
                DrawerRow(tab.icon, tab.title, active = tab == selection) { select(tab) }
            }
        }
        Column(Modifier.padding(horizontal = DS.Space.space3, vertical = DS.Space.space2), verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
            Hairline(Modifier.padding(horizontal = DS.Space.space6))
            val email = session?.let { it.email ?: "Signed in" }
            DrawerRow(Icons.account, email ?: "Sign in", active = false, description = email?.let { "Account, $it" } ?: "Sign in") { select(AppTab.Settings) }
        }
    }
}

@Composable
private fun DrawerRow(icon: ImageVector, label: String, active: Boolean, description: String = label, onClick: () -> Unit) {
    val colors = DS.colors
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.navRowHeight)
            .dsClickable(pressedAlpha = 0.6f, onClick = onClick).semantics { contentDescription = description; selected = active }
            .padding(vertical = DS.Space.space1)
            .background(if (active) colors.selectTint else androidx.compose.ui.graphics.Color.Transparent, dsRounded(DS.Radius.radiusSelect))
            .padding(horizontal = DS.Space.space3),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(DS.Component.navIconFrame), contentAlignment = Alignment.Center) {
            DSIcon(icon, size = DS.Icon.iconNavLg, tint = if (active) colors.selectInk else colors.inkMuted)
        }
        DSText(label, style = DS.Type.body, color = if (active) colors.selectInk else colors.ink, maxLines = 1, weight = if (active) FontWeight.W600 else FontWeight.W500)
    }
}

/** The collapsed player above every destination except Playback: cover, title, artist, play/pause, next, a thin progress line (iOS `MiniPlayer`, AND-017). */
@Composable
fun MiniPlayer(open: () -> Unit, modifier: Modifier = Modifier) {
    val player = LocalAppGraph.current.player
    val state by player.state.collectAsState()
    val song = state.current
    val shape = dsRounded(DS.Radius.radiusCard)
    Column(modifier.fillMaxWidth().dsFloat(DS.Radius.radiusCard).clip(shape)) {
        Row(
            Modifier.fillMaxWidth().dsClickable(pressedAlpha = 1f, label = "Open Now playing", onClick = open)
                .padding(horizontal = DS.Space.space3, vertical = DS.Space.space2),
            horizontalArrangement = Arrangement.spacedBy(DS.Space.space3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CoverImage(song?.thumbnail, Modifier.size(DS.Space.hit).clip(dsRounded(DS.Radius.radiusSm)))
            Column(Modifier.weight(1f)) {
                DSText(song?.title ?: "", style = DS.Type.headline, maxLines = 1)
                DSText(song?.artist ?: "", style = DS.Type.caption, color = DS.colors.inkMuted, maxLines = 1)
            }
            DSIconButton(if (state.isPlaying) Icons.pause else Icons.play, if (state.isPlaying) "Pause" else "Play", { player.toggle() })
            DSIconButton(Icons.next, "Next song", { player.next() })
        }
        val fraction = if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f
        Box(Modifier.fillMaxWidth().height(DS.Stroke.strokeProgress).background(DS.colors.surfaceSunken)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).background(DS.colors.strongFill))
        }
    }
}
