package com.alexisayenko.audioplayer.android.ui.icons

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.colors

/** Collects the paths of one icon; used by the generated `Icons.kt`. */
class IconParts internal constructor(private val builder: ImageVector.Builder) {
    fun part(d: String, fill: Boolean, stroke: Boolean) {
        builder.addPath(
            pathData = addPathNodes(d),
            fill = if (fill) SolidColor(Color.Black) else null,
            stroke = if (stroke) SolidColor(Color.Black) else null,
            strokeLineWidth = Icons.STROKE_WIDTH,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
}

/** Builds one icon on the 24 grid with the set's stroke (round caps and joins), drawn black and tinted by [DSIcon]. */
fun dsIconVector(name: String, build: IconParts.() -> Unit): ImageVector {
    val grid = DS.Icon.iconGrid
    val builder = ImageVector.Builder(name = name, defaultWidth = grid.dp, defaultHeight = grid.dp, viewportWidth = grid, viewportHeight = grid)
    IconParts(builder).build()
    return builder.build()
}

/**
 * Draws an icon of the set at a token size in a token colour. A null [contentDescription] hides it from TalkBack,
 * which is right when the button around it carries the label.
 */
@Composable
fun DSIcon(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: Dp = DS.Icon.iconNav,
    tint: Color = DS.colors.ink,
    contentDescription: String? = null,
) {
    Image(
        painter = rememberVectorPainter(icon),
        contentDescription = contentDescription,
        colorFilter = ColorFilter.tint(tint),
        modifier = modifier.size(size),
    )
}
