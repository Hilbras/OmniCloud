# OmniCloud mobile apps

Standalone iOS and Android apps built with Capacitor. The UI is bundled inside
the app — nothing is loaded from a website — and the first screen asks for the
OmniCloud server to use.

## How it works

- `apps/web` is built and copied into `android/` and `ios/` by `cap sync`.
- The WebView always runs the bundled assets (`capacitor://localhost` on
  Android, `capacitor://localhost`/`https://localhost` on iOS).
- First launch shows **Connect to your server**; the origin is stored locally
  and every API call is made absolute against it.
- Native shells exchange the login cookie for a bearer session token
  (`x-omnicloud-client: native` header) because third-party cookies are not
  reliable in WebViews. The token is stored in local storage and sent as
  `Authorization: Bearer`.
- Cookies remain the mechanism on the normal website.
- Native extras: Android back button, external links in the system browser,
  deep links `omnicloud://`, brand icon/splash.

## Commands

```bash
pnpm --filter @hilbras/omnicloud-mobile sync        # build web + copy into both
pnpm --filter @hilbras/omnicloud-mobile sync:android
pnpm --filter @hilbras/omnicloud-mobile sync:ios
pnpm --filter @hilbras/omnicloud-mobile open:android
pnpm --filter @hilbras/omnicloud-mobile open:ios
```

## Building the Android APK locally

Capacitor 7 / Gradle 8.11 rejects newer JDKs. Use JDK 21 and the Android SDK
(command-line tools are enough):

```bash
export JAVA_HOME=$HOME/android-sdk/jdk21
export ANDROID_HOME=$HOME/android-sdk
echo "sdk.dir=$ANDROID_HOME" > apps/mobile/android/local.properties

pnpm --filter @hilbras/omnicloud-mobile sync:android
cd apps/mobile/android && ./gradlew assembleDebug
```

The APK is at `app/build/outputs/apk/debug/app-debug.apk`; install it with
`adb install -r <apk>`. Debug builds need no keystore.

## iOS

Requires macOS + Xcode:

```bash
pnpm --filter @hilbras/omnicloud-mobile sync:ios
pnpm --filter @hilbras/omnicloud-mobile open:ios
```

CI builds an unsigned simulator app on `macos-latest`; a device/TestFlight build
needs an Apple Developer account and signing.

## Server requirements

- HTTPS is recommended. Cleartext HTTP is allowed for LAN testing
  (`usesCleartextTraffic` on Android, ATS exception on iOS).
- The API accepts Capacitor origins (`capacitor://localhost`,
  `https://localhost`) for CORS and CSRF; bearer session tokens carry auth, not
  cookies.
- The server version must include the native-session changes in
  `apps/api/src/auth.ts` (`x-omnicloud-client: native`).

## Limitations

- One server per install; changing it is done by clearing app data (a settings
  action is a follow-up).
- Store signing is external: Android keystore / Play Console, Apple Developer
  account.
- Native compilation cannot run in this Linux environment; use the documented
  commands or the CI workflow.
