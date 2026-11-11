package com.alexisayenko.audioplayer.android.ui.songform

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.alexisayenko.audioplayer.android.data.Library
import com.alexisayenko.audioplayer.android.data.Outcome
import com.alexisayenko.audioplayer.android.logic.COUNTRY_CAP
import com.alexisayenko.audioplayer.android.logic.GENRE_CAP
import com.alexisayenko.audioplayer.android.logic.cleanPasted
import com.alexisayenko.audioplayer.android.logic.displayYear
import com.alexisayenko.audioplayer.android.logic.source
import com.alexisayenko.audioplayer.android.logic.sourceOf
import com.alexisayenko.audioplayer.android.logic.trimSpaces
import com.alexisayenko.audioplayer.android.logic.trimWhitespace
import com.alexisayenko.audioplayer.android.logic.withDecade
import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import kotlin.math.roundToInt

/** An artist and title that a lookup proposes instead of the typed ones (Swift `MetadataResult.Suggest`). */
data class SongSuggest(val artist: String?, val title: String?)

/** The part of a [SongSuggest] that still differs from the fields (Swift `SongFormState.hint`). */
data class SongHint(val artist: String?, val title: String?)

/**
 * The editable song fields shared by the Add form and the Edit form: the Kotlin counterpart of the Swift
 * `SongFormState`, field for field. Title, artist and remix are plain strings that the token fields show as pills.
 *
 * Not ported: "Get metadata" and its service icons (`getMetadata`, `services`, `metaBusy`), because the Android
 * [Library] has no metadata call yet. [suggest] and [metaNote] are kept so the call can be added without a new field.
 */
open class SongFormState() {
    var title by mutableStateOf("")
    var artist by mutableStateOf("")
    var album by mutableStateOf("")
    var remixer by mutableStateOf("")
    private var yearText by mutableStateOf("")

    /** The year as typed; setting it moves the `decade:` tag of [tags] and [suggested] along. */
    var year: String
        get() = yearText
        set(value) {
            yearText = value
            applyDecade()
        }
    var wikiSong by mutableStateOf("")
    var wikiArtist by mutableStateOf("")
    var musicbrainzURL by mutableStateOf("")
    var tags by mutableStateOf(listOf<String>())
    var suggested by mutableStateOf(listOf<String>())
    var pendingTag by mutableStateOf("")
    var pendingGenre by mutableStateOf("")
    var pendingCountry by mutableStateOf("")
    var metaNote by mutableStateOf<String?>(null)
    var suggest by mutableStateOf<SongSuggest?>(null)

    /** The cover shown beside the fields: an image URL or `/covers/<id>`; never edited here. */
    var cover by mutableStateOf<String?>(null)
        protected set

    /** The link the song came from; shown read-only. */
    var sourceUrl by mutableStateOf<String?>(null)
        protected set

    /** Where the song comes from ("youtube", "soundcloud"); shown as a small label. */
    var source by mutableStateOf<String?>(null)
        protected set

    /** Length in seconds, when known; shown read-only. */
    var duration by mutableStateOf<Double?>(null)
        protected set

    /** The detected tempo, rounded; never typed (IOS-069). */
    var bpm by mutableStateOf<Int?>(null)
        protected set

    /** The song being edited as the library holds it; null in the Add form. */
    var base: Song? = null
        private set

    private var initial: List<Any?> = emptyList()

    /** The Edit form over [song]. */
    constructor(song: Song) : this() {
        base = song
        title = song.title
        artist = song.artist
        album = song.album ?: ""
        remixer = song.remixer ?: ""
        year = song.year?.toString() ?: ""
        wikiSong = song.wikipediaSong ?: ""
        wikiArtist = song.wikipediaArtist ?: ""
        musicbrainzURL = song.musicbrainzURL ?: ""
        tags = song.tags ?: emptyList()
        cover = song.thumbnail
        sourceUrl = song.sourceURL
        source = song.source
        duration = song.duration
        bpm = song.bpm?.roundToInt()
        initial = snapshot()
    }

    private fun snapshot(): List<Any?> = listOf(title, artist, album, remixer, year, wikiSong, wikiArtist, tags)

    /** True once a field differs from the song the form was opened on, or text is still typed in a chip field. */
    val hasChanges: Boolean
        get() = snapshot() != initial || listOf(pendingTag, pendingGenre, pendingCountry).any { it.trimWhitespace().isNotEmpty() }

    /** Only a remix (or an untyped version) is edited through the Remix text; a cover, live, ... version is read-only so clearing the text cannot wipe it. */
    val remixLocked: Boolean
        get() {
            val type = base?.version?.type ?: return false
            return type != "remix" && type != "other"
        }

    /** "Cover of X", "Live: Royal Albert Hall": the version in words, for the read-only line. */
    val versionSummary: String?
        get() {
            val v = base?.version ?: return null
            val type = v.type ?: return null
            val original = (v.originalArtists ?: emptyList()).joinToString(", ")
            val name = v.name?.trimWhitespace() ?: ""
            val head = type.take(1).uppercase() + type.drop(1)
            if (original.isNotEmpty()) return "$head of $original"
            return if (name.isEmpty()) head else "$head: $name"
        }

    val featuredSummary: String?
        get() {
            val names = base?.featuredArtists ?: emptyList()
            return if (names.isEmpty()) null else "Featuring " + names.joinToString(", ")
        }

    private fun plain(s: String?): String = (s ?: "").trimWhitespace()

    /**
     * The keys an edit sends: only the credit fields the person changed, so the server keeps what the form cannot show
     * (Swift `editChanges`). A cleared remix or year is present with a null value.
     */
    fun editChanges(): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>("title" to title)
        if (plain(artist) != plain(base?.artist)) out["artist"] = artist
        if (plain(album) != plain(base?.album)) out["album"] = album
        if (!remixLocked && plain(remixer) != plain(base?.remixer)) out["remixer"] = remixerValue
        if (yearValue != base?.year) out["year"] = yearValue
        return out
    }

    val remixerValue: String? get() = remixer.trimWhitespace().ifEmpty { null }
    val yearValue: Int? get() = year.trimSpaces().toIntOrNull()
    val wikiSongValue: String? get() = wikiSong.trimSpaces().ifEmpty { null }
    val wikiArtistValue: String? get() = wikiArtist.trimSpaces().ifEmpty { null }
    val musicbrainzValue: String? get() = musicbrainzURL.ifEmpty { null }

    private fun differs(suggested: String?, current: String): String? {
        val s = suggested?.trimWhitespace()
        if (s.isNullOrEmpty()) return null
        return if (s.equals(current.trimWhitespace(), ignoreCase = true)) null else s
    }

    /** The proposed artist and title that still differ from the fields; null when there is nothing to offer. */
    val hint: SongHint?
        get() {
            val a = differs(suggest?.artist, artist)
            val t = differs(suggest?.title, title)
            return if (a == null && t == null) null else SongHint(a, t)
        }

    /** Takes the proposed artist and title into the fields. */
    fun applyHint() {
        val h = hint ?: return
        h.artist?.let { artist = it }
        h.title?.let { title = it }
        suggest = null
    }

    /** Keeps the `decade:` tag in step with the year the song is shown with. */
    fun applyDecade() {
        val shown = displayYear(yearValue, base?.version?.releaseYear)
        tags = withDecade(tags, shown)
        suggested = withDecade(suggested, shown)
    }

    fun resetMetadata() {
        suggest = null
        metaNote = null
    }

    fun resetPending() {
        pendingTag = ""
        pendingGenre = ""
        pendingCountry = ""
    }

    /** Commits typed genre and country text, then returns the final tag list including a pending tag. */
    fun commitPending(): List<String> {
        val g = commitNamespaced(tags, "genre", GENRE_CAP, pendingGenre)
        val c = commitNamespaced(g.tags, "country", COUNTRY_CAP, pendingCountry)
        tags = c.tags
        pendingGenre = g.input
        pendingCountry = c.input
        return finalTags(tags, pendingTag)
    }

    /**
     * The `metadata` object of `POST /songs` exactly as the iPhone sends it (`AddFlow.save`): every key present,
     * empty optional values as null, an empty album as "".
     */
    fun addMetadata(): Map<String, Any?> = linkedMapOf(
        "title" to title,
        "artist" to artist,
        "album" to album,
        "remixer" to remixerValue,
        "year" to yearValue,
        "wikipedia_song" to wikiSongValue,
        "wikipedia_artist" to wikiArtistValue,
        "musicbrainz_url" to musicbrainzValue,
    )

    /**
     * The whole body of an edit as the iPhone sends it (`SongEditView.save`): [editChanges] plus the three links and
     * the final tags. Commits typed chip text first.
     */
    fun editPayload(): Map<String, Any?> {
        val finalTagList = commitPending()
        val out = LinkedHashMap(editChanges())
        out["wikipedia_song"] = wikiSong.trimSpaces().ifEmpty { null }
        out["wikipedia_artist"] = wikiArtist.trimSpaces().ifEmpty { null }
        out["musicbrainz_url"] = musicbrainzURL.trimSpaces().ifEmpty { null }
        out["tags"] = finalTagList
        return out
    }

    /**
     * The song to save. Commits typed chip text first.
     *
     * With [base] (Edit) only what the person changed is replaced, by the rules of [editChanges], so a song that was
     * opened and saved untouched comes back equal to [base]. Without it (Add) every field comes from the form, as the
     * iPhone builds its `Track` after `POST /songs`; the caller adds the id, length, cover and link of the preview.
     */
    fun toSong(base: Song?): Song {
        val finalTagList = commitPending()
        if (base == null) {
            return Song(
                id = "",
                title = title,
                artist = artist,
                album = album.ifEmpty { null },
                remixer = remixerValue,
                year = yearValue,
                tags = finalTagList,
                wikipediaSong = wikiSongValue,
                wikipediaArtist = wikiArtistValue,
                musicbrainzURL = musicbrainzValue,
            )
        }
        val changes = editChanges()
        fun link(typed: String, stored: String?): String? = if (plain(typed) == plain(stored)) stored else typed.trimSpaces().ifEmpty { null }
        return base.copy(
            title = title,
            artist = if ("artist" in changes) artist else base.artist,
            album = if ("album" in changes) album.ifEmpty { null } else base.album,
            remixer = if ("remixer" in changes) remixerValue else base.remixer,
            year = if ("year" in changes) yearValue else base.year,
            tags = if (finalTagList == (base.tags ?: emptyList<String>())) base.tags else finalTagList,
            wikipediaSong = link(wikiSong, base.wikipediaSong),
            wikipediaArtist = link(wikiArtist, base.wikipediaArtist),
            musicbrainzURL = link(musicbrainzURL, base.musicbrainzURL),
        )
    }
}

/**
 * The Add flow: a pasted link, its preview and the editable fields (Swift `AddFlow`). Server calls go through the
 * [Library] passed in, so the class itself holds no Android or network code.
 */
class AddSongState(initialLink: String? = null) : SongFormState() {
    enum class Phase { Idle, Loading, Ready, Saving, Saved, Failed }

    /** The link field's text. */
    var url by mutableStateOf(initialLink?.let(::cleanPasted) ?: "")
    var phase by mutableStateOf(Phase.Idle)
    var preview by mutableStateOf<Preview?>(null)

    /** What went wrong with Fetch or Save, in words for the person. */
    var message by mutableStateOf<String?>(null)

    val busy: Boolean get() = phase == Phase.Loading || phase == Phase.Saving

    /** True once a preview is on screen with its form. */
    val hasPreview: Boolean get() = preview != null && phase != Phase.Idle && phase != Phase.Loading

    /** Takes typed or pasted link text; a paste (more than one new character) is cleaned to the plain link at once. */
    fun onUrlInput(new: String) {
        val pasted = new.length - url.length > 1
        url = if (pasted) cleanPasted(new) else new
    }

    /** `POST /preview` for the link, then fills the fields from the answer. */
    suspend fun loadPreview(library: Library) {
        val clean = cleanPasted(url)
        url = clean
        if (clean.isEmpty() || busy) return
        phase = Phase.Loading
        message = null
        musicbrainzURL = ""
        resetMetadata()
        when (val r = library.preview(clean)) {
            is Outcome.Ok -> {
                val p = r.value
                preview = p
                title = p.title ?: ""
                artist = p.artist ?: ""
                album = p.album ?: ""
                remixer = p.remixer ?: ""
                year = p.year?.toString() ?: ""
                wikiSong = p.wikipedia_song ?: ""
                wikiArtist = p.wikipedia_artist ?: ""
                val sug = p.tags ?: emptyList()
                tags = withDecade(sug, p.year)
                suggested = withDecade(sug, p.year)
                resetPending()
                cover = p.thumbnail
                sourceUrl = p.source_url ?: clean
                source = p.source ?: sourceOf(p.id)
                duration = p.duration
                phase = Phase.Ready
            }
            is Outcome.Failed -> {
                preview = null
                message = r.message
                phase = Phase.Idle
            }
        }
    }

    /** The song `POST /songs` saves: the form's fields on the preview's id, length, cover and link. Null before a preview. */
    fun song(): Song? {
        val p = preview ?: return null
        return toSong(null).copy(
            id = p.id,
            duration = p.duration,
            thumbnail = if (p.thumbnail == null) null else "/covers/${p.id}",
            sourceURL = p.source_url ?: url,
        )
    }

    /** Saves the song; with [download] its audio is queued for this phone. True when the sheet may close. */
    suspend fun save(library: Library, download: Boolean): Boolean {
        if (phase != Phase.Ready && phase != Phase.Failed) return false
        val song = song() ?: return false
        phase = Phase.Saving
        message = null
        return when (val r = library.add(song, download)) {
            is Outcome.Ok -> {
                phase = Phase.Saved
                true
            }
            is Outcome.Failed -> {
                message = r.message
                phase = Phase.Failed
                false
            }
        }
    }
}
