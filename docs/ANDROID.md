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

Keep navigation client-side (`next/link`, `router`): the app's local server answers any page path
with the root page, so a full page load of `/budget/` would show the dashboard.

## Owner setup

| When | What |
|---|---|
| Now | Supabase dashboard → Authentication → URL Configuration → Redirect URLs: add `io.github.ghassenazzouz.boussole://auth/confirm/**` (without it, the magic link opens the website; the code still works). |
| Push phase | Create a Firebase project with the Android app `io.github.ghassenazzouz.boussole`; give its `google-services.json` and a service-account key as repository secrets (never committed). |
| Release phase | Create the Play Console personal account (25 $, identity check) and an upload keystore; give the keystore and its passwords as repository secrets. Run the closed test (12 testers, 14 days) before production. |

## Next phases

1. ~~Boussole icon and splash screen~~ (done: `scripts/android-assets.mjs`).
2. Push reminders: FCM, a device-token table with RLS deleted with the account, the reminder job
   sending notifications, the per-device e-mail / notification choice in « Mes données ».
3. Offline read-only view (last loaded plan and check-ins, encrypted on the device).
4. Biometric lock after idle time.
5. Signed release bundle (AAB) on tags, privacy policy page, Data safety form, store listing.
