package com.alexisayenko.audioplayer.android.preview

import android.app.Activity
import com.alexisayenko.audioplayer.android.AppGraph
import com.alexisayenko.audioplayer.android.auth.Account
import com.alexisayenko.audioplayer.android.auth.Session
import com.alexisayenko.audioplayer.android.data.AppSettings
import com.alexisayenko.audioplayer.android.data.AudioState
import com.alexisayenko.audioplayer.android.data.Library
import com.alexisayenko.audioplayer.android.data.Outcome
import com.alexisayenko.audioplayer.android.data.SyncStatus
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.data.Usage
import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.playback.PlayerController
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// In-memory stand-ins for the app's services: Compose previews and the screenshot tests render the real screens on them.

/** A small library that covers every row state: on the phone, on the server, downloading, paused, failed, no audio. */
object SampleSongs {
    val all: List<Song> = listOf(
        Song(id = "s1", title = "What Is Love", artist = "Haddaway", duration = 268.0, year = 1993, tags = listOf("genre:eurodance", "country:DE", "decade:1990s"), genres = listOf("Eurodance"), bpm = 124.0, album = "The Album", onServer = true, sourceURL = "https://www.youtube.com/watch?v=HEXWRTEbj1I"),
        Song(id = "s2", title = "LSD", artist = "Hallucinogen", duration = 471.0, year = 1995, tags = listOf("genre:goa trance", "country:GB", "decade:1990s"), genres = listOf("Goa trance"), album = "Twisted", onServer = true),
        Song(id = "s3", title = "Blue Monday", artist = "New Order", duration = 448.0, year = 1983, tags = listOf("genre:synth-pop", "country:GB", "decade:1980s"), genres = listOf("Synth-pop"), onServer = true),
        Song(id = "s4", title = "Around the World", artist = "Daft Punk", duration = 429.0, year = 1997, tags = listOf("genre:french house", "country:FR", "decade:1990s"), genres = listOf("French house"), album = "Homework", onServer = true),
        Song(id = "s5", title = "Children", artist = "Robert Miles", duration = 242.0, year = 1995, tags = listOf("genre:dream trance", "country:IT", "decade:1990s"), genres = listOf("Dream trance"), onServer = true),
        Song(id = "s6", title = "Born Slippy .NUXX", artist = "Underworld", duration = 585.0, year = 1996, tags = listOf("genre:techno", "country:GB", "decade:1990s"), genres = listOf("Techno"), onServer = true),
        Song(id = "s7", title = "Smack My Bitch Up", artist = "The Prodigy", duration = 343.0, year = 1997, tags = listOf("genre:big beat", "country:GB", "decade:1990s"), genres = listOf("Big beat"), onServer = true),
        Song(id = "s8", title = "Sandstorm", artist = "Darude", duration = 225.0, year = 1999, tags = listOf("genre:trance", "country:FI", "decade:1990s"), genres = listOf("Trance"), onServer = false),
        Song(id = "s9", title = "Insomnia (Monster Mix)", artist = "Faithless", duration = 521.0, year = 1995, remixer = "Rollo & Sister Bliss", tags = listOf("genre:progressive house", "country:GB", "decade:1990s"), genres = listOf("Progressive house"), onServer = true),
        Song(id = "s10", title = "Windowlicker", artist = "Aphex Twin", duration = 366.0, year = 1999, tags = listOf("genre:idm", "country:GB", "decade:1990s"), genres = listOf("IDM"), onServer = true),
    )
    val onPhone: Set<String> = setOf("s1", "s2", "s3", "s4")
    val transfers: Map<String, Transfer> = mapOf(
        "s5" to Transfer.Copying(0.42f),
        "s6" to Transfer.Fetching(null),
        "s7" to Transfer.Paused(System.currentTimeMillis() + 23 * 60_000L),
        "s9" to Transfer.Failed("The download failed. Try again."),
    )
}

class FakeLibrary(
    songs: List<Song> = SampleSongs.all,
    phone: Set<String> = SampleSongs.onPhone,
    transfers: Map<String, Transfer> = SampleSongs.transfers,
    status: SyncStatus = SyncStatus(synced = true, reachable = true),
) : Library {
    override val songs = MutableStateFlow(songs)
    override val phoneIds = MutableStateFlow(phone)
    override val transfers = MutableStateFlow(transfers)
    override val status = MutableStateFlow(status)

    override fun audioState(song: Song): AudioState = when {
        song.id in phoneIds.value -> AudioState.Phone
        song.onServer != false -> AudioState.Server
        else -> AudioState.None
    }

    override fun fileFor(id: String): File? = null
    override suspend fun syncCatalog() {}
    override fun download(song: Song) { transfers.value = transfers.value + (song.id to Transfer.Waiting) }
    override fun cancelDownload(id: String) { transfers.value = transfers.value - id }
    override fun downloadAllMissing(): Int = 0
    override suspend fun removeAudio(id: String) { phoneIds.value = phoneIds.value - id }
    override suspend fun removeAllAudio(): Int = phoneIds.value.size.also { phoneIds.value = emptySet() }
    override suspend fun delete(id: String): Outcome<Unit> { songs.value = songs.value.filterNot { it.id == id }; return Outcome.Ok(Unit) }
    override suspend fun preview(url: String): Outcome<Preview> = Outcome.Ok(Preview(id = "new", title = "Voyager", artist = "Daft Punk", duration = 227.0, year = 2001, source = "youtube", source_url = url))
    override suspend fun add(song: Song, download: Boolean): Outcome<Song> { songs.value = listOf(song) + songs.value; return Outcome.Ok(song) }
    override suspend fun update(song: Song): Outcome<Song> { songs.value = songs.value.map { if (it.id == song.id) song else it }; return Outcome.Ok(song) }
    override suspend fun usage(): Usage? = Usage(songs = songs.value.size, maxSongs = 500, bytes = 412L * 1024 * 1024, maxBytes = 2L * 1024 * 1024 * 1024)
    override suspend fun phoneBytes(): Long = 38L * 1024 * 1024
}

class FakeAccount(session: Session? = Session("alex@example.com", Long.MAX_VALUE)) : Account {
    override val session = MutableStateFlow(session)
    override val busy = MutableStateFlow(false)
    override val error = MutableStateFlow<String?>(null)
    override fun signInWithGoogle(activity: Activity) { session.value = Session("alex@example.com", Long.MAX_VALUE) }
    override fun signOut() { session.value = null }
    override suspend fun validToken(): String? = null
}

class FakeSettings : AppSettings {
    override val serverUrl = "https://electrophone.cc"
    override val useMobileData = MutableStateFlow(false)
    override val downloadNewAutomatically = MutableStateFlow(true)
    override fun setUseMobileData(on: Boolean) { useMobileData.value = on }
    override fun setDownloadNewAutomatically(on: Boolean) { downloadNewAutomatically.value = on }
}

class FakeGraph(
    override val library: Library = FakeLibrary(),
    override val player: PlayerController,
    override val account: Account = FakeAccount(),
    override val settings: AppSettings = FakeSettings(),
) : AppGraph

/** A read-only [StateFlow] view, for call sites that want to hide the mutable flow. */
fun <T> MutableStateFlow<T>.readOnly(): StateFlow<T> = this
