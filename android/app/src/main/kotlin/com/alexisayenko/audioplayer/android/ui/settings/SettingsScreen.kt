package com.alexisayenko.audioplayer.android.ui.settings

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.BuildConfig
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.auth.Session
import com.alexisayenko.audioplayer.android.data.AudioState
import com.alexisayenko.audioplayer.android.data.SyncStatus
import com.alexisayenko.audioplayer.android.data.Usage
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.DSButton
import com.alexisayenko.audioplayer.android.ui.DSButtonKind
import com.alexisayenko.audioplayer.android.ui.DSConfirmDialog
import com.alexisayenko.audioplayer.android.ui.DSSwitch
import com.alexisayenko.audioplayer.android.ui.DSText
import com.alexisayenko.audioplayer.android.ui.Hairline
import com.alexisayenko.audioplayer.android.ui.LED
import com.alexisayenko.audioplayer.android.ui.SectionLabel
import com.alexisayenko.audioplayer.android.ui.colors
import com.alexisayenko.audioplayer.android.ui.dsClickable
import com.alexisayenko.audioplayer.android.ui.dsSlab
import com.alexisayenko.audioplayer.android.ui.icons.DSIcon
import com.alexisayenko.audioplayer.android.ui.icons.Icons
import com.alexisayenko.audioplayer.android.ui.shell.LocalDockHeight
import com.alexisayenko.audioplayer.android.ui.shell.ScreenHeader
import kotlinx.coroutines.launch

/**
 * Settings (iOS `SettingsView`, AND-040): Account, Downloads, Storage and the version line. "Open in Files" has no
 * Android counterpart because the audio folder is private to the app (AND-041).
 */
@Composable
fun SettingsScreen() {
    val graph = LocalAppGraph.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session by graph.account.session.collectAsState()
    val busy by graph.account.busy.collectAsState()
    val error by graph.account.error.collectAsState()
    val status by graph.library.status.collectAsState()
    val songs by graph.library.songs.collectAsState()
    val phoneIds by graph.library.phoneIds.collectAsState()
    val mobileData by graph.settings.useMobileData.collectAsState()
    val autoDownload by graph.settings.downloadNewAutomatically.collectAsState()
    var bytes by remember { mutableStateOf(0L) }
    var freeBytes by remember { mutableStateOf(0L) }
    var usage by remember { mutableStateOf<Usage?>(null) }
    var confirmRemoveAll by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var queued by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(phoneIds.size) {
        bytes = graph.library.phoneBytes()
        freeBytes = context.filesDir.usableSpace
    }
    LaunchedEffect(session?.email, songs.size) { usage = if (session != null) graph.library.usage() else null }

    val size: (Long) -> String = { Formatter.formatShortFileSize(context, it) }
    val missing = songs.count { graph.library.audioState(it) == AudioState.Server && it.localOnly != true }

    Column(Modifier.fillMaxSize().background(DS.colors.ground).statusBarsPadding()) {
        ScreenHeader("Settings", Modifier.padding(horizontal = DS.Space.space4).padding(top = DS.Space.space2))
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = DS.Space.space4).padding(top = DS.Space.space2, bottom = DS.Space.space4 + LocalDockHeight.current),
            verticalArrangement = Arrangement.spacedBy(DS.Space.space3),
        ) {
            Card("Account") {
                Column(Modifier.padding(vertical = DS.Space.space3), verticalArrangement = Arrangement.spacedBy(DS.Space.space3)) {
                    val current = session
                    if (current != null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space3), verticalAlignment = Alignment.CenterVertically) {
                            LED(accountLed(current, status), size = DS.Component.dotMd, glow = status.reachable != null)
                            Column {
                                DSText(current.email ?: "Signed in", style = DS.Type.body)
                                DSText(accountStatus(current, status), style = DS.Type.caption, color = DS.colors.inkMuted)
                            }
                        }
                        DSButton("Sign out", { confirmSignOut = true }, kind = DSButtonKind.Danger)
                    }
                    if (current == null || current.expired()) {
                        GoogleSignInButton(enabled = !busy) {
                            val activity = context.findActivity() ?: return@GoogleSignInButton
                            graph.account.signInWithGoogle(activity)
                        }
                    }
                    error?.let { message ->
                        Row(horizontalArrangement = Arrangement.spacedBy(DS.Space.space2), verticalAlignment = Alignment.CenterVertically) {
                            DSIcon(Icons.warning, size = DS.Icon.iconAction, tint = DS.colors.power)
                            DSText(message, style = DS.Type.caption)
                        }
                    }
                }
            }

            if (session != null) {
                Card("Library") {
                    SettingRow("Songs") { Muted("${songs.size}") }
                    Hairline()
                    SettingRow("Server storage") { Muted(usage?.let { storageLine(it, size) } ?: "—") }
                    Hairline()
                    SettingRow("Server") { Muted(graph.settings.serverUrl.removePrefix("https://")) }
                }
            }

            Card("Downloads") {
                SettingRow("Audio format") { Muted("AAC · best available") }
                Hairline()
                SettingRow("Download new songs automatically") {
                    DSSwitch(autoDownload, graph.settings::setDownloadNewAutomatically, "Download new songs automatically")
                }
                Hairline()
                SettingRow("Download over mobile data") { DSSwitch(mobileData, graph.settings::setUseMobileData, "Download over mobile data") }
            }

            Card("Storage") {
                val lowSpace = freeBytes in 1 until 1_000_000_000L
                Column(Modifier.padding(vertical = DS.Space.space4), verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        DSText(size(bytes), style = DS.Type.title)
                        DSText(" · Downloaded audio", Modifier.padding(bottom = 3.dp), DS.Type.subhead, DS.colors.inkMuted)
                    }
                    Muted("${phoneIds.size} ${if (phoneIds.size == 1) "song" else "songs"} on this phone", DS.Type.caption)
                    if (freeBytes > 0) {
                        val fraction = (bytes.toFloat() / (bytes + freeBytes).coerceAtLeast(1)).coerceIn(0.02f, 1f)
                        Box(Modifier.fillMaxWidth().height(DS.Control.trackSeek).background(DS.colors.surfaceSunken, CircleShape)) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).background(if (lowSpace) DS.colors.power else DS.colors.accent, CircleShape))
                        }
                        DSText("${size(freeBytes)} free on this phone", style = DS.Type.caption, color = if (lowSpace) DS.colors.powerText else DS.colors.inkMuted)
                    }
                    Muted("AAC audio · quality depends on the source", DS.Type.caption)
                }
                if (session != null) {
                    Hairline()
                    LinkRow("Download all to this phone", enabled = missing > 0 && status.reachable != false) { queued = graph.library.downloadAllMissing() }
                    val note = queued?.let { "$it ${if (it == 1) "song" else "songs"} queued for download." }
                        ?: if (missing == 0) "Everything on the server is already on this phone." else null
                    if (note != null) Muted(note, DS.Type.caption, Modifier.padding(bottom = DS.Space.space3))
                }
                Hairline()
                val empty = phoneIds.isEmpty()
                Box(Modifier.fillMaxWidth().dsClickable(enabled = !empty) { confirmRemoveAll = true }) {
                    SettingRow("Remove all downloads", color = if (empty) DS.colors.inkFaint else DS.colors.powerText) {}
                }
            }

            val debug = if (BuildConfig.DEBUG) " · Debug" else ""
            DSText(
                "Electrophone ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})$debug",
                Modifier.fillMaxWidth().padding(top = DS.Space.space4), DS.Type.micro, DS.colors.inkMuted, align = TextAlign.Center,
            )
            DSText(
                "A personal app, not for distribution. Downloading may be against the terms of the source site.",
                Modifier.fillMaxWidth(), DS.Type.micro, DS.colors.inkMuted, align = TextAlign.Center,
            )
        }
    }

    if (confirmRemoveAll) {
        DSConfirmDialog(
            title = "Remove all ${phoneIds.size} downloads from this phone?",
            message = "The songs stay in your library. Tap Download to get one back.",
            confirm = "Remove all",
            onConfirm = { scope.launch { graph.library.removeAllAudio() } },
            onDismiss = { confirmRemoveAll = false },
        )
    }
    if (confirmSignOut) {
        DSConfirmDialog(
            title = "Sign out?",
            message = "Songs downloaded to this phone stay and keep playing. Sign in again to sync your library.",
            confirm = "Sign out",
            onConfirm = { graph.account.signOut() },
            onDismiss = { confirmSignOut = false },
        )
    }
}

private fun storageLine(usage: Usage, size: (Long) -> String): String =
    if (usage.maxBytes != null) "${size(usage.bytes)} of ${size(usage.maxBytes)}" else size(usage.bytes)

@Composable
private fun accountLed(session: Session, status: SyncStatus): Color = when {
    session.expired() || status.unauthorized -> DS.colors.power
    status.reachable == true -> DS.colors.ok
    status.reachable == false -> DS.colors.power
    else -> DS.colors.inkFaint
}

private fun accountStatus(session: Session, status: SyncStatus): String = when {
    session.expired() || status.unauthorized -> "Expired, sign in again"
    status.reachable == true -> "via Google · Server online"
    status.reachable == false -> "via Google · Server unavailable"
    else -> "via Google"
}

/** A grouped card: section label above, a surface slab with the rows inside. */
@Composable
private fun Card(label: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(DS.Space.space2)) {
        SectionLabel(label)
        Column(Modifier.fillMaxWidth().dsSlab().padding(horizontal = DS.Space.space4), content = content)
    }
}

/** A 48dp settings row: label on the left, value or control on the right. */
@Composable
private fun SettingRow(label: String, color: Color = DS.colors.ink, trailing: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Component.rowHeight), verticalAlignment = Alignment.CenterVertically) {
        DSText(label, Modifier.weight(1f), DS.Type.subhead, color)
        Spacer(Modifier.width(DS.Space.space3))
        trailing()
    }
}

@Composable
private fun LinkRow(title: String, enabled: Boolean, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().dsClickable(enabled = enabled, onClick = onClick)) {
        SettingRow(title) { DSIcon(Icons.chevronRight, size = DS.Icon.iconInline, tint = DS.colors.inkFaint) }
    }
}

@Composable
private fun Muted(text: String, style: androidx.compose.ui.text.TextStyle = DS.Type.subhead, modifier: Modifier = Modifier) {
    DSText(text, modifier, style, DS.colors.inkMuted)
}

/** Google sign-in as an outlined pill: line border, ink label (iOS `GoogleSignInButton`). */
@Composable
private fun GoogleSignInButton(enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = DS.Space.hit)
            .dsClickable(enabled = enabled, onClick = onClick).semantics { contentDescription = "Sign in with Google" }
            .border(DS.Stroke.strokeThin, DS.colors.line, CircleShape),
        horizontalArrangement = Arrangement.spacedBy(DS.Space.space2, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DSText("G", style = DS.Type.body, color = DS.colors.accentInk, weight = FontWeight.W700)
        DSText("Sign in with Google", style = DS.Type.subheadStrong)
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
