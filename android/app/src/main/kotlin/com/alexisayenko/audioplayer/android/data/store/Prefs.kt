package com.alexisayenko.audioplayer.android.data.store

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.alexisayenko.audioplayer.android.BuildConfig
import com.alexisayenko.audioplayer.android.data.AppSettings
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The app's one Preferences DataStore file for the settings and the download pause (AND-023). */
val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/**
 * The switches in Settings, kept in Preferences DataStore (AND-023; the iOS `Settings`).
 * Defaults as on iOS: mobile data off, automatic download on. A change shows at once and is written in [scope].
 *
 * @param store the DataStore, normally `context.settingsStore`
 * @param scope a scope that lives as long as the app
 */
class DataStoreSettings(
    private val store: DataStore<Preferences>,
    private val scope: CoroutineScope,
    override val serverUrl: String = BuildConfig.SERVER_URL,
) : AppSettings {
    private val mobileData = MutableStateFlow(false)
    private val automatic = MutableStateFlow(true)

    override val useMobileData: StateFlow<Boolean> get() = mobileData
    override val downloadNewAutomatically: StateFlow<Boolean> get() = automatic

    private val pendingWrites = AtomicInteger(0)

    init {
        // While a change is being written the store may still emit the older value; it must not flip the switch back.
        scope.launch { store.data.collect { showUnlessWriting(it) } }
    }

    @Synchronized
    private fun showUnlessWriting(prefs: Preferences) {
        if (pendingWrites.get() > 0) return
        mobileData.value = prefs[USE_MOBILE_DATA] ?: false
        automatic.value = prefs[DOWNLOAD_NEW] ?: true
    }

    private fun write(key: Preferences.Key<Boolean>, on: Boolean, shown: MutableStateFlow<Boolean>) {
        synchronized(this) {
            pendingWrites.incrementAndGet()
            shown.value = on
        }
        scope.launch {
            try {
                store.edit { it[key] = on }
            } finally {
                pendingWrites.decrementAndGet()
                withContext(NonCancellable) { runCatching { showUnlessWriting(store.data.first()) } }
            }
        }
    }

    override fun setUseMobileData(on: Boolean) = write(USE_MOBILE_DATA, on, mobileData)

    override fun setDownloadNewAutomatically(on: Boolean) = write(DOWNLOAD_NEW, on, automatic)

    /** The stored "Use mobile data" value, read from disk: what a worker started in a fresh process must use. */
    suspend fun useMobileDataNow(): Boolean = store.data.first()[USE_MOBILE_DATA] ?: false

    companion object {
        val USE_MOBILE_DATA = booleanPreferencesKey("useMobileData")
        val DOWNLOAD_NEW = booleanPreferencesKey("downloadNewAutomatically")
    }
}

/** Where the hourly-limit pause is kept, so the download code can be tested without DataStore. */
interface HourlyPauseStore {
    /** Epoch milliseconds until which server fetches are paused; 0 when not paused. */
    suspend fun pausedUntil(): Long

    suspend fun setPausedUntil(untilMs: Long)
}

/**
 * The hourly-limit pause in Preferences DataStore (AND-023, AND-052): the time the server's `hourly_limit` lifts.
 * Settings reads [pausedUntilMs] for its "Paused: hourly limit, resumes in N min" line.
 */
class DownloadPrefs(private val store: DataStore<Preferences>) : HourlyPauseStore {
    /** Epoch milliseconds until which server fetches are paused; 0 when not paused. A time in the past means the pause is over. */
    val pausedUntilMs: Flow<Long> = store.data.map { it[HOURLY_PAUSE_UNTIL] ?: 0L }

    override suspend fun pausedUntil(): Long = pausedUntilMs.first()

    override suspend fun setPausedUntil(untilMs: Long) {
        store.edit { if (untilMs > 0) it[HOURLY_PAUSE_UNTIL] = untilMs else it.remove(HOURLY_PAUSE_UNTIL) }
    }

    companion object {
        val HOURLY_PAUSE_UNTIL = longPreferencesKey("hourlyPauseUntilMs")
    }
}
