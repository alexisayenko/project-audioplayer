package com.alexisayenko.audioplayer.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onRoot
import com.alexisayenko.audioplayer.android.AppGraph
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.github.takahirom.roborazzi.captureRoboImage
import org.robolectric.RuntimeEnvironment

/** A phone the size of a Pixel 8 (412 x 915 dp at 420 dpi), so the pictures compare with the iPhone screens. */
const val PHONE = "w412dp-h915dp-420dpi"

/**
 * Renders [content] in the Electrophone theme on [graph] and, when recording
 * (`./gradlew recordRoboImagesDebug`), writes `build/outputs/roborazzi/<name>.png`. In a plain test run it only checks
 * that the screen composes without crashing.
 */
fun ComposeContentTestRule.shoot(name: String, graph: AppGraph, dark: Boolean = false, content: @Composable () -> Unit) {
    RuntimeEnvironment.setQualifiers(if (dark) "+night" else "+notnight")
    setContent {
        ElectrophoneTheme(dark = dark) {
            CompositionLocalProvider(LocalAppGraph provides graph, content = content)
        }
    }
    waitForIdle()
    onRoot().captureRoboImage("build/outputs/roborazzi/$name${if (dark) "-dark" else ""}.png")
}
