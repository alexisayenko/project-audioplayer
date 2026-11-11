package com.alexisayenko.audioplayer.android.logic

import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/*
 * Small pure helpers the screens share: times, sizes, the seek tap and the progress throttle.
 * Ports `formatTime` (`ios/Sources/TransportViews.swift`), `ShareLink.formatClock` (`ios/Sources/Share.swift`),
 * `formatTotalLength` (`ios/Sources/AlbumModels.swift`), `ios/Sources/PlaybackSeek.swift` and
 * `ios/Sources/ProgressGate.swift`.
 */

/** A position or length as `m:ss` ("3:07", "75:00"); negative and unknown values show as "0:00". */
fun formatTime(seconds: Double): String {
    val s = if (seconds.isNaN()) 0L else maxOf(seconds, 0.0).toLong()
    return String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60)
}

/** A position as `m:ss`, or `h:mm:ss` from one hour on; capped at 24 hours. */
fun formatClock(seconds: Double): String {
    val s = if (!seconds.isFinite() || seconds < 0) 0L else minOf(floor(seconds), 86_400.0).toLong()
    val h = s / 3600
    val m = (s % 3600) / 60
    val r = s % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, r) else String.format(Locale.ROOT, "%d:%02d", m, r)
}

/** A total length in words: "52 s", "43 min", "1 h 04 min" (as the web's `formatTotalLength`). */
fun formatTotalLength(seconds: Double): String {
    val s = seconds.roundToLong()
    if (s < 60) return "$s s"
    val minutes = (seconds / 60).roundToLong()
    val hours = minutes / 60
    return if (hours > 0) "$hours h " + String.format(Locale.ROOT, "%02d", minutes % 60) + " min" else "$minutes min"
}

/**
 * A storage size in decimal units, the way iOS shows file sizes: "512 bytes", "640 KB", "12.3 MB", "1.25 GB".
 * Stands in for `ByteCountFormatter` (file style), which iOS calls directly; its "Zero KB" for nothing is "0 KB" here.
 */
fun formatBytes(bytes: Long): String {
    val b = maxOf(bytes, 0L)
    return when {
        b == 0L -> "0 KB"
        b < 1_000L -> if (b == 1L) "1 byte" else "$b bytes"
        b < 999_500L -> String.format(Locale.ROOT, "%.0f KB", b / 1e3)
        b < 999_950_000L -> trimZeros(String.format(Locale.ROOT, "%.1f", b / 1e6)) + " MB"
        else -> trimZeros(String.format(Locale.ROOT, "%.2f", b / 1e9)) + " GB"
    }
}

private fun trimZeros(number: String): String = if ('.' in number) number.trimEnd('0').trimEnd('.') else number

/** Where a tap on the seek bar leads. Ports `PlaybackSeek` of `ios/Sources/PlaybackSeek.swift`. */
object PlaybackSeek {
    /**
     * A tap beside the thumb skips [step] seconds toward the tapped side, never past the song's ends.
     * Null when nothing should happen: a tap on the thumb itself, or values that are not usable numbers.
     */
    fun tapTarget(current: Double, duration: Double, tapped: Double, step: Double = 5.0): Double? {
        if (!current.isFinite() || !duration.isFinite() || duration <= 0 || !tapped.isFinite() || !step.isFinite() || step <= 0) {
            return null
        }
        val position = current.coerceIn(0.0, duration)
        if (tapped < position) return maxOf(0.0, position - step)
        if (tapped > position) return minOf(duration, position + step)
        return null
    }
}

/**
 * Lets the byte-by-byte progress of one download reach the screen at a calm pace: a value passes only when its whole
 * percent is new and at least [interval] seconds have gone by since the last one that passed; 100% always passes.
 * Safe to call from any thread. Ports `ProgressGate` of `ios/Sources/ProgressGate.swift`.
 */
class ProgressGate(private val interval: Double = INTERVAL) {
    private var percent = -1
    private var passedAt: Double? = null

    /** True when [value] (0..1, clamped) should be shown; [now] is a steady clock in seconds. */
    @Synchronized
    fun admit(value: Double, now: Double = System.nanoTime() / 1e9): Boolean {
        val next = floor(value.coerceIn(0.0, 1.0) * 100).toInt()
        if (next == percent) return false
        val last = passedAt
        if (next < 100 && last != null && now - last < interval) return false
        percent = next
        passedAt = now
        return true
    }

    companion object {
        /** The default pause between two shown values, in seconds. */
        const val INTERVAL = 0.25
    }
}
