package com.alexisayenko.audioplayer.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.test.performClick
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The real [App], with WorkManager started the way the system does it on a phone before `onCreate`. */
class StartedApp : App() {
    override fun onCreate() {
        WorkManagerTestInitHelper.initializeTestWorkManager(this)
        super.onCreate()
    }
}

/**
 * Starts the real app with its real services on a fresh install: signed out, nothing on the phone. There is no
 * emulator in CI, so this is the check that the wiring in [App] and the root screen hold together.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = StartedApp::class, qualifiers = "w412dp-h915dp-420dpi")
class AppStartTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun aFreshInstallOpensTheLibrarySignedOutAndReachesSettings() {
        val graph = (compose.activity.application as App).graph
        assertNull(graph.account.session.value)
        compose.onNodeWithContentDescription("Open menu").assertIsDisplayed()
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/app-start.png")

        compose.onNodeWithContentDescription("Open menu").performClick()
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithContentDescription("Sign in with Google").assertIsDisplayed()
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/app-start-settings.png")
    }
}
