package com.alexisayenko.audioplayer.android.ui.playback

/** Seconds as `m:ss` (iOS `formatTime`): the seek bar labels and the durations in the queue. */
internal fun formatTime(seconds: Double): String {
    val s = if (seconds.isFinite()) seconds.coerceAtLeast(0.0).toLong() else 0L
    return "%d:%02d".format(s / 60, s % 60)
}

/** Milliseconds as `m:ss`. */
internal fun formatTime(ms: Long): String = formatTime(ms / 1000.0)

/** Where a tap on the seek bar lands (iOS `PlaybackSeek`): one step back or forward from the current position, never a jump to the tapped point. */
internal object PlaybackSeek {
    /** The new position in seconds, or null when the tap is on the current position or the values make no sense. */
    fun tapTarget(current: Double, duration: Double, tapped: Double, step: Double = 5.0): Double? {
        if (!current.isFinite() || !duration.isFinite() || duration <= 0 || !tapped.isFinite() || !step.isFinite() || step <= 0) return null
        val position = current.coerceIn(0.0, duration)
        return when {
            tapped < position -> maxOf(0.0, position - step)
            tapped > position -> minOf(duration, position + step)
            else -> null
        }
    }
}
