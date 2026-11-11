package com.alexisayenko.audioplayer.android.data

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.alexisayenko.audioplayer.android.data.store.DataStoreSettings
import com.alexisayenko.audioplayer.android.data.store.DownloadPrefs
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrefsTest {
    private val dir = tempDir("prefs")
    private val scopes = ArrayList<CoroutineScope>()

    @After
    fun tearDown() {
        scopes.forEach { it.cancel() }
        dir.deleteRecursively()
    }

    private fun scope() = CoroutineScope(Dispatchers.IO + SupervisorJob()).also { scopes += it }

    private fun store(scope: CoroutineScope) = PreferenceDataStoreFactory.create(scope = scope) { File(dir, "settings.preferences_pb") }

    @Test
    fun settingsDefaultLikeIosAndSurviveARelaunch() = runBlocking<Unit> {
        val first = scope()
        val file = store(first)
        val settings = DataStoreSettings(file, first, serverUrl = "https://electrophone.cc")
        assertEquals("https://electrophone.cc", settings.serverUrl)
        assertFalse(settings.useMobileData.value)
        assertTrue(settings.downloadNewAutomatically.value)
        assertFalse(settings.useMobileDataNow())

        settings.setUseMobileData(true)
        settings.setDownloadNewAutomatically(false)
        assertTrue("a change shows at once", settings.useMobileData.value)
        assertFalse(settings.downloadNewAutomatically.value)
        withTimeout(5000) { while (!settings.useMobileDataNow()) kotlinx.coroutines.delay(10) }
        withTimeout(5000) { file.data.first { it[DataStoreSettings.DOWNLOAD_NEW] == false } }
        first.cancel()
        first.coroutineContext.job.join()

        val second = scope()
        val relaunched = DataStoreSettings(store(second), second, serverUrl = "x")
        assertTrue(relaunched.useMobileDataNow())
        withTimeout(5000) { relaunched.useMobileData.first { it } }
        withTimeout(5000) { relaunched.downloadNewAutomatically.first { !it } }
    }

    @Test
    fun theHourlyPauseIsKeptAndCleared() = runBlocking<Unit> {
        val scope = scope()
        val prefs = DownloadPrefs(store(scope))
        assertEquals(0L, prefs.pausedUntil())
        prefs.setPausedUntil(1_800_000_000_000L)
        assertEquals(1_800_000_000_000L, prefs.pausedUntil())
        assertEquals(1_800_000_000_000L, prefs.pausedUntilMs.first())
        prefs.setPausedUntil(0)
        assertEquals(0L, prefs.pausedUntil())
    }
}
