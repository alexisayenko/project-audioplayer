package com.alexisayenko.audioplayer.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.core.content.ContextCompat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.alexisayenko.audioplayer.android.AppGraph
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.playback.MediaPlayerController
import com.alexisayenko.audioplayer.android.playback.PlaybackEvent
import com.alexisayenko.audioplayer.android.ui.library.LibraryScreen
import com.alexisayenko.audioplayer.android.ui.playback.PlaybackScreen
import com.alexisayenko.audioplayer.android.ui.settings.SettingsScreen
import com.alexisayenko.audioplayer.android.ui.shell.AppShell
import com.alexisayenko.audioplayer.android.ui.songform.AddSongSheet
import com.alexisayenko.audioplayer.android.ui.songform.EditSongSheet
import kotlinx.coroutines.launch

/**
 * The whole app UI (iOS `RootView`): the shell with Library, Now playing and Settings, the Add and Edit sheets above it,
 * the catalog sync on every return to the foreground (AND-058) and the toast for songs the player had to skip (AND-066).
 * [sharedLink] is a link that arrived through the Android share sheet; it opens Add with the link filled (AND-038).
 */
@Composable
fun ElectrophoneApp(graph: AppGraph, sharedLink: String? = null, onSharedLinkTaken: () -> Unit = {}) {
    ElectrophoneTheme {
        CompositionLocalProvider(LocalAppGraph provides graph) {
            var addOpen by rememberSaveable { mutableStateOf(false) }
            var addLink by rememberSaveable { mutableStateOf<String?>(null) }
            var editing by remember { mutableStateOf<Song?>(null) }
            val context = LocalContext.current
            val scope = rememberCoroutineScope()

            LaunchedEffect(sharedLink) {
                if (sharedLink != null) {
                    addLink = sharedLink
                    addOpen = true
                    onSharedLinkTaken()
                }
            }

            LifecycleResumeEffect(graph) {
                val job = scope.launch { graph.library.syncCatalog() }
                onPauseOrDispose { job.cancel() }
            }

            LaunchedEffect(graph) {
                (graph.player as? MediaPlayerController)?.events?.collect { event ->
                    val text = when (event) {
                        is PlaybackEvent.SkippedMissing ->
                            if (event.songs.size == 1) "“${event.songs[0].title}” is not on this phone." else "${event.songs.size} songs are not on this phone."
                        is PlaybackEvent.Failed -> "“${event.song.title}” could not be played."
                    }
                    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
                }
            }

            // The download notification needs the permission on Android 13+; asked once, when the first download starts.
            // Downloads run either way (AND-054).
            val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
            var asked by rememberSaveable { mutableStateOf(false) }
            val transfers by graph.library.transfers.collectAsState()
            LaunchedEffect(transfers.isNotEmpty()) {
                if (transfers.isNotEmpty() && !asked && Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    asked = true
                    askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }

            AppShell(
                library = { LibraryScreen(onAdd = { addLink = null; addOpen = true }, onEdit = { editing = it }) },
                playback = { PlaybackScreen() },
                settings = { SettingsScreen() },
            )

            if (addOpen) AddSongSheet(initialLink = addLink, onDismiss = { addOpen = false; addLink = null })
            editing?.let { song -> EditSongSheet(song, onDismiss = { editing = null }) }
        }
    }
}
