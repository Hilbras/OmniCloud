# Mobile apps — plan

iOS and Android apps that reuse the existing web drive instead of a second
client implementation.

## Decision: Capacitor shell

- **Capacitor 7** wraps the built web app; the native projects live in
  `apps/mobile/android` and `apps/mobile/ios`.
- The app is configured for **one OmniCloud server at build time**
  (`MOBILE_SERVER_URL`). The WebView loads that origin, so API calls stay
  same-origin: session cookies, `<video>` range requests, share pages and WebDAV
  links all behave exactly as in the browser. No CORS or token changes.
- Bundled `apps/web/dist` is the offline shell fallback.
- Native plugins: App (deep links, Android back), Browser (external links),
  StatusBar, SplashScreen, Keyboard, Share, Filesystem, Haptics.

Why not a rewrite: the drive already runs on mobile browsers; a second client
would duplicate sync, crypto, upload and offline logic. Why not remote-only:
App Review rejects a pure website wrapper, and offline/back/share integration
needs the bridge.

## Runtime configuration

`MOBILE_SERVER_URL` is required when building the native project, e.g.
`https://cloud.example.com`. A multi-server build (first-run server picker)
needs cookie/CORS work and is a later phase.

## Building the Android APK locally

Capacitor 7 / Gradle 8.11 rejects newer JDKs. Use JDK 21 and the Android SDK
(command-line tools are enough):

```bash
export JAVA_HOME=$HOME/android-sdk/jdk21
export ANDROID_HOME=$HOME/android-sdk
echo "sdk.dir=$ANDROID_HOME" > apps/mobile/android/local.properties

MOBILE_SERVER_URL=https://cloud.example.com pnpm --filter @hilbras/omnicloud-mobile sync:android
cd apps/mobile/android && ./gradlew assembleDebug
```

The APK is at `app/build/outputs/apk/debug/app-debug.apk`; install it with
`adb install -r <apk>`. Debug builds need no keystore. Release builds need a
keystore and the `MOBILE_SERVER_URL` of your instance.

## Phases

1. **Scaffold** — `apps/mobile` package, Capacitor config, Android + iOS
   projects, scripts, README.
2. **Native shell** — splash/status bar/theme, safe-area handling, Android back,
   external links in the system browser, download/share of files.
3. **Deep links** — `omnicloud://file/<id>` and `/drive` open the app; share
   links open in the in-app browser.
4. **Builds** — GitHub Actions: Android on Ubuntu (SDK), iOS on macOS (Xcode);
   unsigned artifacts for testing, signing secrets for stores.
5. **Store readiness** — icons/screenshots, privacy declarations, account
   deletion policy for local-mode servers.

## Verification

- Web build must stay green (`pnpm typecheck/lint/test`).
- `pnpm --filter @hilbras/omnicloud-mobile sync` copies the web build and
  refreshes native projects.
- Android: `./gradlew assembleDebug` + install on a device/emulator.
- iOS: `xcodebuild` on macOS + simulator run.
- Manual matrix: sign-in (QR, app, phone, local), upload/download, offline
  shell, back button, share sheet, deep link.

## External blockers

- **iOS build/signing** needs macOS + Xcode and an Apple Developer account.
- **Android signing** needs a keystore; debug builds run without it.
- **Store submission** needs developer accounts; the build still produces
  installable artifacts.
- This Linux environment has no Android SDK or Xcode, so native compilation
  cannot be verified here — CI/device steps are documented instead.
