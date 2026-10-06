import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android app (issue #84, SPEC D19): a Capacitor shell around the same static export as the website.
 * `npm run build:android` builds the pages without the GitHub Pages base path into `out/` and copies
 * them into `android/`. The app id is permanent once published on Google Play.
 */
const config: CapacitorConfig = {
  appId: "io.github.ghassenazzouz.boussole",
  appName: "Boussole",
  webDir: "out",
  android: {
    // No mixed content: the app only talks to Supabase over https.
    allowMixedContent: false,
  },
};

export default config;
