package com.alexisayenko.audioplayer.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.alexisayenko.audioplayer.android.ui.ElectrophoneApp

class MainActivity : ComponentActivity() {
    /** A link that arrived through the share sheet and has not been handed to the Add sheet yet (AND-038). */
    private var sharedLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val app = application as App
        app.google.attach(this)
        if (savedInstanceState == null) takeSharedLink(intent)
        setContent {
            ElectrophoneApp(app.graph, sharedLink = sharedLink, onSharedLinkTaken = { sharedLink = null })
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeSharedLink(intent)
    }

    override fun onDestroy() {
        (application as App).google.attach(null)
        super.onDestroy()
    }

    private fun takeSharedLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        sharedLink = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }
    }
}
