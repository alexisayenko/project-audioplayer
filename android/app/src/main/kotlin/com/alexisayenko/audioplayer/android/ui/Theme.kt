package com.alexisayenko.audioplayer.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

/** The theme's colours; the generated DesignTokens.kt holds the values (ADR-0009, AND-010). */
val LocalDSColors = staticCompositionLocalOf { DSColorsLight }
val LocalDSChart = staticCompositionLocalOf { DSChartLight }

/** `DS.colors.ground`: the colour set of the current theme. */
val DS.colors: DSColors
    @Composable @ReadOnlyComposable get() = LocalDSColors.current

val DS.chart: DSChart
    @Composable @ReadOnlyComposable get() = LocalDSChart.current

/** Electrophone look: design tokens only, no MaterialTheme defaults (AND-012). */
@Composable
fun ElectrophoneTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalDSColors provides if (dark) DSColorsDark else DSColorsLight,
        LocalDSChart provides if (dark) DSChartDark else DSChartLight,
        content = content,
    )
}
