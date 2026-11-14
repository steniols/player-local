#!/usr/bin/env bash
# Compila o APK do Player Local (Android TV) sem Gradle, usando só o Android SDK + JDK 17.
# Uso: bash android/build.sh   → gera android/build/PlayerLocal.apk
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME}/Android/Sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLATFORM="$SDK/platforms/android-34/android.jar"
D8="$BT/d8"; [ -f "$D8" ] || D8="$BT/d8.bat"
APKSIGNER="$BT/apksigner"; [ -f "$APKSIGNER" ] || APKSIGNER="$BT/apksigner.bat"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"

rm -rf build && mkdir -p build/gen build/classes build/dex

echo "> recursos"
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$PLATFORM" --manifest AndroidManifest.xml -A assets \
  --java build/gen --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" build/res.zip

echo "> java"
SEP=":"; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) SEP=";";; esac
javac -nowarn -Xlint:-options -source 1.8 -target 1.8 -encoding UTF-8 \
  -bootclasspath "$PLATFORM$SEP$BT/core-lambda-stubs.jar" \
  -d build/classes $(find src build/gen -name '*.java')

echo "> dex"
"$D8" --release --min-api 24 --lib "$PLATFORM" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && "$BT/aapt" add ../unsigned.apk classes.dex > /dev/null)

echo "> assinatura"
KEY="${PLAYER_LOCAL_KEYSTORE:-$PWD/player-local.keystore}"
if [ ! -f "$KEY" ]; then
  keytool -genkeypair -keystore "$KEY" -storepass playerlocal -keypass playerlocal -alias playerlocal \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Player Local" > /dev/null 2>&1
fi
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
"$APKSIGNER" sign --ks "$KEY" --ks-pass pass:playerlocal --key-pass pass:playerlocal \
  --out build/PlayerLocal.apk build/aligned.apk
"$APKSIGNER" verify build/PlayerLocal.apk
echo "OK: android/build/PlayerLocal.apk"
