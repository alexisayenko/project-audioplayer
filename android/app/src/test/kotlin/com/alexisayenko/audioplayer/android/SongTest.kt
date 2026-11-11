package com.alexisayenko.audioplayer.android

import com.alexisayenko.audioplayer.android.model.Song
import org.junit.Assert.assertEquals
import org.junit.Test

class SongTest {
    @Test
    fun inheritDetailKeepsOwnValuesAndFillsGaps() {
        val saved = Song(id = "a", title = "T", genres = listOf("House"), releaseYear = 1999)
        val fresh = Song(id = "a", title = "T2", releaseYear = 2001)
        val merged = fresh.inheritDetail(saved)
        assertEquals(listOf("House"), merged.genres)
        assertEquals(2001, merged.releaseYear)
        assertEquals("T2", merged.title)
    }
}
