package com.alexisayenko.audioplayer.android.data.api

import com.alexisayenko.audioplayer.android.model.Preview
import java.io.Closeable
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * Whether the server answers. Fed by every [ApiClient] call and never probed on its own (IOS-119, AND-021):
 * an answer of any status means reachable, a network failure means unreachable. Null until the first call.
 */
class ServerReachability {
    private val mutable = MutableStateFlow<Boolean?>(null)
    val state: StateFlow<Boolean?> get() = mutable

    fun note(reachable: Boolean) {
        mutable.value = reachable
    }
}

/** A fetched catalog and the ETag to send as `If-None-Match` next time. */
data class CatalogResult(val catalog: CatalogResponse, val etag: String?)

/** An open answer of `GET /files/{id}`. The caller reads [response]'s body and closes it; [cancel] aborts a read in flight. */
class FileAnswer(private val call: Call, val response: Response) : Closeable {
    fun cancel() = call.cancel()
    override fun close() = response.close()
}

/**
 * Talks to the FastAPI server: the Kotlin `APIClient` of `ios/Sources/APIClient.swift` (AND-021).
 * Every call sends `Authorization: Bearer <id token>` from [token] when there is one (AND-071); there are no cookies.
 * Failures are thrown as [ApiError]; every call reports to [reachability].
 *
 * @param baseUrl the server, e.g. `https://electrophone.cc`
 * @param http the shared OkHttp client (no cookie jar)
 * @param token a valid ID token, or null when signed out or the sign-in expired
 */
class ApiClient(
    private val baseUrl: String,
    private val http: OkHttpClient,
    private val token: suspend () -> String?,
    val reachability: ServerReachability = ServerReachability(),
    private val json: Json = ApiJson,
) {
    private fun url(path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val base = baseUrl.toHttpUrlOrNull() ?: throw ApiError.BadUrl()
        val builder = base.newBuilder().encodedPath(path)
        query.forEach { (name, value) -> builder.addQueryParameter(name, value) }
        return builder.build()
    }

    private suspend fun request(
        path: String,
        method: String = "GET",
        body: JsonObject? = null,
        rawBody: String? = null,
        headers: Map<String, String> = emptyMap(),
        query: Map<String, String> = emptyMap(),
    ): Request {
        val builder = Request.Builder().url(url(path, query))
        token()?.let { builder.header("Authorization", "Bearer $it") }
        headers.forEach { (name, value) -> builder.header(name, value) }
        val payload: RequestBody? = (rawBody ?: body?.toString())?.toRequestBody(JSON_TYPE)
        builder.method(method, payload ?: if (method == "POST" || method == "PATCH" || method == "PUT") EMPTY_BODY else null)
        return builder.build()
    }

    /** Runs the call until the headers are in; any answer marks the server reachable, a network failure unreachable. */
    private suspend fun start(request: Request, timeoutSeconds: Long): Pair<Call, Response> {
        val call = http.newCall(request)
        call.timeout().timeout(timeoutSeconds, TimeUnit.SECONDS)
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isCancelled) return
                    reachability.note(false)
                    continuation.resumeWithException(if (e is InterruptedIOException) ApiError.Timeout(e) else ApiError.Unreachable(e))
                }

                override fun onResponse(call: Call, response: Response) {
                    reachability.note(true)
                    if (continuation.isCancelled) response.close() else continuation.resume(call to response)
                }
            })
        }
    }

    private fun failure(response: Response, raw: String): ApiError {
        val body = try {
            json.parseToJsonElement(raw)
        } catch (_: Exception) {
            null
        }
        return ApiError.from(response.code, body, raw, response.header("Retry-After")?.trim()?.toLongOrNull())
    }

    /** The whole body of a 2xx answer; anything else is thrown as the mapped [ApiError]. */
    private suspend fun send(request: Request, timeoutSeconds: Long = 30): String {
        val (_, response) = start(request, timeoutSeconds)
        return withContext(Dispatchers.IO) {
            response.use {
                val raw = try {
                    it.body.string()
                } catch (e: IOException) {
                    throw if (e is InterruptedIOException) ApiError.Timeout(e) else ApiError.Unreachable(e)
                }
                if (!it.isSuccessful) throw failure(it, raw)
                raw
            }
        }
    }

    private inline fun <T> read(parse: () -> T): T = try {
        parse()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        throw ApiError.Unreadable(e)
    }

    /** A cheap authenticated call (`GET /tags`) that proves the server accepts the sign-in. */
    suspend fun verify() {
        send(request(Endpoints.TAGS), 15)
    }

    /** The whole catalog, or null when the server answers 304 to [etag]. */
    suspend fun catalog(etag: String?): CatalogResult? {
        val headers = buildMap {
            put("Cache-Control", "no-cache")
            if (etag != null) put("If-None-Match", etag)
        }
        val (_, response) = start(request(Endpoints.CATALOG, headers = headers), 20)
        return withContext(Dispatchers.IO) {
            response.use {
                if (it.code == 304) return@use null
                val raw = try {
                    it.body.string()
                } catch (e: IOException) {
                    throw ApiError.Unreachable(e)
                }
                if (!it.isSuccessful) throw failure(it, raw)
                CatalogResult(read { CatalogResponse.decode(raw, json) }, it.header("ETag"))
            }
        }
    }

    /** `POST /preview`: what is behind a pasted link. */
    suspend fun preview(url: String): Preview {
        val raw = send(request(Endpoints.PREVIEW, "POST", JsonObject(mapOf("url" to JsonPrimitive(url)))), 90)
        return read { json.decodeFromString<Preview>(raw) }
    }

    /** `POST /songs`: saves a new song; with [audio] the server also fetches its audio (the job is then read with [status]). */
    suspend fun addSong(url: String, metadata: JsonObject, tags: List<String>, audio: Boolean = true) {
        send(request(Endpoints.SONGS, "POST", Payloads.add(url, metadata, tags, audio)))
    }

    /** `PATCH /songs/{id}`: saves edited metadata and returns the song as stored. */
    suspend fun updateSong(id: String, changes: JsonObject): ServerSong {
        val raw = send(request(Endpoints.song(id), "PATCH", changes))
        return read { json.decodeFromString<ServerSong>(raw) }
    }

    /** `DELETE /songs/{id}`: removes the song from the server library. */
    suspend fun deleteSong(id: String) {
        send(request(Endpoints.song(id), "DELETE"))
    }

    /** `POST /songs/{id}/audio`: asks the server to fetch a catalog song's audio; safe to repeat while the job runs. */
    suspend fun requestAudio(id: String): SongStatus {
        val raw = send(request(Endpoints.songAudio(id), "POST"))
        return read { json.decodeFromString<SongStatus>(raw) }
    }

    /** `GET /songs/{id}/status`: the server job of a song. */
    suspend fun status(id: String): SongStatus {
        val raw = send(request(Endpoints.songStatus(id)), 15)
        return read { json.decodeFromString<SongStatus>(raw) }
    }

    /**
     * `GET /files/{id}`: opens the audio file, from byte [from] when it is above zero (`Range: bytes=<from>-`), guarded by
     * `If-Range: [validator]` when given. Answers 200 and 206 are returned open; anything else is thrown as [ApiError].
     */
    suspend fun file(id: String, from: Long = 0, validator: String? = null): FileAnswer {
        val headers = buildMap {
            if (from > 0) {
                put("Range", "bytes=$from-")
                if (validator != null) put("If-Range", validator)
            }
            put("Accept-Encoding", "identity")
        }
        val (call, response) = start(request(Endpoints.file(id), headers = headers), 0)
        if (response.code == 200 || response.code == 206 || response.code == 416) return FileAnswer(call, response)
        val error = withContext(Dispatchers.IO) {
            response.use { failure(it, runCatching { it.body.string() }.getOrDefault("")) }
        }
        throw error
    }

    /** `POST /plays`: sends one play batch (already JSON) and returns the HTTP status, so the caller can tell a refusal that drops the batch from one worth retrying. */
    suspend fun postPlays(body: String): Int {
        val (_, response) = start(request(Endpoints.PLAYS, "POST", rawBody = body), 30)
        response.close()
        return response.code
    }

    /** `GET /me/usage`: the account's quota line. */
    suspend fun usage(): ServerUsage {
        val raw = send(request(Endpoints.ME_USAGE), 15)
        return read { json.decodeFromString<ServerUsage>(raw) }
    }

    /** `GET /tags`: the tags in use with their counts. */
    suspend fun tags(): List<TagCount> {
        val raw = send(request(Endpoints.TAGS), 15)
        return read { json.decodeFromString<List<TagCount>>(raw) }
    }

    /** `GET /genres`: the genre names for the form's suggestions; empty when the answer has none. */
    suspend fun genres(): List<String> {
        val raw = send(request(Endpoints.GENRES), 15)
        val list = (runCatching { json.parseToJsonElement(raw) }.getOrNull() as? JsonObject)?.get("genres") as? JsonArray ?: return emptyList()
        return list.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
    }

    /** `POST /metadata`: the lookup behind the Add/Edit form's "Get metadata". */
    suspend fun metadata(title: String, artist: String, sourceUrls: List<String>, wikiSong: String, wikiArtist: String): MetadataResult {
        val raw = send(request(Endpoints.METADATA, "POST", Payloads.metadata(title, artist, sourceUrls, wikiSong, wikiArtist)), 60)
        return read { MetadataResult.decode(raw, json) }
    }

    private companion object {
        val JSON_TYPE = "application/json".toMediaType()
        val EMPTY_BODY = ByteArray(0).toRequestBody(null)
    }
}
