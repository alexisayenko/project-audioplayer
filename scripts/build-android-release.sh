#!/bin/sh
# Builds the signed release APK of the Android app (AND-080 to AND-082).
#
# The keystore and its passwords live outside the repo, one file per credential:
#   ~/.config/android/release.jks
#   ~/.config/android/release-store-password.env   (ANDROID_RELEASE_STORE_PASSWORD=...)
#   ~/.config/android/release-key-password.env     (ANDROID_RELEASE_KEY_PASSWORD=...)
# Create the keystore once (keep a backup outside this machine; losing it means a new application id):
#   keytool -genkeypair -v -keystore ~/.config/android/release.jks -alias electrophone -keyalg RSA -keysize 4096 -validity 10000
#
# Usage: scripts/build-android-release.sh [NN]   NN = build of the day, default 01. versionCode is YYYYMMDDNN (ADR-0008).
set -e
cd "$(dirname "$0")/.."

dir="$HOME/.config/android"
store="$dir/release.jks"
for f in "$store" "$dir/release-store-password.env" "$dir/release-key-password.env"; do
  [ -f "$f" ] || { echo "missing $f (see the header of this script)"; exit 1; }
done
set -a
. "$dir/release-store-password.env"
. "$dir/release-key-password.env"
set +a
export ANDROID_RELEASE_STORE_FILE="$store"

code="$(date +%Y%m%d)${1:-01}"
(cd android && ./gradlew lintRelease testReleaseUnitTest assembleRelease -PversionCode="$code")
apk="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$apk" ] || { echo "no signed APK at $apk (is the keystore readable?)"; exit 1; }
echo "built $apk (versionCode $code)"
echo "attach it to a GitHub Release tagged android-v<versionName>"
