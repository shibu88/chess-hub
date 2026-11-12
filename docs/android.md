# Chess Hub on Android (Capacitor)

The Android app is the **same web app** (the built `dist/`) running inside a native
WebView via [Capacitor 8](https://capacitorjs.com/). Everything is bundled, so Play,
Analysis and Training work **offline** with the Stockfish engine, puzzles and openings;
sign-in and cloud sync need the internet. There is no separate Android codebase — you
edit `src/`, rebuild, and `cap sync` copies the result into `android/`.

- **App name:** Chess Hub · **App id / package:** `com.shibu88.chesshub`
- **Web assets:** `webDir: dist` (see `capacitor.config.json`) — no remote `server.url`, so the app is self-contained.

## Prerequisites (one-time)
- **Node 20+** and the repo set up (`npm install`, `npm run copy-engine`, `.env` filled in — see `README.md`).
- **Android Studio** with, via its SDK Manager:
  - **Android SDK Platform** (API 34+; this project has been run against API 36)
  - **Android SDK Build-Tools** and **Platform-Tools** (gives you `adb`)
  - **A system image** for an emulator — pick a **Google Play** image if you want to test Google sign-in.
- **JDK 17 or 21** (an LTS). Gradle uses whatever `JAVA_HOME` points at; point it at a 17/21 JDK if a build complains about the Java version. (Android Studio bundles a suitable JBR at `…/Android Studio/jbr`.)

> `android/app/google-services.json` and any release keystore are **git-ignored** and must
> never be committed. `android/app/build/`, `android/.gradle/` and `android/build/` are
> ignored too; the rest of `android/` is committed.

## Build & run loop
From the repo root:

```bash
npm run build:android     # vite build  +  npx cap sync android  (copies dist/ into the app)
npm run cap:open          # open the android/ project in Android Studio
```

Then press **Run** in Android Studio on a connected device or a started emulator.

Command line instead of the IDE:

```bash
# start an emulator (list AVDs first)
emulator -list-avds
emulator -avd <AvdName>

# build + install the debug APK
cd android
./gradlew assembleDebug          # Windows: .\gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# launch it
adb shell monkey -p com.shibu88.chesshub -c android.intent.category.LAUNCHER 1
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

**After any change to `src/`**, re-run `npm run build:android` (or `vite build && npx cap sync android`)
before rebuilding the APK — editing `src/` alone does **not** update the app; `cap sync` copies the
fresh `dist/` into `android/app/src/main/assets/public`.

## Firebase: Google sign-in on the device
The web uses `signInWithPopup`, which a WebView can't run. On native the app uses
`@capacitor-firebase/authentication` with **`skipNativeAuth: true`** to get a Google **ID
token**, then signs the Firebase **JS SDK** in with `GoogleAuthProvider.credential(idToken)`
(see `src/auth/auth.js`). Email/password sign-in is unchanged. For this to work you register
the Android app in the **same** Firebase project the website uses:

1. **Get the debug SHA-1** (authorizes Google sign-in for debug builds):
   ```bash
   cd android
   ./gradlew signingReport      # read the SHA1: line under "Variant: debug"
   ```
   or from the default debug keystore directly:
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```
2. **Firebase console → your existing Chess Hub project → Project settings → Your apps → Add app → Android:**
   - **Package name:** `com.shibu88.chesshub` (exact)
   - **Debug signing certificate SHA-1:** paste the value from step 1 → **Register app**.
3. **Download `google-services.json`** into **`android/app/google-services.json`** (not `android/`).
   The Gradle plugin is applied *conditionally* (`android/app/build.gradle`), so the app still
   builds without the file — native Google sign-in just stays inert until it's present.
4. **Build → Authentication → Sign-in method:** ensure **Google** (and **Email/Password**) are enabled.

Email-verification links open in the system browser (the `authDomain` is the web domain) — expected.

## Signed release build (APK / AAB)
The debug key is for development only. A Play-Store or shareable build needs **your own**
release keystore. Never commit the keystore or its passwords.

1. **Create a keystore once** (keep it safe — losing it means you can't update the app):
   ```bash
   keytool -genkey -v -keystore chesshub-release.jks -alias chesshub -keyalg RSA -keysize 2048 -validity 10000
   ```
   Store it **outside the repo** (or ensure it's git-ignored).
2. **Point Gradle at it without hardcoding secrets** — put credentials in
   `android/keystore.properties` (git-ignored) and read them in `android/app/build.gradle`:
   ```properties
   # android/keystore.properties  (DO NOT COMMIT)
   storeFile=/absolute/path/to/chesshub-release.jks
   storePassword=…
   keyAlias=chesshub
   keyPassword=…
   ```
   ```gradle
   // android/app/build.gradle — inside android { }
   def keystoreProps = new Properties()
   def keystoreFile = rootProject.file("keystore.properties")
   if (keystoreFile.exists()) { keystoreProps.load(new FileInputStream(keystoreFile)) }

   signingConfigs {
       release {
           if (keystoreFile.exists()) {
               storeFile file(keystoreProps['storeFile'])
               storePassword keystoreProps['storePassword']
               keyAlias keystoreProps['keyAlias']
               keyPassword keystoreProps['keyPassword']
           }
       }
   }
   buildTypes {
       release {
           signingConfig signingConfigs.release
           // minifyEnabled false  (as currently configured)
       }
   }
   ```
3. **Add the release SHA-1 to Firebase too** — a release build is signed with a *different*
   key, so Google sign-in needs its SHA-1 added under the Android app in the console
   (`keytool -list -v -keystore chesshub-release.jks -alias chesshub`).
4. **Build:**
   ```bash
   cd android
   ./gradlew assembleRelease     # APK  → app/build/outputs/apk/release/
   ./gradlew bundleRelease       # AAB  → app/build/outputs/bundle/release/  (for Play Store)
   ```
5. **Bump the version** in `android/app/build.gradle` (`versionCode` / `versionName`) for each release you publish.

## Notes & troubleshooting
- **No special headers / no in-app CSP.** The lite single-thread Stockfish build needs no
  COOP/COEP headers, and the WebView has no server, so no CSP `<meta>` is added. The engine
  `.wasm` loads from the bundled `/engine/` under Capacitor's `https://localhost` origin.
- **"Error injecting safe area CSS" in logcat.** Harmless. It comes from Capacitor's own
  `SystemBars` plugin setting `--safe-area-inset-*` before `document.documentElement` exists
  during early WebView load; it's caught and retried. Our layout uses the standard
  `env(safe-area-inset-*)`, not those variables.
- **Emulator can't do Google sign-in.** Use a **Google Play** / Google APIs system image.
- **App shows old content after a code change.** You skipped `cap sync`; run `npm run build:android` again.
- **`adb` shows no device.** `adb kill-server && adb start-server`, then `adb devices`.
