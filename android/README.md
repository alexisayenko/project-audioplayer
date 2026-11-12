# Electrophone for Android

Native Kotlin app (Jetpack Compose, Media3, WorkManager) that does the iOS app's job on an Android phone: songs picked on
the server reach the phone and play offline with the screen locked. Decision: [ADR-0051](../docs/tech/decisions.md);
requirements: [docs/specs/android.md](../docs/specs/android.md); progress: [task-0127](../docs/tasks/task-0127.md).

## Build

Needs a JDK (17 or newer; CI uses 21) and the Android SDK (platform 37). Android Studio brings both; from a shell:

```sh
cd android
export ANDROID_HOME=~/Library/Android/sdk   # or put sdk.dir=... in android/local.properties
./gradlew assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest lintDebug
```

## Google sign-in

The Google web client id is not in the repo (AND-074). Put it in the git-ignored `android/local.properties`:

```
googleWebClientId=<the web client id the server lists in GOOGLE_WEB_CLIENT_ID>
```

The Google Cloud project also needs one Android OAuth client for package `com.alexisayenko.audioplayer.android` per
signing key, each with that key's SHA-1:

- Builds installed from Google Play: the Play **app signing** key. Copy its SHA-1 with the copy button on Play Console >
  App signing; do not take the first 20 bytes of the SHA-256, that is a different value.
- Sideloaded release builds: a second client with the SHA-1 of the upload key (the keystore below).
- Debug builds: the debug key (`./gradlew signingReport`).

A wrong SHA-1 shows in Settings as "[16] Account reauth failed". Without the client id the app builds and plays local
songs, and "Sign in with Google" says it is not configured.

## Generated files

Never edit these by hand:

- `app/src/main/kotlin/.../ui/DesignTokens.kt`: `python3 scripts/sync-design-system.py` (from `docs/brand/tokens.json`)
- `app/src/main/kotlin/.../ui/icons/Icons.kt`: `node scripts/export-android-icons.mjs` (from `web/js/icons.js`)

## Screenshots

The screens render on the JVM (Robolectric + Roborazzi) with in-memory fakes, no device needed:

```sh
./gradlew testDebugUnitTest -Proborazzi.test.record=true   # PNGs in app/build/outputs/roborazzi/
```

## Release

`scripts/build-android-release.sh` builds the signed APK; its header says where the keystore and passwords live.
Install by sideload ("Install unknown apps"). There is no Play Store listing.

## Layout

```
app/src/main/kotlin/com/alexisayenko/audioplayer/android/
  App.kt, AppGraph.kt, MainActivity.kt   wiring, no DI framework
  model/                                 Song and the wire models shared by all layers
  logic/                                 pure ports of the shared logic (fixture-tested)
  data/                                  API client, library index, settings, the Library repository
  download/                              WorkManager downloads
  playback/                              Media3 service, queue rules, play log
  auth/                                  Google sign-in, token store
  ui/                                    design tokens, components, icons, the screens
  preview/                               in-memory fakes for previews and screenshot tests
```
