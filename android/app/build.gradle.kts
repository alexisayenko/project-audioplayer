import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// Local, git-ignored settings (AND-074): the Google web client id never lives in the repo.
val localProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun localOrEnv(key: String, env: String): String = (localProps.getProperty(key) ?: System.getenv(env) ?: "").trim()

android {
    namespace = "com.alexisayenko.audioplayer.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.alexisayenko.audioplayer.android"
        minSdk = 28
        targetSdk = 37
        // Date-based like the iOS build number (ADR-0008, AND-081): YYYYMMDDNN, strictly rising.
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 2026111101
        versionName = "1.0"
        buildConfigField("String", "SERVER_URL", "\"https://electrophone.cc\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${localOrEnv("googleWebClientId", "GOOGLE_WEB_CLIENT_ID")}\"")
    }

    signingConfigs {
        // Release keys come from the environment (scripts/build-android-release.sh sources them, AND-082).
        val store = System.getenv("ANDROID_RELEASE_STORE_FILE")
        if (!store.isNullOrBlank()) {
            create("release") {
                storeFile = file(store)
                storePassword = System.getenv("ANDROID_RELEASE_STORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_RELEASE_KEY_ALIAS") ?: "electrophone"
                keyPassword = System.getenv("ANDROID_RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        // The shared case files are read in place, never copied (AND-020, question NG answer 1).
        getByName("test").resources.srcDir(rootProject.file("../server/tests/fixtures"))
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)
    implementation(libs.credentials)
    implementation(libs.credentials.play.services)
    implementation(libs.googleid)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.guava)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.okhttp)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.work.testing)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
