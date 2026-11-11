package com.alexisayenko.audioplayer.android.data.api

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * What a server call can fail with: the Kotlin `APIError` of `ios/Sources/APIClient.swift`, with the same words for the person
 * and the same mapping of the server's answers (AND-021).
 */
sealed class ApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The server URL in the build is not a URL. */
    class BadUrl : ApiError("Invalid server URL")

    /** No answer: no network, DNS or connection failure. */
    class Unreachable(cause: Throwable? = null) : ApiError("Can't reach the server", cause)

    /** The server did not answer in time. */
    class Timeout(cause: Throwable? = null) : ApiError("Server timed out", cause)

    /** 403 with an account code (`forbidden`, `not_allowed`, `signup_closed`, ...): this account may not use the server. */
    class Forbidden : ApiError(FORBIDDEN_MESSAGE)

    /**
     * A coded refusal `{"error": code, "detail": text}`: 429 `hourly_limit` (with [retryAfterMinutes]), 403 `library_full_songs`
     * and `library_full_bytes`, 503 `server_full`, the link errors of `POST /preview` and the like.
     */
    class Refused(val status: Int, val code: String, val detail: String, val retryAfterMinutes: Int? = null) : ApiError(detail)

    /**
     * Any other answer outside 200..299; [detail] is the server's text, possibly empty. The messages of a 422 validation list are
     * joined with "; " (the Swift client shows only the bare code `unprocessable` there; the messages say what to fix).
     */
    class Http(val status: Int, val detail: String) : ApiError(
        when {
            status == 401 -> "Not signed in. Sign in in Settings"
            detail.isEmpty() -> "Server error $status"
            else -> detail
        },
    )

    /** The answer arrived but could not be read as the expected JSON. */
    class Unreadable(cause: Throwable? = null) : ApiError("The server's reply could not be read. Update the app and try again.", cause)

    /** The HTTP status, or 0 when there was no answer. */
    val httpStatus: Int
        get() = when (this) {
            is Refused -> status
            is Http -> status
            is Forbidden -> 403
            else -> 0
        }

    /** 401: the server did not accept the ID token (`bad token`). */
    val isUnauthorized: Boolean get() = httpStatus == 401

    /** 429: too many server fetches this hour (`hourly_limit`, AND-052). */
    val isHourlyLimit: Boolean get() = (this is Refused && code == "hourly_limit") || (this is Http && status == 429)

    /** Minutes until the hourly limit lets the next fetch through; at least one. Only meaningful when [isHourlyLimit]. */
    val waitMinutes: Int
        get() = when (this) {
            is Refused -> retryAfterMinutes ?: retryMinutes(detail)
            is Http -> retryMinutes(detail)
            else -> 1
        }

    /** 403 `library_full_songs` or `library_full_bytes`. */
    val isLibraryFull: Boolean get() = this is Refused && code.startsWith("library_full_")

    /** 503 `server_full`. */
    val isServerFull: Boolean get() = this is Refused && code == "server_full"

    /** True when trying again later may work without the person doing anything: no answer, a timeout or a 5xx that is not `server_full`. */
    val isTransient: Boolean
        get() = when (this) {
            is Unreachable, is Timeout -> true
            is Http -> status >= 500 || status == 408
            is Refused -> status >= 500 && !isServerFull
            else -> false
        }

    companion object {
        const val FORBIDDEN_MESSAGE = "This account isn't allowed on this server. Sign out and use another account."
        private val forbiddenCodes = setOf("forbidden", "not_allowed", "signup_closed", "unverified_email", "no_email")
        private val minutesInText = Regex("""(\d+)\s*min""")

        /** Minutes to wait from a refusal text such as "Try again in 12 min."; one minute when the text has none (`AlbumRun.retryMinutes`). */
        fun retryMinutes(detail: String): Int =
            maxOf(1, minutesInText.find(detail)?.groupValues?.get(1)?.toIntOrNull() ?: 1)

        /**
         * Maps an answer outside 200..299 to an error, as `APIClient.check` does. [body] is the parsed JSON body or null,
         * [raw] the body text, [retryAfterSeconds] the `Retry-After` header.
         */
        fun from(status: Int, body: JsonElement?, raw: String, retryAfterSeconds: Long? = null): ApiError {
            val obj = body as? JsonObject ?: return Http(status, raw)
            val code = (obj["error"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val detail = obj["detail"]
            val text = (detail as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (status == 403 && code in forbiddenCodes) return Forbidden()
            if (code != null && text != null) {
                val minutes = if (status == 429) {
                    (obj["retry_after_minutes"] as? JsonPrimitive)?.intOrNull
                        ?: retryAfterSeconds?.let { ((it + 59) / 60).toInt() }
                        ?: retryMinutes(text)
                } else {
                    null
                }
                return Refused(status, code, text, minutes?.coerceAtLeast(1))
            }
            val listed = (detail as? JsonArray)
                ?.mapNotNull { ((it as? JsonObject)?.get("msg") as? JsonPrimitive)?.content }
                ?.joinToString("; ")
                ?.takeIf { it.isNotEmpty() }
            val words = text ?: listed ?: code ?: raw
            return Http(status, words)
        }
    }
}
