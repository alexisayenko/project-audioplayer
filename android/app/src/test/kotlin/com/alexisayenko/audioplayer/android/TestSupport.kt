package com.alexisayenko.audioplayer.android

import android.app.Activity
import com.alexisayenko.audioplayer.android.auth.Account
import com.alexisayenko.audioplayer.android.auth.Session
import com.alexisayenko.audioplayer.android.data.AppSettings
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.data.api.ApiClient
import com.alexisayenko.audioplayer.android.data.store.HourlyPauseStore
import com.alexisayenko.audioplayer.android.download.DownloadQueue
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.Buffer

object TestSupport

/** A shared case file from `server/tests/fixtures`, read in place from the test classpath (AND-020). */
fun fixture(name: String): String =
    requireNotNull(TestSupport::class.java.classLoader?.getResource(name)) { "fixture $name is not on the test classpath" }.readText()

fun fixtureJson(name: String): JsonObject = Json.parseToJsonElement(fixture(name)) as JsonObject

fun tempDir(prefix: String): File = Files.createTempDirectory(prefix).toFile()

fun jsonResponse(code: Int, body: String, vararg headers: Pair<String, String>): MockResponse {
    val builder = MockResponse.Builder().code(code).body(body).addHeader("Content-Type", "application/json")
    headers.forEach { (name, value) -> builder.addHeader(name, value) }
    return builder.build()
}

fun bytesResponse(code: Int, bytes: ByteArray, vararg headers: Pair<String, String>): MockResponse {
    val builder = MockResponse.Builder().code(code).body(Buffer().write(bytes))
    headers.forEach { (name, value) -> builder.setHeader(name, value) }
    return builder.build()
}

fun testHttp(): OkHttpClient = OkHttpClient.Builder().readTimeout(700, TimeUnit.MILLISECONDS).connectTimeout(2, TimeUnit.SECONDS).build()

fun apiFor(server: MockWebServer, token: String? = "tok"): ApiClient =
    ApiClient(server.url("/").toString().trimEnd('/'), testHttp(), { token })

class FakeAccount(signedIn: Boolean = true) : Account {
    override val session = MutableStateFlow<Session?>(if (signedIn) Session("a@b.c", Long.MAX_VALUE) else null)
    override val busy = MutableStateFlow(false)
    override val error = MutableStateFlow<String?>(null)
    override suspend fun signInWithGoogle(activity: Activity) = Unit
    override fun signOut() {
        session.value = null
    }

    override suspend fun validToken(): String? = if (session.value != null) "tok" else null
}

class FakeSettings(mobile: Boolean = false, auto: Boolean = true) : AppSettings {
    override val serverUrl = "http://localhost"
    override val useMobileData = MutableStateFlow(mobile)
    override val downloadNewAutomatically = MutableStateFlow(auto)
    override fun setUseMobileData(on: Boolean) {
        useMobileData.value = on
    }

    override fun setDownloadNewAutomatically(on: Boolean) {
        downloadNewAutomatically.value = on
    }
}

class FakeQueue : DownloadQueue {
    override val transfers = MutableStateFlow<Map<String, Transfer>>(emptyMap())
    val enqueued = ArrayList<String>()
    val cancelled = ArrayList<String>()
    override fun enqueue(song: Song) {
        enqueued += song.id
    }

    override fun cancel(id: String) {
        cancelled += id
    }

    var cancelledAll = 0
    override fun cancelAll() {
        cancelledAll += 1
    }
}

class MemoryPause(var until: Long = 0) : HourlyPauseStore {
    override suspend fun pausedUntil(): Long = until
    override suspend fun setPausedUntil(untilMs: Long) {
        until = untilMs
    }
}
