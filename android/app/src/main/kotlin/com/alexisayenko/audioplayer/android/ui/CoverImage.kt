package com.alexisayenko.audioplayer.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import coil3.compose.AsyncImage
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.R

/**
 * A song cover (iOS `CoverImage`). [source] is an absolute image URL or the server path `/covers/<id>`; server covers are
 * fetched with the Bearer header by the app's image loader, never with a token in the URL (AND-022). Without a cover,
 * or while it loads, the record placeholder shows. Size and corner clip come from the caller's [modifier].
 */
@Composable
fun CoverImage(source: String?, modifier: Modifier = Modifier) {
    val placeholder = painterResource(R.drawable.thumbnail_record)
    val url = when {
        source.isNullOrEmpty() -> null
        source.startsWith("/") -> LocalAppGraph.current.settings.serverUrl.trimEnd('/') + source
        else -> source
    }
    Box(modifier) {
        if (url == null) {
            Image(placeholder, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        } else {
            AsyncImage(
                model = url,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                placeholder = placeholder,
                error = placeholder,
                fallback = placeholder,
            )
        }
    }
}
