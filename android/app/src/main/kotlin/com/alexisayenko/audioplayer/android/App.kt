package com.alexisayenko.audioplayer.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.WorkManager
import coil3.ImageLoader
import coil3.SingletonImageLoader
import com.alexisayenko.audioplayer.android.auth.Account
import com.alexisayenko.audioplayer.android.auth.CredentialManagerGoogle
import com.alexisayenko.audioplayer.android.auth.GoogleAccount
import com.alexisayenko.audioplayer.android.auth.TokenStore
import com.alexisayenko.audioplayer.android.data.AppSettings
import com.alexisayenko.audioplayer.android.data.Library
import com.alexisayenko.audioplayer.android.data.LibraryRepository
import com.alexisayenko.audioplayer.android.data.api.ApiClient
import com.alexisayenko.audioplayer.android.data.api.ApiError
import com.alexisayenko.audioplayer.android.data.api.CoverUrl
import com.alexisayenko.audioplayer.android.data.api.coverImageLoader
import com.alexisayenko.audioplayer.android.data.api.prefetchCovers
import com.alexisayenko.audioplayer.android.data.store.AudioFiles
import com.alexisayenko.audioplayer.android.data.store.DataStoreSettings
import com.alexisayenko.audioplayer.android.data.store.DownloadPrefs
import com.alexisayenko.audioplayer.android.data.store.LibraryIndex
import com.alexisayenko.audioplayer.android.data.store.settingsStore
import com.alexisayenko.audioplayer.android.download.DefaultDownloadEnvironment
import com.alexisayenko.audioplayer.android.download.DownloadEnvironmentHolder
import com.alexisayenko.audioplayer.android.download.DownloadGate
import com.alexisayenko.audioplayer.android.download.SongDownloader
import com.alexisayenko.audioplayer.android.download.WorkDownloadQueue
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.playback.MediaPlayerController
import com.alexisayenko.audioplayer.android.playback.PlayLog
import com.alexisayenko.audioplayer.android.playback.PlaySink
import com.alexisayenko.audioplayer.android.playback.PlaybackEnvironment
import com.alexisayenko.audioplayer.android.playback.PlaybackHub
import com.alexisayenko.audioplayer.android.playback.PlaybackService
import com.alexisayenko.audioplayer.android.playback.PlayerController
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

/**
 * Builds the app's services by hand, once per process (AND-092), and gives the playback service and the download worker
 * what they need before either can start. Screens read [graph] through `LocalAppGraph`.
 */
open class App : Application() {
    lateinit var graph: AppGraph
        private set

    /** The Google sign-in source; `MainActivity` attaches itself so silent renewal has a visible Activity. */
    lateinit var google: CredentialManagerGoogle
        private set

    override fun onCreate() {
        super.onCreate()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val settings = DataStoreSettings(settingsStore, scope)
        google = CredentialManagerGoogle(this, BuildConfig.GOOGLE_WEB_CLIENT_ID)
        val account = GoogleAccount(google, TokenStore(File(noBackupFilesDir, "credential.bin")), scope)
        val http = OkHttpClient()
        val api = ApiClient(settings.serverUrl, http, account::validToken)
        val queue = WorkDownloadQueue(WorkManager.getInstance(this), settings, scope)
        val library = LibraryRepository(
            LibraryIndex(File(filesDir, "library.json"), File(filesDir, "phone-index.json")),
            AudioFiles(File(filesDir, "audio")),
            api, account, settings, queue, scope,
        )
        val downloader = SongDownloader(api, library, DownloadGate(), DownloadPrefs(settingsStore))
        DownloadEnvironmentHolder.environment = DefaultDownloadEnvironment(downloader, queue, library)

        val loader = coverImageLoader(this, http, settings.serverUrl, account::validToken)
        SingletonImageLoader.setSafe { loader }

        PlaybackService.environment = Playback(library, loader, settings.serverUrl, api)
        val player = MediaPlayerController(applicationContext)
        graph = Graph(library, player, account, settings)

        // Covers of downloaded songs are fetched ahead so they show offline (AND-022).
        scope.launch {
            library.phoneIds.collect { ids ->
                val covers = library.songs.value.filter { it.id in ids }.map { it.thumbnail }
                prefetchCovers(this@App, loader, covers, settings.serverUrl)
            }
        }
        // Signing in sends the plays recorded while signed out (AND-065) and reads the catalog; signing out forgets cached covers.
        scope.launch {
            account.session.map { it?.email }.distinctUntilChanged().drop(1).collect { email ->
                if (email != null) {
                    PlaybackHub.flushPlays(this@App)
                    library.syncCatalog()
                } else {
                    loader.memoryCache?.clear()
                    loader.diskCache?.clear()
                }
            }
        }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                library.refreshPhone()
                PlaybackHub.flushPlays(this@App, force = false)
            }
        })
    }

    private class Graph(
        override val library: Library,
        override val player: PlayerController,
        override val account: Account,
        override val settings: AppSettings,
    ) : AppGraph

    /** What the playback service needs: files and songs from the library, cached covers, and where plays are posted. */
    private class Playback(
        private val library: LibraryRepository,
        private val loader: ImageLoader,
        private val serverUrl: String,
        private val api: ApiClient,
    ) : PlaybackEnvironment {
        override fun fileFor(songId: String): File? = library.fileFor(songId)

        override fun coverFor(song: Song): File? {
            val url = CoverUrl.resolve(song.thumbnail, serverUrl) ?: return null
            return try {
                loader.diskCache?.openSnapshot(url)?.use { File(it.data.toString()) }?.takeIf { it.isFile }
            } catch (_: Exception) {
                null
            }
        }

        /** Listening counts from the server are not read yet (the Statistics phase); the shuffle is uniform until then. */
        override fun listenCounts(): Map<String, Int>? = null

        override fun song(id: String): Song? = library.song(id)

        /** The repository reads the index in its constructor, so the library is known as soon as it exists. */
        override suspend fun awaitLibrary() {}

        override val playSink = PlaySink { batchKey, plays ->
            try {
                api.postPlays(PlayLog.body(batchKey, plays))
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                (e as? ApiError.Refused)?.status ?: (e as? ApiError.Http)?.status
            }
        }
    }
}
