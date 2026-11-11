package com.alexisayenko.audioplayer.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.BasicText
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.alexisayenko.audioplayer.android.ui.DS
import com.alexisayenko.audioplayer.android.ui.ElectrophoneTheme
import com.alexisayenko.audioplayer.android.ui.colors

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ElectrophoneTheme {
                Box(Modifier.fillMaxSize().background(DS.colors.ground), contentAlignment = Alignment.Center) {
                    BasicText("Electrophone", style = DS.Type.display.copy(color = DS.colors.ink))
                }
            }
        }
    }
}
