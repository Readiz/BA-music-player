#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$PATH"
gradle_bin="${MUSIC_GRADLE_BIN:-$HOME/.cache/readiz-tv-android/gradle-8.13/bin/gradle}"
if [[ ! -x "$gradle_bin" || ! -x "$JAVA_HOME/bin/java" || ! -d "$ANDROID_HOME/platforms/android-36" ]]; then
  echo 'JDK 17, Android SDK 36 and Gradle 8.13 are required.' >&2
  exit 1
fi
mode="${1:-debug}"
if [[ "$mode" == release ]]; then
  export MUSIC_ANDROID_SIGNING_DIR="${MUSIC_ANDROID_SIGNING_DIR:-$HOME/.config/readiz-music/android-signing}"
  mkdir -p "$MUSIC_ANDROID_SIGNING_DIR"
  if [[ ! -f "$MUSIC_ANDROID_SIGNING_DIR/release.jks" && ! -f "$MUSIC_ANDROID_SIGNING_DIR/password" ]]; then
    python3 - "$MUSIC_ANDROID_SIGNING_DIR/password" <<'PY'
import pathlib, secrets, sys
pathlib.Path(sys.argv[1]).write_text(secrets.token_urlsafe(36) + '\n')
PY
    keytool -genkeypair -noprompt -keystore "$MUSIC_ANDROID_SIGNING_DIR/release.jks" \
      -storepass:file "$MUSIC_ANDROID_SIGNING_DIR/password" -keypass:file "$MUSIC_ANDROID_SIGNING_DIR/password" \
      -alias readiz-music -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Readiz Music'
  fi
  if [[ ! -f "$MUSIC_ANDROID_SIGNING_DIR/release.jks" || ! -f "$MUSIC_ANDROID_SIGNING_DIR/password" ]]; then
    echo 'Restore the original Music signing key and password before building.' >&2
    exit 1
  fi
  variant=Release
else
  variant=Debug
fi
"$gradle_bin" -p "$repo_root/android" --no-daemon ":app:assemble$variant" ":app:lint$variant" :app:testDebugUnitTest
mkdir -p "$repo_root/output/android"
source_apk="$repo_root/android/app/build/outputs/apk/$mode/app-$mode.apk"
if [[ "$mode" == release ]]; then
  "$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose "$source_apk"
  cp "$source_apk" "$repo_root/output/android/readiz-music.apk"
  python3 - "$repo_root/output/android/readiz-music.apk" "$repo_root/android/app/build/outputs/apk/release/output-metadata.json" <<'PY'
import hashlib, json, pathlib, sys
apk=pathlib.Path(sys.argv[1]); build=json.loads(pathlib.Path(sys.argv[2]).read_text()); entry=build['elements'][0]
release=dict(packageName=build['applicationId'],versionCode=entry['versionCode'],versionName=entry['versionName'],size=apk.stat().st_size,sha256=hashlib.sha256(apk.read_bytes()).hexdigest())
pathlib.Path(str(apk)+'.json').write_text(json.dumps(release,indent=2)+'\n')
PY
else
  cp "$source_apk" "$repo_root/output/android/readiz-music-debug.apk"
fi
echo "Android $mode build ready: $repo_root/output/android"
