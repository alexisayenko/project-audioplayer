package com.alexisayenko.audioplayer.android.ui.playback

import com.alexisayenko.audioplayer.android.logic.formatTime

/** Milliseconds as `m:ss`, for the seek bar labels (the player reports milliseconds). */
internal fun formatTime(ms: Long): String = formatTime(ms / 1000.0)
