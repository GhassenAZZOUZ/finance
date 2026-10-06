# Android app (issue #84)

The Android app is a [Capacitor](https://capacitorjs.com) shell around the same static export as the
website (SPEC D19). Every page, test and deployment stays the website's; the native project in
`android/` only adds what the web cannot do well.

## Build

CI builds a debug APK on pull requests that touch the app shell, on `v*` tags and on demand
(workflow **Android**, artifact `boussole-debug-apk`).

Locally (Android Studio with the Android SDK, JDK 21, and `.env.local` set as for `npm run dev`):

```sh
npm run build:android          # next build without base path + cap sync android
cd android && ./gradlew assembleDebug
# or open the project: npx cap open android
```

`NEXT_PUBLIC_BASE_PATH` must be empty for the app (it is when unset).

Icons and splash screens are drawn from `app/icon.svg`: after a logo change, run
`node scripts/android-assets.mjs` and commit `android/app/src/main/res`.

## What is native today (phase 1)

- **Session in the Android Keystore** (`lib/native/platform.ts`), not the WebView's local storage;
  app backups are off.
- **Sign-in inside the app:** the 6-digit code works as on the website. The magic link returns to
  `io.github.ghassenazzouz.boussole://auth/confirm/…`, which reopens the app on its sign-in page
  (`components/app/native-bridge.tsx`).
- **Back button:** back a page, or leaves the app from the first one.
- **Offline read-only view** (`lib/native/offline-cache.ts`): each successful load is kept on the
  phone, encrypted with a Keystore key, for the signed-in user only. Without network the pages show
  it under « Hors ligne : vos données du … », every write is refused, and the data reloads as soon as
  the phone is back online. Signing out deletes it.
- **Biometric lock** (`components/app/app-lock.tsx`): at start and when coming back after the chosen
  time in the background (default 5 min; « Plus → Préférences → Verrouillage par empreinte »:
  off, immediately, 1, 5 or 15 min), the pages are hidden behind « Boussole est verrouillée » until
  the fingerprint or face is recognised; « Se déconnecter » is the way out. No lock on a phone
  without biometrics. A convenience lock (it can be bypassed on a rooted phone): the data's
  protection is the Keystore encryption.

Keep navigation client-side (`next/link`, `router`): the app's local server answers any page path
with the root page, so a full page load of `/budget/` would show the dashboard.

## Owner setup

| When | What |
|---|---|
| Now | Supabase dashboard → Authentication → URL Configuration → Redirect URLs: add `io.github.ghassenazzouz.boussole://auth/confirm/**` (without it, the magic link opens the website; the code still works). |
| Push phase | Create a Firebase project with the Android app `io.github.ghassenazzouz.boussole`; give its `google-services.json` and a service-account key as repository secrets (never committed). |
| Release phase | Create the Play Console personal account (25 $, identity check) and an upload keystore; give the keystore and its passwords as repository secrets. Run the closed test (12 testers, 14 days) before production. |

## Releasing to Google Play

1. **Upload key** (once, on your computer, JDK installed):
   `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
   Keep `upload.jks` and its passwords in your password manager; never commit them.
2. **Repository secrets** (Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`.
3. **Tag a release:** `git tag v1.0.0 && git push origin v1.0.0`. The **Android** workflow's
   « Build the signed release bundle » job uploads `boussole-release-aab` (versionName from the tag,
   versionCode from the run number).
4. **Play Console:** create the app « Boussole », opt in to Play App Signing, upload the AAB to the
   closed testing track first (personal accounts: 12 testers for 14 days before production).
   - Privacy policy URL: https://ghassenazzouz.github.io/finance/confidentialite/
   - Data safety: collects e-mail address and financial info (budget, loans, check-ins), for app
     functionality only, encrypted in transit, not shared, not used for ads or analytics, deletable
     by the user (« Mes données → Supprimer mon compte »).
   - Content rating questionnaire, target audience 18+, screenshots (phone, 1080 × 1920) and the
     512 × 512 icon (`public/icons/icon-512.png`).

## Next phases

1. ~~Boussole icon and splash screen~~ (done: `scripts/android-assets.mjs`).
2. Push reminders: FCM, a device-token table with RLS deleted with the account, the reminder job
   sending notifications, the per-device e-mail / notification choice in « Mes données ».
3. ~~Offline read-only view~~ (done).
4. ~~Biometric lock after idle time~~ (done).
5. ~~Signed release bundle and privacy policy page~~ (done); store listing and closed test: owner,
   see « Releasing to Google Play ».
