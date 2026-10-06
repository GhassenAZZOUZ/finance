/**
 * Android app (issue #84, SPEC D19): what differs inside the Capacitor shell. On the website every
 * function here is a no-op or returns the web behaviour, so the same pages serve both.
 */
import { Capacitor } from "@capacitor/core";
import type { SupportedStorage } from "@supabase/supabase-js";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

/** The app id (capacitor.config.ts), also the URL scheme the magic link returns to. */
export const APP_SCHEME = "io.github.ghassenazzouz.boussole";

/** True inside the Android app, false in a browser (and in tests). */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Where a magic link opened on the phone comes back to: the app itself, not the website (AC-02). */
export const NATIVE_CONFIRM_URL = `${APP_SCHEME}://auth/confirm/`;

/**
 * The page a link to the app opens, or null when the URL is not one of ours:
 * `io.github.ghassenazzouz.boussole://auth/confirm/?code=…` → `/auth/confirm/?code=…`.
 */
export function appRouteOf(url: string): string | null {
  const prefix = `${APP_SCHEME}://`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const [path = "", query = ""] = rest.split(/\?(.*)/s);
  const route = `/${path.replace(/^\/+/, "")}`;
  // Only the sign-in landing is reachable from outside the app.
  if (!/^\/auth\/confirm\/?$/.test(route)) return null;
  return `/auth/confirm/${query ? `?${query}` : ""}`;
}

/**
 * The Supabase session in the Android Keystore instead of the WebView's local storage (AC-03):
 * it survives a restart and is not readable by other apps. A missing key reads as null.
 */
export const secureAuthStorage: SupportedStorage = {
  async getItem(key) {
    try {
      return (await SecureStoragePlugin.get({ key })).value;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    await SecureStoragePlugin.set({ key, value });
  },
  async removeItem(key) {
    try {
      await SecureStoragePlugin.remove({ key });
    } catch {
      // Already gone.
    }
  },
};
