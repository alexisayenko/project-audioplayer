package com.alexisayenko.audioplayer.android.data.api

import android.content.Context
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import java.io.File
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okio.Path.Companion.toOkioPath

/**
 * Cover references are stored as a server path (`/covers/<id>[?v=n]`) or an absolute image URL, never with a token:
 * the Swift `CoverURL` of `ios/Sources/APIModels.swift`. On Android the token travels in the `Authorization` header
 * ([BearerInterceptor]), so [resolve] never adds one to the URL (AND-022).
 */
object CoverUrl {
    /** The URL to load for a stored cover reference, or null when there is none or it cannot be read. */
    fun resolve(source: String?, baseUrl: String): String? {
        if (source.isNullOrEmpty()) return null
        if (!source.startsWith("/")) return source
        val base = baseUrl.toHttpUrlOrNull() ?: return null
        return base.resolve(source)?.let(::withoutToken)?.toString()
    }

    /** Drops a `token` query from a stored cover; server covers collapse to their path. */
    fun scrubbed(source: String?): String? {
        if (source == null || !source.contains("token=")) return source
        val relative = source.startsWith("/")
        val url = (if (relative) PLACEHOLDER.resolve(source) else source.toHttpUrlOrNull()) ?: return source
        if (url.encodedPath.startsWith(Endpoints.COVERS_PREFIX)) return url.encodedPath
        val clean = withoutToken(url)
        return if (relative) clean.encodedPath + (clean.encodedQuery?.let { "?$it" } ?: "") else clean.toString()
    }

    private fun withoutToken(url: HttpUrl): HttpUrl = if (url.queryParameter("token") == null) url else url.newBuilder().removeAllQueryParameters("token").build()

    private val PLACEHOLDER: HttpUrl = HttpUrl.Builder().scheme("https").host("server.invalid").build()
}

/**
 * Adds `Authorization: Bearer <id token>` to requests that go to the server and to nothing else, so a cover hosted elsewhere
 * (a YouTube thumbnail) never sees the token. The token is never written to a URL or a log.
 */
class BearerInterceptor(serverUrl: String, private val token: suspend () -> String?) : Interceptor {
    private val server: HttpUrl? = serverUrl.toHttpUrlOrNull()

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val url = request.url
        val ours = server != null && url.host == server.host && url.port == server.port && url.scheme == server.scheme
        if (!ours || request.header("Authorization") != null) return chain.proceed(request)
        val bearer = runBlocking { token() } ?: return chain.proceed(request)
        return chain.proceed(request.newBuilder().header("Authorization", "Bearer $bearer").build())
    }
}

/** Where the cover cache lives: outside the backup, and not in the system cache the OS may empty while offline. */
fun coverCacheDirectory(context: Context): File = File(context.noBackupFilesDir, "covers")

/**
 * The Coil image loader for covers (AND-022): server covers are fetched with the Bearer header and every cover is kept in a
 * disk cache, so the covers of downloaded songs show offline (IOS-043). A new cover has a new `?v=` and so a new cache entry.
 * Call `diskCache?.clear()` and `memoryCache?.clear()` on sign-out: the same id is another image for another account.
 */
fun coverImageLoader(
    context: Context,
    http: OkHttpClient,
    serverUrl: String,
    token: suspend () -> String?,
    cacheDirectory: File = coverCacheDirectory(context),
    maxCacheBytes: Long = 256L * 1024 * 1024,
): ImageLoader {
    val client = http.newBuilder().addInterceptor(BearerInterceptor(serverUrl, token)).build()
    return ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { client })) }
        .diskCache { DiskCache.Builder().directory(cacheDirectory.toOkioPath()).maxSizeBytes(maxCacheBytes).build() }
        .build()
}

/**
 * Fetches into the disk cache the covers that are not there yet, so the covers of the songs on the phone show offline even
 * when their row was never on screen (the iOS `LibraryStore.prefetchCovers`). Call it with the cover references of the songs
 * on the phone after a download or a sync; covers already stored cost nothing.
 */
fun prefetchCovers(context: Context, loader: ImageLoader, sources: Collection<String?>, serverUrl: String) {
    for (source in sources) {
        val url = CoverUrl.resolve(source, serverUrl) ?: continue
        val stored = try {
            loader.diskCache?.openSnapshot(url)?.also { it.close() } != null
        } catch (_: Exception) {
            false
        }
        if (stored) continue
        loader.enqueue(ImageRequest.Builder(context).data(url).memoryCachePolicy(CachePolicy.DISABLED).build())
    }
}
