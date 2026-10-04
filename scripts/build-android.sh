#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$PATH"
# Reuse an installed Gradle runtime, not TV's app ID, source, data or signing key.
gradle_bin="${MUSIC_GRADLE_BIN:-$HOME/.cache/readiz-tv-android/gradle-8.13/bin/gradle}"
if [[ ! -x "$gradle_bin" || ! -x "$JAVA_HOME/bin/java" || ! -d "$ANDROID_HOME/platforms/android-36" ]]; then
  echo 'JDK 17, Android SDK 36 and Gradle 8.13 are required. Set JAVA_HOME, ANDROID_HOME and MUSIC_GRADLE_BIN.' >&2
  exit 1
fi
"$gradle_bin" -p "$repo_root/android" --no-daemon :app:assembleDebug :app:lintDebug
mkdir -p "$repo_root/output/android"
cp "$repo_root/android/app/build/outputs/apk/debug/app-debug.apk" "$repo_root/output/android/readiz-music-debug.apk"
echo "Debug scaffold: $repo_root/output/android/readiz-music-debug.apk"
