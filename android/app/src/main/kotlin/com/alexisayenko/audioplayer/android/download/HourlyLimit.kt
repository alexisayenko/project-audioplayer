package com.alexisayenko.audioplayer.android.download

import com.alexisayenko.audioplayer.android.data.api.ApiError

/**
 * The maths of the hourly-limit pause (AND-052), with the clock passed in: the rules of the iOS `AlbumRun`
 * (`ios/Sources/AlbumPlan.swift`). A 429 `hourly_limit` pauses server fetches for the minutes the server names, at least one.
 */
object HourlyLimit {
    private const val MINUTE_MS = 60_000L

    /** Minutes to wait from a refusal text such as "Try again in 12 min."; one minute when the text has none. */
    fun retryMinutes(detail: String): Int = ApiError.retryMinutes(detail)

    /** When a pause of [minutes] that starts at [nowMs] ends; never sooner than one minute. */
    fun pauseUntil(nowMs: Long, minutes: Int): Long = nowMs + maxOf(1, minutes) * MINUTE_MS

    /** Milliseconds of pause left at [nowMs]; 0 when not paused or over. */
    fun remainingMs(nowMs: Long, untilMs: Long): Long = maxOf(0, untilMs - nowMs)

    fun isPaused(nowMs: Long, untilMs: Long): Boolean = remainingMs(nowMs, untilMs) > 0

    /** Whole minutes left, rounded up, at least one while paused; 0 when not paused. */
    fun minutesLeft(nowMs: Long, untilMs: Long): Int {
        val left = remainingMs(nowMs, untilMs)
        return if (left == 0L) 0 else maxOf(1, ((left + MINUTE_MS - 1) / MINUTE_MS).toInt())
    }

    /** "Paused: hourly limit, resumes in N min", or null when not paused: the line of the Library row and of Settings. */
    fun pauseText(nowMs: Long, untilMs: Long): String? {
        val minutes = minutesLeft(nowMs, untilMs)
        return if (minutes == 0) null else "Paused: hourly limit, resumes in $minutes min"
    }
}
