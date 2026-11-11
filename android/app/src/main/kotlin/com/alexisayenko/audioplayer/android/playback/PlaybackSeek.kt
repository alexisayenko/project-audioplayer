package com.alexisayenko.audioplayer.android.playback

/** Where a tap beside the seek thumb lands (the Kotlin port of `PlaybackSeek.swift`). All values are in seconds. */
object PlaybackSeek {
    /** One [step] back when the tap is before the current position, one forward when after; null when nothing should move. */
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
